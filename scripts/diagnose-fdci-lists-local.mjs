// Bounded public-source diagnosis: two FDCI list reads, no getCupo and no D1 writes.
import { prepareFdciImports, validFdciImport } from "../lib/fdci-import.ts";

const base = "https://apicapacitaciones.educaciontuc.edu.ar/api/gestionCapas/";
async function list(name) {
  const response = await fetch(`${base}${name}`, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`FDCI_LIST_HTTP_${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error("FDCI_LIST_SCHEMA_CHANGED");
  return rows;
}

function validationReasons(row) {
  const reasons = [];
  if (!/^fdci:(?:course|commission):[A-Za-z0-9_-]{1,80}$/.test(row.id) ||
      row.id.split(":").at(-1) !== row.externalId || !row.externalId) reasons.push("identity");
  for (const [key, limit] of Object.entries({ category: 120, title: 500, summary: 2000, level: 300,
    area: 300, location: 300, character: 300, status: 100, metadata: 6000,
    sourceCircuitRaw: 300, circuitInferenceSource: 30 })) {
    if (typeof row[key] !== "string" || row[key].length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(row[key]))
      reasons.push(`text:${key}`);
  }
  for (const key of ["startsAt", "endsAt", "sourceUpdatedAt", "registrationOpenAt", "registrationCloseAt", "expiresAt"])
    if (row[key] !== null && (typeof row[key] !== "string" || !Number.isFinite(Date.parse(row[key])) || row[key].length > 40))
      reasons.push(`date:${key}`);
  if (!/^[a-f0-9]{64}$/.test(row.contentHash || "")) reasons.push("hash");
  if (!Number.isInteger(row.circuitConfidence) || row.circuitConfidence < 0 || row.circuitConfidence > 100 ||
      !["UNKNOWN", "I", "II", "III", "IV", "V", "ALL", "MULTIPLE"].includes(row.circuit)) reasons.push("circuit");
  try {
    const url = new URL(row.officialUrl);
    if (url.protocol !== "https:" || url.hostname !== "capacitaciondocente.educaciontuc.gov.ar") reasons.push("url");
  } catch { reasons.push("url"); }
  try {
    const metadata = JSON.parse(row.metadata);
    if (!metadata.trainingId || metadata.entity !== (row.id.startsWith("fdci:commission:") ? "commission" : "course") ||
        (metadata.entity === "commission" && String(metadata.commissionId) !== row.externalId)) reasons.push("metadata");
  } catch { reasons.push("metadata"); }
  return reasons.length ? reasons : ["receiver-only-rule"];
}

const [active, courses] = await Promise.all([list("getCapaActivas"), list("getRestoCapas")]);
const ids = new Set(courses.map((course) => String(course.capacitacion_id)));
const rows = await prepareFdciImports(courses, active);
const invalid = rows.filter((row) => !validFdciImport(row));
const reasons = {};
for (const row of invalid) for (const reason of validationReasons(row)) reasons[reason] = (reasons[reason] || 0) + 1;
const oversizedMetadata = invalid.filter((row) => row.metadata.length > 6000).map((row) => {
  const metadata = JSON.parse(row.metadata);
  return { total: row.metadata.length, content: String(metadata.content || "").length,
    schedule: String(metadata.schedule || "").length, recipients: String(metadata.recipients || "").length };
});
let detailSample = null;
if (process.argv.includes("--sample-details")) {
  const activeIds = new Set(active.map((item) => String(item.capacitacion_id)));
  const activeCourses = courses.filter((course) => activeIds.has(String(course.capacitacion_id)));
  const otherCourses = courses.filter((course) => !activeIds.has(String(course.capacitacion_id)));
  const spaced = Array.from({ length: Math.min(7, otherCourses.length) }, (_, index) =>
    otherCourses[Math.floor(index * (otherCourses.length - 1) / Math.max(1, Math.min(7, otherCourses.length) - 1))]);
  detailSample = { requests: 0, active: {}, other: {} };
  for (const [group, selected] of [["active", activeCourses.slice(0, 3)], ["other", spaced]]) {
    for (const course of selected) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      let outcome;
      try {
        const response = await fetch("https://apicapacitaciones.educaciontuc.edu.ar/api/capa/getCupo", {
          method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ token: course.token, slug: course.slug }), signal: AbortSignal.timeout(20_000),
        });
        detailSample.requests++;
        if (!response.ok) outcome = `HTTP_${response.status}`;
        else {
          try { outcome = Array.isArray((await response.json())?.comisiones) ? "VALID_SCHEMA" : "OTHER_SCHEMA"; }
          catch { outcome = "INVALID_JSON"; }
        }
      } catch { outcome = "NETWORK_OR_TIMEOUT"; }
      detailSample[group][outcome] = (detailSample[group][outcome] || 0) + 1;
    }
  }
}
console.log(JSON.stringify({ requests: 2, courses: courses.length, activeCommissions: active.length,
  activeWithoutCourse: active.filter((item) => !ids.has(String(item.capacitacion_id))).length,
  coursesWithoutTokenOrSlug: courses.filter((item) => !item.token || !item.slug).length,
  preparedFromLists: rows.length, rejectedByImporter: invalid.length,
  rejectedCourseRows: invalid.filter((row) => row.id.startsWith("fdci:course:")).length,
  rejectedActiveCommissionRows: invalid.filter((row) => row.id.startsWith("fdci:commission:")).length,
  reasons, oversizedMetadata, detailSample }));
