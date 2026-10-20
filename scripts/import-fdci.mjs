import { FDCI_BATCH_SIZE, prepareFdciImports } from "../lib/fdci-import.ts";
import { pathToFileURL } from "node:url";

const FDCI = "https://apicapacitaciones.educaciontuc.edu.ar/api";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function requestJson(url, options = {}, fetcher = fetch) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try { response = await fetcher(url, { ...options, signal: AbortSignal.timeout(20_000) }); }
    catch (error) { if (attempt === 2) throw error; await pause(300 * 2 ** attempt); continue; }
    if (response.ok) return response.json();
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) throw new Error(`HTTP_${response.status}`);
    await pause(300 * 2 ** attempt);
  }
  throw new Error("REQUEST_FAILED");
}

export async function collectFdci(fetcher = fetch, selection) {
  const active = await requestJson(`${FDCI}/gestionCapas/getCapaActivas`, {}, fetcher);
  const courses = await requestJson(`${FDCI}/gestionCapas/getRestoCapas`, {}, fetcher);
  if (!Array.isArray(active) || !Array.isArray(courses)) throw new Error("FDCI_SCHEMA_CHANGED");
  if (selection && (!/^[A-Za-z0-9_-]{1,80}$/.test(selection.token) ||
      !/^[a-z0-9-]{1,160}$/.test(selection.slug) ||
      !/^[0-9]{1,12}$/.test(selection.commissionId))) throw new Error("FDCI_SELECTION_INVALID");
  const activeIds = new Set(active.map((item) => String(item.capacitacion_id)));
  const candidates = selection
    ? courses.filter((item) => item.token === selection.token && item.slug === selection.slug)
    : courses.filter((item) => item.proxima_fecha_preinscripcion || activeIds.has(String(item.capacitacion_id)));
  if (selection && candidates.length !== 1) throw new Error("FDCI_COURSE_NOT_FOUND");
  const commissions = selection ? active.filter((item) => String(item.id) === selection.commissionId && String(item.capacitacion_id) === String(candidates[0].capacitacion_id)) : [...active];
  let failures = 0;
  for (const course of candidates) {
    if (!course.token || !course.slug) { failures++; continue; }
    try {
      const detail = await requestJson(`${FDCI}/capa/getCupo`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ token: course.token, slug: course.slug }) }, fetcher);
      if (!Array.isArray(detail?.comisiones)) throw new Error("FDCI_DETAIL_SCHEMA_CHANGED");
      commissions.push(...detail.comisiones.filter((commission) => String(commission.capacitacion_id) === String(course.capacitacion_id) && (!selection || String(commission.id) === selection.commissionId)));
    } catch { failures++; }
  }
  // The same commission can occur in active and detail responses.
  const items = await prepareFdciImports(selection ? candidates : courses, commissions);
  if (selection && !items.some((item) => item.id === `fdci:commission:${selection.commissionId}`)) throw new Error("FDCI_COMMISSION_NOT_FOUND");
  return { items: selection ? items.filter((item) => item.id === `fdci:commission:${selection.commissionId}`) : items, failures, coursesFetched: candidates.length };
}

export async function sendFdci(url, token, payload, fetcher = fetch) {
  const result = await requestJson(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) }, fetcher);
  if (result?.ok !== true) throw new Error("IMPORT_ACK_INVALID");
  return result;
}

export async function runFdciImport({ endpoint, token, fetcher = fetch, collect = collectFdci, selection = /** @type {{token: string, slug: string, commissionId: string} | undefined} */ (undefined) }) {
  if (!/^https:\/\//.test(endpoint) || !/^[A-Za-z0-9_-]{32,}$/.test(token)) throw new Error("IMPORT_CONFIGURATION_INVALID");
  if (selection && (!/^[A-Za-z0-9_-]{1,80}$/.test(selection.token) || !/^[a-z0-9-]{1,160}$/.test(selection.slug) || !/^[0-9]{1,12}$/.test(selection.commissionId))) throw new Error("FDCI_SELECTION_INVALID");
  if (!selection) await sendFdci(endpoint, token, { mode: "start" }, fetcher);
  let created = 0, updated = 0, unchanged = 0, batches = 0;
  try {
    const { items, failures, coursesFetched } = await collect(fetcher, selection);
    if (!Array.isArray(items) || !items.length) throw new Error("FDCI_EMPTY_RESPONSE");
    if (selection && (failures || items.length !== 1 || items[0].id !== `fdci:commission:${selection.commissionId}`)) throw new Error("FDCI_SELECTION_INCOMPLETE");
    for (let offset = 0; offset < items.length; offset += FDCI_BATCH_SIZE) {
      const result = await sendFdci(endpoint, token, { mode: "batch", items: items.slice(offset, offset + FDCI_BATCH_SIZE) }, fetcher);
      if (!result.ok || result.received !== Math.min(FDCI_BATCH_SIZE, items.length - offset)) throw new Error("IMPORT_ACK_INVALID");
      created += result.created; updated += result.updated; unchanged += result.unchanged; batches++;
    }
    if (failures) throw new Error(`FDCI_DETAILS_PARTIAL_${failures}`);
    if (!selection) await sendFdci(endpoint, token, { mode: "complete", count: items.length }, fetcher);
    return { coursesFetched, discovered: items.length, created, updated, unchanged, batches, completed: !selection };
  } catch (error) {
    if (!selection) try { await sendFdci(endpoint, token, { mode: "failed" }, fetcher); } catch { /* A failed status report must not conceal the original error. */ }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const selection = { token: process.env.FDCI_COURSE_TOKEN || "", slug: process.env.FDCI_COURSE_SLUG || "", commissionId: process.env.FDCI_COMMISSION_ID || "" };
    if (!selection.token || !selection.slug || !selection.commissionId) throw new Error("FDCI_SELECTION_REQUIRED");
    const result = await runFdciImport({ endpoint: process.env.FDCI_IMPORT_URL || "", token: process.env.FDCI_IMPORT_SECRET || "", selection });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error("FDCI_IMPORT_FAILED", error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, "[url]") : "unknown");
    process.exitCode = 1;
  }
}
