import { prepareFdciImports, validFdciImport } from "../lib/fdci-import.ts";
import { requestJson, sendFdci } from "./import-fdci.mjs";

const root = "https://apicapacitaciones.educaciontuc.edu.ar/api";
const id = value => /^[1-9]\d{0,11}$/.test(String(value));
export const fdciKey = (course, commission) => {
  if (!id(course) || !id(commission)) throw new Error("FDCI_SCHEMA_CHANGED");
  return `${String(course).padStart(12, "0")}:${String(commission).padStart(12, "0")}`;
};

export async function checkpointRequest(target, owner, payload, fetcher) {
  let response;
  try {
    response = await fetcher(`${target.origin}/api/internal/fdci-checkpoint`, { method: "POST", redirect: "error",
      headers: { authorization: `Bearer ${target.secret}`, "content-type": "application/json", "x-import-gate-owner": owner },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(20_000) });
  } catch { throw new Error("FDCI_CHECKPOINT_UNCERTAIN"); }
  if (!response.ok) throw new Error(response.status >= 500 ? "FDCI_CHECKPOINT_UNCERTAIN" : `FDCI_CHECKPOINT_HTTP_${response.status}`);
  let body;
  try { body = await response.json(); } catch { throw new Error("FDCI_CHECKPOINT_UNCERTAIN"); }
  const state = body?.state;
  if (!body?.ok || !state || state.id !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0 ||
      !Number.isSafeInteger(state.cycle) || state.cycle < 1 || !Number.isSafeInteger(state.failures) || state.failures < 0 ||
      ![state.after_key, state.upper_key].every(k => k === "" || typeof k === "string" && /^\d{12}:\d{12}$/.test(k)) ||
      payload.op !== "get" && state.revision !== payload.revision + 1 ||
      payload.op === "advance" && state.after_key !== payload.after ||
      payload.op === "start" && state.upper_key !== payload.upper ||
      payload.op === "finish" && (state.upper_key !== "" || state.after_key !== "")) throw new Error("FDCI_CHECKPOINT_ACK_INVALID");
  return state;
}

