// Read-only official inventory. Input is a SELECT export of production IDs;
// output stays under .wrangler/ and is never sent to the import gateway.
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const root = "https://apicapacitaciones.educaciontuc.edu.ar/api";
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const id = value => /^[1-9]\d{0,11}$/.test(String(value));

export function inventorySummary(rows, courses, details, at = new Date()) {
  const stored = new Set(rows.map(row => row.id));
  const missingCourses = courses.filter(course => !stored.has(`fdci:course:${course.capacitacion_id}`))
    .map(course => String(course.capacitacion_id));
  const missingCommissions = [], seen = new Set();
  for (const course of courses) for (const row of details[String(course.capacitacion_id)] || []) {
    if (!id(row.id) || String(row.capacitacion_id) !== String(course.capacitacion_id) || seen.has(String(row.id)))
      throw new Error("FDCI_RECOVERY_DETAIL_INVALID");
    seen.add(String(row.id));
    if (stored.has(`fdci:commission:${row.id}`)) continue;
    const opening = row.fecha_apertura_preinscripcion || null;
    const closing = row.fecha_cierre_preinscripcion || null;
    const local = value => value ? Date.parse(String(value).replace(" ", "T") + "-03:00") : NaN;
    const status = Number(row.comision_cerrada) === 1 || local(closing) < at.getTime() ? "CLOSED" :
      local(opening) > at.getTime() ? "UPCOMING" : Number(row.isActivePre) === 1 && local(opening) <= at.getTime() ? "ACTIVE" : "UNKNOWN";
    missingCommissions.push({ courseId: String(course.capacitacion_id), commissionId: String(row.id),
      token: course.token, slug: course.slug, opening, closing, status });
  }
  return { missingCourses, missingCommissions: missingCommissions.sort((a, b) => Number(a.commissionId) - Number(b.commissionId)) };
}

export async function runInventory({ idsPath, statePath, fetcher = fetch, pauseMs = 3500, maxDetails = 18, at = new Date() }) {
  if (!Number.isInteger(pauseMs) || pauseMs < 400) throw new Error("FDCI_RECOVERY_RATE_INVALID");
  if (!Number.isInteger(maxDetails) || maxDetails < 1 || maxDetails > 18) throw new Error("FDCI_RECOVERY_BATCH_INVALID");
  const d1 = JSON.parse(await readFile(idsPath, "utf8"));
  if (!Array.isArray(d1) || d1[0]?.success !== true || d1[0]?.meta?.rows_written !== 0 || !Array.isArray(d1[0].results) ||
      d1[0].results.some(row => typeof row.id !== "string" || !row.id.startsWith("fdci:")))
    throw new Error("FDCI_RECOVERY_IDS_INVALID");
  const response = await fetcher(`${root}/gestionCapas/getRestoCapas`, { redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`FDCI_RECOVERY_LIST_${response.status}`);
  const courses = await response.json();
  if (!Array.isArray(courses) || courses.some(course => !id(course?.capacitacion_id) ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(course.token || "") || !/^[a-z0-9-]{1,160}$/.test(course.slug || "")) ||
      new Set(courses.map(course => String(course.capacitacion_id))).size !== courses.length)
    throw new Error("FDCI_RECOVERY_LIST_INVALID");
  const catalogHash = createHash("sha256").update(JSON.stringify(courses.map(course => [course.capacitacion_id, course.token, course.slug]))).digest("hex");
  let state;
  try { state = JSON.parse(await readFile(statePath, "utf8")); } catch { state = null; }
  if (state && (state.catalogHash !== catalogHash || !state.details || typeof state.details !== "object"))
    throw new Error("FDCI_RECOVERY_CATALOG_CHANGED");
  state ||= { catalogHash, details: {}, errors: {} };
  let requests = 1;
  let fetched = 0;
  const stored = new Set(d1[0].results.map(row => row.id));
  const ordered = [...courses.filter(course => !stored.has(`fdci:course:${course.capacitacion_id}`)),
    ...courses.filter(course => stored.has(`fdci:course:${course.capacitacion_id}`))];
  for (const course of ordered) {
    const key = String(course.capacitacion_id);
    if (Object.hasOwn(state.details, key)) continue;
    if (fetched >= maxDetails) break;
    await delay(pauseMs);
    try {
      requests++;
      fetched++;
      const detailResponse = await fetcher(`${root}/capa/getCupo`, { method: "POST", redirect: "error",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ token: course.token, slug: course.slug }),
        signal: AbortSignal.timeout(20_000) });
      if (!detailResponse.ok) throw new Error(`HTTP_${detailResponse.status}`);
      const detail = await detailResponse.json();
      if (!Array.isArray(detail?.comisiones)) throw new Error("FDCI_RECOVERY_DETAIL_INVALID");
      state.details[key] = detail.comisiones.map(row => ({ id: row.id, capacitacion_id: row.capacitacion_id,
        fecha_apertura_preinscripcion: row.fecha_apertura_preinscripcion, fecha_cierre_preinscripcion: row.fecha_cierre_preinscripcion,
        comision_cerrada: row.comision_cerrada, isActivePre: row.isActivePre }));
      delete state.errors[key];
    } catch (error) {
      state.errors[key] = /^HTTP_\d{3}$/.test(error?.message || "") ? error.message : "DETAIL_UNAVAILABLE";
      if (state.errors[key] === "HTTP_429") break;
    }
    await mkdir(new URL("./", pathToFileURL(statePath)), { recursive: true });
    await writeFile(`${statePath}.tmp`, JSON.stringify(state));
    await rename(`${statePath}.tmp`, statePath);
  }
  const summary = inventorySummary(d1[0].results, courses, state.details, at);
  return { catalogCount: courses.length, storedCount: d1[0].results.length, scanned: Object.keys(state.details).length,
    errors: state.errors, sourceRequests: requests, complete: Object.keys(state.details).length === courses.length,
    ...summary };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const idsPath = ".wrangler/private-fdci-recovery/fdci-production-ids-readonly.json";
  const statePath = ".wrangler/private-fdci-recovery/fdci-inventory-state.json";
  try {
    const result = await runInventory({ idsPath, statePath });
    await writeFile(".wrangler/private-fdci-recovery/fdci-recovery-manifest.json", JSON.stringify(result, null, 2));
    const statuses = Object.groupBy(result.missingCommissions, row => row.status);
    console.log(JSON.stringify({ catalogCount: result.catalogCount, storedCount: result.storedCount,
      scanned: result.scanned, errors: Object.keys(result.errors).length, sourceRequests: result.sourceRequests,
      complete: result.complete, missingCourses: result.missingCourses.length,
      missingCommissions: result.missingCommissions.length,
      statusCounts: Object.fromEntries(Object.entries(statuses).map(([key, rows]) => [key, rows.length])) }));
    if (!result.complete) process.exitCode = 1;
  } catch (error) {
    console.error(/^[A-Z_0-9]+$/.test(error?.message || "") ? error.message : "FDCI_RECOVERY_INVENTORY_FAILED");
    process.exitCode = 1;
  }
}
