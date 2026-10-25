import { prepareFdciImports, validFdciImport } from "../lib/fdci-import.ts";
import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const FDCI = "https://apicapacitaciones.educaciontuc.edu.ar/api";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** @typedef {{orphanActive: number, missingTokenOrSlug: number, http: Record<string, number>, timeoutOrNetwork: number, invalidJson: number, schema: number, other: number, activeDetailFailures: number, requestLimit: number}} FdciDiagnostics */

export async function requestJson(url, options = {}, fetcher = fetch) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try { response = await fetcher(url, { ...options, signal: AbortSignal.timeout(20_000) }); }
    catch (error) { if (attempt === 2) throw error; await pause(300 * 2 ** attempt); continue; }
    if (response.ok) return response.json();
    if (![500, 502, 503, 504].includes(response.status) || attempt === 2) throw new Error(`HTTP_${response.status}`);
    await pause(300 * 2 ** attempt);
  }
  throw new Error("REQUEST_FAILED");
}

/** @returns {Promise<{items: import("../lib/fdci-import.ts").FdciImport[], failures: number, diagnostics?: FdciDiagnostics, coursesFetched: number, coursesAvailable?: number, commissionsExamined?: number, activeCommissions?: number}>} */
export async function collectFdci(fetcher = fetch, selection, scope = "full") {
  const active = await requestJson(`${FDCI}/gestionCapas/getCapaActivas`, {}, fetcher);
  const courses = await requestJson(`${FDCI}/gestionCapas/getRestoCapas`, {}, fetcher);
  if (!Array.isArray(active) || !Array.isArray(courses)) throw new Error("FDCI_SCHEMA_CHANGED");
  if (selection && (!/^[A-Za-z0-9_-]{1,80}$/.test(selection.token) ||
      !/^[a-z0-9-]{1,160}$/.test(selection.slug) ||
      !/^[0-9]{1,12}$/.test(selection.commissionId))) throw new Error("FDCI_SELECTION_INVALID");
  const activeIds = new Set(active.map((item) => String(item.capacitacion_id)));
  const activeCommissionIds = new Set(active.map((item) => String(item.id)));
  const candidates = selection
    ? courses.filter((item) => item.token === selection.token && item.slug === selection.slug)
    : scope === "active" ? courses.filter((item) => activeIds.has(String(item.capacitacion_id))) : courses;
  if (selection && candidates.length !== 1) throw new Error("FDCI_COURSE_NOT_FOUND");
  const commissions = selection ? active.filter((item) => String(item.id) === selection.commissionId && String(item.capacitacion_id) === String(candidates[0].capacitacion_id)) : [...active];
  /** @type {FdciDiagnostics} */
  const diagnostics = { orphanActive: (selection ? commissions : active).filter((item) =>
    !courses.some((course) => String(course.capacitacion_id) === String(item.capacitacion_id))).length,
    missingTokenOrSlug: 0, http: {}, timeoutOrNetwork: 0, invalidJson: 0, schema: 0, other: 0, activeDetailFailures: 0, requestLimit: 0 };
  let failures = diagnostics.orphanActive;
  let coursesExamined = 0;
  for (const course of candidates) {
    coursesExamined++;
    if (!course.token || !course.slug) {
      failures++; diagnostics.missingTokenOrSlug++;
      if (activeIds.has(String(course.capacitacion_id))) diagnostics.activeDetailFailures++;
      continue;
    }
    try {
      const detail = await requestJson(`${FDCI}/capa/getCupo`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ token: course.token, slug: course.slug }) }, fetcher);
      if (!Array.isArray(detail?.comisiones)) throw new Error("FDCI_DETAIL_SCHEMA_CHANGED");
      commissions.push(...detail.comisiones.filter((commission) => String(commission.capacitacion_id) === String(course.capacitacion_id) && (selection ? String(commission.id) === selection.commissionId : scope !== "active" || activeCommissionIds.has(String(commission.id)))));
    } catch (error) {
      failures++;
      if (activeIds.has(String(course.capacitacion_id))) diagnostics.activeDetailFailures++;
      const message = error instanceof Error ? error.message : "";
      if (message === "FDCI_PROBE_REQUEST_LIMIT") { diagnostics.requestLimit++; break; }
      if (message === "HTTP_429") { diagnostics.http.HTTP_429 = (diagnostics.http.HTTP_429 || 0) + 1; break; }
      if (/^HTTP_\d{3}$/.test(message)) diagnostics.http[message] = (diagnostics.http[message] || 0) + 1;
      else if (message === "FDCI_DETAIL_SCHEMA_CHANGED") diagnostics.schema++;
      else if (error instanceof SyntaxError) diagnostics.invalidJson++;
      else if (error instanceof Error && /timeout|abort|fetch failed/i.test(`${error.name} ${message}`)) diagnostics.timeoutOrNetwork++;
      else diagnostics.other++;
    }
  }
  // The same commission can occur in active and detail responses.
  const items = await prepareFdciImports(candidates, commissions);
  if (selection && !items.some((item) => item.id === `fdci:commission:${selection.commissionId}`)) throw new Error("FDCI_COMMISSION_NOT_FOUND");
  return { items: selection ? items.filter((item) => item.id === `fdci:commission:${selection.commissionId}`) : scope === "active" ? items.filter((item) => activeCommissionIds.has(item.externalId)) : items,
    failures, diagnostics, coursesFetched: coursesExamined, coursesAvailable: candidates.length,
    commissionsExamined: new Set(commissions.map((item) => String(item.id))).size, activeCommissions: active.length };
}