// One bounded piece of the existing active importer; all content normalization
// and publication writes still use the original helpers and receiver.
export async function runIncrementalFdci(target, safety, fetcher) {
  let state, examined = 0, created = 0, updated = 0, unchanged = 0, rejected = 0, skipped = 0, batches = 0;
  let discovered = 0, coursesAvailable = 0, coursesFetched = 0, cycleComplete = false;
  const errors = [], sourceErrors = {};
  const snapshot = () => ({ discovered, examined, created, updated, unchanged, rejected, skipped, batches,
    coursesFetched, coursesAvailable, commissionsExamined: examined, completed: false, cycleComplete,
    cursor: state, sourceErrors, errors });
  const checkpoint = async payload => { state = await checkpointRequest(target, safety.owner, payload, fetcher); };
  const advance = async (key, failed = false, code = null) => checkpoint({ op: "advance", revision: state.revision, after: key, failed, code });
  try {
    await checkpoint({ op: "get" });
    const active = await requestJson(`${root}/gestionCapas/getCapaActivas`, {}, fetcher);
    const courses = await requestJson(`${root}/gestionCapas/getRestoCapas`, {}, fetcher);
    if (!Array.isArray(active) || !Array.isArray(courses)) throw new Error("FDCI_SCHEMA_CHANGED");
    const keyed = new Map(), ids = new Map();
    for (const item of active) {
      if (!item || typeof item !== "object") throw new Error("FDCI_SCHEMA_CHANGED");
      const key = fdciKey(item.capacitacion_id, item.id);
      if (ids.has(String(item.id)) && ids.get(String(item.id)) !== key) throw new Error("FDCI_SCHEMA_CHANGED");
      ids.set(String(item.id), key); keyed.set(key, item);
    }
    const entries = [...keyed].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    discovered = entries.length;
    const activeCourses = new Set(entries.map(([, c]) => String(c.capacitacion_id)));
    coursesAvailable = activeCourses.size;
    const parents = new Map();
    for (const course of courses) {
      // Historical/unrelated catalogue rows cannot block the active scope.
      if (!course || !activeCourses.has(String(course.capacitacion_id))) continue;
      if (parents.has(String(course.capacitacion_id))) throw new Error("FDCI_SCHEMA_CHANGED");
      parents.set(String(course.capacitacion_id), course);
    }
    if (!entries.length) return { ...snapshot(), ...(state.upper_key ? { code: "FDCI_EMPTY_RESPONSE" } : {}), status: state.upper_key ? "PARTIAL" : "OK",
      failed: Boolean(state.upper_key), empty: true, progressPending: false };
    if (!state.upper_key) await checkpoint({ op: "start", revision: state.revision, upper: entries.at(-1)[0] });
    const pending = entries.filter(([key]) => key > state.after_key && key <= state.upper_key);
    const details = new Map();
    let budgetStop = false;
    for (const [key, commission] of pending) {
      if (examined >= safety.maxPublications) break;
      const courseId = String(commission.capacitacion_id);
      if (String(commission.id) === "6375") { examined++; skipped++; await advance(key); continue; }
      let item;
      try {
        const course = parents.get(courseId);
        if (!course || !/^[A-Za-z0-9_-]{1,80}$/.test(course.token || "") || !/^[a-z0-9-]{1,160}$/.test(course.slug || ""))
          throw new Error("FDCI_COURSE_UNAVAILABLE");
        if (!details.has(courseId)) {
          coursesFetched++;
          try {
            const detail = await requestJson(`${root}/capa/getCupo`, { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token: course.token, slug: course.slug }) }, fetcher);
            if (!Array.isArray(detail?.comisiones)) throw new Error("FDCI_DETAIL_SCHEMA_CHANGED");
            details.set(courseId, detail.comisiones);
          } catch (error) { details.set(courseId, error); }
        }
        const detail = details.get(courseId);
        if (detail instanceof Error) throw detail;
        const matches = detail.filter(c => String(c.id) === String(commission.id) && String(c.capacitacion_id) === courseId);
        if (matches.length !== 1) throw new Error("FDCI_COMMISSION_UNAVAILABLE");
        [item] = await prepareFdciImports([course], matches);
        if (!item || item.normalizedStatus === "UNKNOWN") item = null;
        else if (!validFdciImport(item)) throw new Error("FDCI_RECORD_INVALID");
      } catch (error) {
        // Budget exhaustion / rate limiting never discards the pending key.
        if (["FDCI_PROBE_REQUEST_LIMIT", "HTTP_429", "FDCI_CANCELLED"].includes(error.message)) {
          sourceErrors[error.message === "FDCI_PROBE_REQUEST_LIMIT" ? "requestLimit" : error.message] = 1;
          budgetStop = true; break;
        }
        // A known source-read failure is durably recorded as a failed review,
        // not a successful publication. Retry it in the next bounded cycle;
        // one permanently broken course cannot starve the following courses.
        const code = /^FDCI_[A-Z_]+$/.test(error.message) ? error.message :
          /^HTTP_\d{3}$/.test(error.message) ? `FDCI_${error.message}` : error instanceof SyntaxError ? "FDCI_INVALID_JSON" : "FDCI_NETWORK_ERROR";
        examined++; rejected++; errors.push({ key, code });
        await advance(key, true, code); continue;
      }
      if (!item) { examined++; skipped++; await advance(key); continue; }
      examined++;
      let ack;
      try { ack = await sendFdci(target.endpoint, target.secret, { mode: "batch", items: [item] }, fetcher, safety.owner); }
      catch (error) {
        if (error.message === "HTTP_422") { skipped++; await advance(key); continue; }
        throw error; // Never advance after uncertain ACK, auth, D1 or lease failures.
      }
      created += ack.created; updated += ack.updated; unchanged += ack.unchanged; batches++;
      await advance(key);
    }
    const failed = state.failures > 0 || rejected > 0 || Object.keys(sourceErrors).some(k => k !== "requestLimit");
    if (!budgetStop && !entries.some(([key]) => key > state.after_key && key <= state.upper_key)) {
      await checkpoint({ op: "finish", revision: state.revision }); cycleComplete = true;
    }
    return { ...snapshot(), status: failed || !cycleComplete ? "PARTIAL" : "OK", failed,
      progressPending: !cycleComplete, deferred: entries.filter(([key]) => !cycleComplete && key > state.after_key && key <= state.upper_key).length };
  } catch (error) { error.result = { ...snapshot(), uncertain: ["IMPORT_RESULT_UNCERTAIN", "IMPORT_ACK_INVALID"].includes(error.message) ? 1 : 0 }; throw error; }
}
