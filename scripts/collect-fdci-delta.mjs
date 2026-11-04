// Bounded active-course scan. Every read still passes through the existing
// six-request budget/pause wrapper. No source writes or persistent local cache.
import { requestJson } from "./import-fdci.mjs";
import { prepareFdciImports } from "../lib/fdci-import.ts";
import { fdciKey } from "./fdci-incremental.mjs";
const root = "https://apicapacitaciones.educaciontuc.edu.ar/api";
const courseKey = id => fdciKey(id, 1).slice(0, 12);

export async function collectFdciDeltaSlice(fetcher, { state, queued }) {
  if (![state.detail_after, state.detail_upper].every(value => typeof value === "string" && /^(?:\d{12})?$/.test(value)) ||
      state.detail_after > state.detail_upper) throw new Error("FDCI_DELTA_CURSOR_INVALID");
  const active = await requestJson(`${root}/gestionCapas/getCapaActivas`, {}, fetcher);
  const courses = await requestJson(`${root}/gestionCapas/getRestoCapas`, {}, fetcher);
  if (!Array.isArray(active) || !Array.isArray(courses)) throw new Error("FDCI_SCHEMA_CHANGED");
  const commissions = new Map();
  for (const c of active) {
    fdciKey(c?.capacitacion_id, c?.id);
    const previous = commissions.get(String(c.id));
    if (previous && String(previous.capacitacion_id) !== String(c.capacitacion_id)) throw new Error("FDCI_SCHEMA_CHANGED");
    commissions.set(String(c.id), c);
  }
  if (!commissions.size && state.detail_upper) throw new Error("FDCI_DELTA_COLLECTION_INCOMPLETE");
  const parents = new Map();
  const activeKeys = new Set([...commissions.values()].map(c => courseKey(c.capacitacion_id)));
  for (const c of courses) {
    if (!c || !activeKeys.has(String(c.capacitacion_id).padStart(12, "0"))) continue;
    const key = courseKey(c.capacitacion_id);
    if (parents.has(key)) throw new Error("FDCI_SCHEMA_CHANGED");
    parents.set(key, c);
  }
  const keys = [...activeKeys].sort(), upper = state.detail_upper || keys.at(-1) || "";
  const after = state.detail_after || "";
  const pending = keys.filter(key => key > after && key <= upper);
  // Revalidate oldest queued IDs while leaving at least two detail slots for
  // forward scan progress. Overlapping courses consume only one request.
  const pinned = [...queued.values()].sort((a, b) => a.seq - b.seq).flatMap(row => {
    const c = commissions.get(row.id.split(":").at(-1));
    return c ? [courseKey(c.capacitacion_id)] : [];
  });
  const selected = [...new Set(pinned)].slice(0, 2);
  for (const key of pending) { if (selected.length === 4) break; if (!selected.includes(key)) selected.push(key); }
  const completed = new Set(), items = [];
  let budgetStop = false;
  for (const key of selected) {
    const course = parents.get(key);
    if (!course || !/^[A-Za-z0-9_-]{1,80}$/.test(course.token || "") || !/^[a-z0-9-]{1,160}$/.test(course.slug || ""))
      throw new Error("FDCI_DELTA_COLLECTION_INCOMPLETE");
    let detail;
    try {
      detail = await requestJson(`${root}/capa/getCupo`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: course.token, slug: course.slug }) }, fetcher);
    } catch (error) {
      if (error.message === "FDCI_PROBE_REQUEST_LIMIT") { budgetStop = true; break; }
      throw error;
    }
    if (!Array.isArray(detail?.comisiones)) throw new Error("FDCI_DELTA_COLLECTION_INCOMPLETE");
    const expected = [...commissions.values()].filter(c => courseKey(c.capacitacion_id) === key);
    const matched = expected.map(c => {
      const rows = detail.comisiones.filter(d => String(d.id) === String(c.id) && String(d.capacitacion_id) === String(c.capacitacion_id));
      if (rows.length !== 1) throw new Error("FDCI_DELTA_COLLECTION_INCOMPLETE");
      return rows[0];
    });
    items.push(...await prepareFdciImports([course], matched)); completed.add(key);
  }
  let next = after;
  for (const key of pending) { if (!completed.has(key)) break; next = key; }
  if (budgetStop && !items.length) throw new Error("FDCI_DELTA_COLLECTION_INCOMPLETE");
  const complete = !pending.some(key => key > next);
  return { items, failures: 0, activeCommissions: commissions.size,
    detail: { after: next, upper, complete }, coursesFetched: completed.size };
}