export async function sendFdci(url, token, payload, fetcher = fetch) {
  const result = await requestJson(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) }, fetcher);
  if (result?.ok !== true) throw new Error("IMPORT_ACK_INVALID");
  return result;
}

export async function runFdciImport({ endpoint, token, fetcher = fetch, collect = collectFdci, selection = /** @type {{token: string, slug: string, commissionId: string} | undefined} */ (undefined), scope = "single" }) {
  let target;
  try { target = new URL(endpoint); } catch { throw new Error("IMPORT_CONFIGURATION_INVALID"); }
  if ((target.protocol !== "https:" && !(target.protocol === "http:" && target.hostname === "127.0.0.1")) || !/^[A-Za-z0-9_-]{32,}$/.test(token)) throw new Error("IMPORT_CONFIGURATION_INVALID");
  if (!["single", "active", "full"].includes(scope) || (scope === "single") !== Boolean(selection)) throw new Error("FDCI_SELECTION_INVALID");
  if (selection && (!/^[A-Za-z0-9_-]{1,80}$/.test(selection.token) || !/^[a-z0-9-]{1,160}$/.test(selection.slug) || !/^[0-9]{1,12}$/.test(selection.commissionId))) throw new Error("FDCI_SELECTION_INVALID");
  let created = 0, updated = 0, unchanged = 0, batches = 0, rejected = 0;
  const rejectedReasons = {}, rejectedStatuses = {};
  const count = (target, key) => { target[key] = (target[key] || 0) + 1; };
  const { items, failures, diagnostics, coursesFetched, coursesAvailable, commissionsExamined, activeCommissions } = await collect(fetcher, selection, scope);
  if (!Array.isArray(items) || (scope === "single" && !items.length)) throw new Error("FDCI_EMPTY_RESPONSE");
  if (failures && scope !== "full" || (scope === "single" && (items.length !== 1 || items[0].id !== `fdci:commission:${selection.commissionId}`))) throw new Error("FDCI_SELECTION_INCOMPLETE");
  // One row per invocation keeps the receiver well below its five-row hard limit.
  for (const item of items) {
    if (scope === "full" && !validFdciImport(item, (reason) => count(rejectedReasons, reason))) {
      rejected++; count(rejectedStatuses, item.normalizedStatus || "UNKNOWN"); continue;
    }
    let result;
    try { result = await sendFdci(endpoint, token, { mode: "batch", items: [item] }, fetcher); }
    catch (error) {
      // A rejected public record cannot prevent later healthy records from arriving.
      // Authentication, D1, and transient server failures still stop the run.
      if (scope === "full" && error instanceof Error && error.message === "HTTP_400") {
        rejected++; count(rejectedReasons, "receiverHttp400"); count(rejectedStatuses, item.normalizedStatus || "UNKNOWN"); continue;
      }
      throw error;
    }
    if (!result.ok || result.received !== 1) throw new Error("IMPORT_ACK_INVALID");
    created += result.created; updated += result.updated; unchanged += result.unchanged; batches++;
  }
  // A bad historical detail must not block healthy new courses. The run stays partial:
  // no source-wide success or absence reconciliation may follow it.
  if (failures || rejected) {
    const error = new Error("FDCI_PARTIAL_SOURCE");
    error.failures = failures + rejected;
    error.diagnostics = { ...diagnostics, rejected, rejectedReasons, rejectedStatuses };
    error.result = { coursesFetched, coursesAvailable, commissionsExamined, activeCommissions, discovered: items.length, created, updated, unchanged, rejected, batches };
    throw error;
  }
  return { coursesFetched, coursesAvailable, commissionsExamined, activeCommissions, discovered: items.length, created, updated, unchanged, batches, completed: scope === "full" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const startedAt = new Date().toISOString();
  const summarize = async (status, details) => {
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
      `### FDCI: ${status}\n\n- Último intento: ${startedAt}\n- ${details}\n\n`);
  };
  try {
    const scope = process.env.FDCI_SCOPE || "single";
    const selection = scope === "single" ? { token: process.env.FDCI_COURSE_TOKEN || "", slug: process.env.FDCI_COURSE_SLUG || "", commissionId: process.env.FDCI_COMMISSION_ID || "" } : undefined;
    const result = await runFdciImport({ endpoint: process.env.FDCI_IMPORT_URL || "", token: process.env.FDCI_IMPORT_SECRET || "", selection, scope });
    console.log(JSON.stringify({ ...result, startedAt, finishedAt: new Date().toISOString() }));
    await summarize("éxito", `Último éxito: ${new Date().toISOString()}; nuevas: ${result.created}; actualizadas: ${result.updated}; sin cambios: ${result.unchanged}`);
  } catch (error) {
    const code = error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, "[url]") : "unknown";
    console.error("FDCI_IMPORT_FAILED", code);
    await summarize("falló", `Error: ${code}`);
    process.exitCode = 1;
  }
}
