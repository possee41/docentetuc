// FDCI-only release: bundled from validated sources at 87b8efcf0d69537c1ba8730cd1ecebd4039198ac.
// No SIME/Juntas code; no dependencies or installation required. See RELEASE.md.

// scripts/import-gate.mjs
import { pathToFileURL as pathToFileURL3 } from "node:url";
import { execFileSync as execFileSync2 } from "node:child_process";

// scripts/import-via-gateway.mjs
import { execFileSync } from "node:child_process";
import { pathToFileURL as pathToFileURL2 } from "node:url";

// lib/circuits.ts
var TUCUMAN_CIRCUITS = [
  { id: "I", departments: ["Burruyac\xFA", "Cruz Alta", "Leales"] },
  { id: "II", departments: ["Capital", "San Miguel de Tucum\xE1n"] },
  { id: "III", departments: ["Trancas", "Yerba Buena", "Taf\xED Viejo", "Lules"] },
  { id: "IV", departments: ["Taf\xED del Valle", "Famaill\xE1", "Monteros", "Simoca"] },
  { id: "V", departments: ["Chicligasta", "R\xEDo Chico", "Juan Bautista Alberdi", "La Cocha", "Graneros"] }
];
var normalize = (value = "") => value.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
var circuitNumber = { i: "I", ii: "II", iii: "III", iv: "IV", v: "V", "1": "I", "2": "II", "3": "III", "4": "IV", "5": "V" };
var containsPhrase = (text2, phrase) => ` ${text2} `.includes(` ${normalize(phrase)} `);
function explicitCircuits(value) {
  const text2 = normalize(value), found = /* @__PURE__ */ new Set();
  const token = "(?:iv|iii|ii|i|v|[1-5])";
  const bareCircuitList = new RegExp(`^${token}(?:\\s*(?:,|y|e|;|\xB7)\\s*${token})*$`);
  const circuitLists = new RegExp(`\\bcircuit(?:o|os)\\s+(${token}(?:\\s*(?:,|y|e)\\s*${token})*)`, "g");
  if (bareCircuitList.test(text2)) {
    for (const item of text2.match(/iv|iii|ii|i|v|[1-5]/g) || []) {
      const id2 = circuitNumber[item];
      if (id2) found.add(id2);
    }
  }
  for (const match of text2.matchAll(circuitLists)) {
    for (const item of match[1].match(/iv|iii|ii|i|v|[1-5]/g) || []) {
      const id2 = circuitNumber[item];
      if (id2) found.add(id2);
    }
  }
  return [...found];
}
function departmentsIn(value) {
  const text2 = normalize(value), found = /* @__PURE__ */ new Set();
  for (const circuit of TUCUMAN_CIRCUITS) {
    if (circuit.departments.some((department) => containsPhrase(text2, department))) found.add(circuit.id);
  }
  return [...found];
}
var result = (sourceCircuitRaw, circuits, circuitInferenceSource) => ({
  sourceCircuitRaw,
  normalizedCircuit: circuits.length === 0 ? "UNKNOWN" : circuits.length === 1 ? circuits[0] : "MULTIPLE",
  circuits,
  circuitInferenceSource,
  circuitConfidence: circuitInferenceSource === "explicit" ? 100 : circuitInferenceSource === "department" ? 90 : circuitInferenceSource === "locality" ? 75 : 0
});
function inferCircuit(input) {
  const explicit = input.explicit?.trim() || "";
  const rawCircuits = explicitCircuits(explicit);
  if (rawCircuits.length) return result(explicit, rawCircuits, "explicit");
  if (/\b(todos? los circuitos|toda la provincia|provincial|para toda la provincia)\b/.test(normalize(explicit))) return { sourceCircuitRaw: explicit, normalizedCircuit: "ALL", circuits: [], circuitInferenceSource: "explicit", circuitConfidence: 100 };
  const department = input.department?.trim() || "";
  const fromDepartment = departmentsIn(department);
  if (fromDepartment.length) return result(department, fromDepartment, "department");
  const locality = input.locality?.trim() || "";
  const fromLocality = departmentsIn(locality);
  if (fromLocality.length) return result(locality, fromLocality, "locality");
  return result(explicit || department || locality, [], "unknown");
}

// lib/publication-lifecycle.ts
function publicationLifecycle(input) {
  const normalized = String(input.normalizedStatus || "").toUpperCase();
  const source = String(input.sourceStatus || "").toLowerCase();
  if (normalized === "REMOVED_FROM_SOURCE" || source === "removed_from_source") return "REMOVED_FROM_SOURCE";
  const now = (input.now || /* @__PURE__ */ new Date()).getTime();
  const dateStatus = String(input.dateStatus || "").toLowerCase();
  const certainDate = ["confirmed", "course_confirmed"].includes(dateStatus);
  if (dateStatus !== "tentative" && input.sourceStatusIsExplicit && /cerrad|finaliz|vencid|expired|closed/i.test(source)) return "CLOSED";
  if (dateStatus === "tentative" && input.sourceStatusIsExplicit && /abiert/i.test(source) && input.registrationOpenAt && Date.parse(input.registrationOpenAt) <= now && input.registrationCloseAt && Date.parse(input.registrationCloseAt) >= now) return "ACTIVE";
  if (["tentative", "general_window", "unknown"].includes(dateStatus)) return "UNKNOWN";
  const expiry = input.expiresAt ? Date.parse(input.expiresAt) : Number.NaN;
  if (Number.isFinite(expiry) && expiry < now) return "EXPIRED";
  const close = input.registrationCloseAt ? Date.parse(input.registrationCloseAt) : Number.NaN;
  if (Number.isFinite(close) && close < now) return "CLOSED";
  const open = input.registrationOpenAt ? Date.parse(input.registrationOpenAt) : Number.NaN;
  if (Number.isFinite(open) && open > now && certainDate) return "UPCOMING";
  if (input.sourceStatusIsExplicit && /abiert|vigente|active|verificado/i.test(source)) return "ACTIVE";
  if (normalized === "ACTIVE" || normalized === "UPCOMING" || normalized === "CLOSED" || normalized === "EXPIRED") return normalized;
  return "UNKNOWN";
}

// lib/sync-diff.ts
async function hashSourceSnapshot(sourceData, derivedMetadata) {
  const payload = new TextEncoder().encode(JSON.stringify({ sourceData, derivedMetadata }));
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// lib/training.ts
var text = (value) => value == null ? "" : String(value);
var number = (value) => value == null || value === "" || Number.isNaN(Number(value)) ? void 0 : Number(value);
var localDateTime = (value, endOfDay = false) => {
  const raw = text(value).trim();
  if (!raw) return void 0;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T${endOfDay ? "23:59:59" : "00:00:00"}-03:00` : `${raw.replace(" ", "T")}${/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw) ? "" : "-03:00"}`;
  return Number.isFinite(Date.parse(normalized)) ? normalized : void 0;
};
var plainText = (value) => text(value).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&#(x[0-9a-f]+|\d+);/gi, (_match, digits) => {
  const point = Number.parseInt(digits[0].toLowerCase() === "x" ? digits.slice(1) : digits, digits[0].toLowerCase() === "x" ? 16 : 10);
  return point > 0 && point <= 1114111 ? String.fromCodePoint(point) : "";
}).replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
function trainingStatus(commission, now = /* @__PURE__ */ new Date()) {
  if (!commission) return "consultar";
  const time = now.getTime();
  const opens = localDateTime(commission.fecha_apertura_preinscripcion);
  const closes = localDateTime(commission.fecha_cierre_preinscripcion, true);
  const starts = localDateTime(commission.fecha_inicio);
  const finishes = localDateTime(commission.fecha_fin, true);
  const closed = Boolean(Number(commission.comision_cerrada));
  if (closed) return "inscripci\xF3n cerrada";
  if (opens && commission.isActivePre != null && !Boolean(Number(commission.isActivePre))) return "inscripci\xF3n cerrada";
  if (opens && time < new Date(opens).getTime()) return "pr\xF3ximamente";
  if (closes && time > new Date(closes).getTime()) return "inscripci\xF3n cerrada";
  if (opens && (closes || Boolean(Number(commission.isActivePre)))) return "inscripci\xF3n abierta";
  if (starts && time < new Date(starts).getTime()) return "consultar";
  if (starts && finishes && time <= new Date(finishes).getTime()) return "en curso";
  if (finishes && time > new Date(finishes).getTime()) return "finalizada";
  return "consultar";
}
function opportunity(course, commission, now = /* @__PURE__ */ new Date()) {
  const trainingId = text(commission?.capacitacion_id || course.capacitacion_id);
  const commissionId = commission?.id == null ? "" : text(commission.id);
  const token = text(course.token || commission?.token), slug = text(course.slug || commission?.slug);
  const rawOpening = commission?.fecha_apertura_preinscripcion;
  const registrationOpensAt = localDateTime(rawOpening);
  const registrationHasTime = /\d{1,2}:\d{2}/.test(text(rawOpening));
  const registrationClosesAt = localDateTime(commission?.fecha_cierre_preinscripcion, true);
  const courseStartsAt = localDateTime(commission?.fecha_inicio);
  const courseEndsAt = localDateTime(commission?.fecha_fin, true);
  const dateStatus = registrationOpensAt || registrationClosesAt ? "confirmed" : courseStartsAt || courseEndsAt ? "course_confirmed" : "unknown";
  const description = plainText(course.descripcion || commission?.descripcion);
  const content = plainText(course.contenido || commission?.contenido);
  const statedRecipients = description.match(/destinatarios\s*:\s*([^.]*)/i)?.[1]?.trim();
  const officialUrl = token && slug ? `https://capacitaciondocente.educaciontuc.gov.ar/capacitaciones/${token}/${slug}${commissionId ? `/${commissionId}` : ""}` : "https://capacitaciondocente.educaciontuc.gov.ar/capacitaciones";
  return {
    id: commissionId ? `fdci:commission:${commissionId}` : `fdci:course:${trainingId}`,
    externalId: commissionId || trainingId,
    title: text(course.nombre || commission?.nombre || "Capacitaci\xF3n docente"),
    summary: (description || content).slice(0, 2e3),
    level: text(course.niveles),
    area: text(course.areas || course.eje_prioritario),
    location: text(commission?.lugar),
    modality: text(course.modalidad || commission?.modalidad),
    startsAt: courseStartsAt || null,
    endsAt: registrationClosesAt || null,
    status: trainingStatus(commission, now),
    officialUrl,
    sourceUpdatedAt: text(commission?.updated_at) || null,
    metadata: {
      entity: commissionId ? "commission" : "course",
      trainingId,
      ...commissionId ? { commissionId } : {},
      ...registrationOpensAt ? { registrationOpensAt, registrationHasTime } : {},
      ...registrationClosesAt ? { registrationClosesAt } : {},
      preinscripcionFechaConfirmada: Boolean(registrationOpensAt),
      ...courseStartsAt ? { courseStartsAt } : {},
      ...courseEndsAt ? { courseEndsAt } : {},
      source: "FDCI Tucum\xE1n",
      sourceUrl: officialUrl,
      dateStatus,
      ...commission?.direccion ? { address: text(commission.direccion) } : {},
      ...number(commission?.cupo) != null ? { capacity: number(commission?.cupo) } : {},
      ...number(commission?.cupo_preinscripcion) != null ? { preCapacity: number(commission?.cupo_preinscripcion) } : {},
      ...number(commission?.cupo_disponible_pre) != null ? { availablePreCapacity: number(commission?.cupo_disponible_pre) } : {},
      ...number(course.horas_catedra) != null ? { hours: number(course.horas_catedra) } : {},
      ...number(commission?.cantidad_encuentros) != null ? { meetings: number(commission?.cantidad_encuentros) } : {},
      ...statedRecipients || [course.cargos, course.niveles, course.areas].filter(Boolean).length ? { recipients: statedRecipients || [course.cargos, course.niveles, course.areas].filter(Boolean).map(text).join(" \xB7 ") } : {},
      ...commission?.cronograma ? { schedule: plainText(commission.cronograma) } : {},
      ...content ? { content } : {},
      ...course.nombre_direccion || commission?.nombre_direccion ? { organization: text(course.nombre_direccion || commission?.nombre_direccion) } : {}
    },
    raw: { course, ...commission ? { commission } : {} }
  };
}
function mergeTrainingData(courses, commissions, now = /* @__PURE__ */ new Date()) {
  const byTraining = /* @__PURE__ */ new Map();
  for (const commission of commissions) {
    const id2 = text(commission.capacitacion_id);
    if (!id2) continue;
    byTraining.set(id2, [...byTraining.get(id2) || [], commission]);
  }
  const courseIds = new Set(courses.map((course) => text(course.capacitacion_id)));
  const result2 = courses.flatMap((course) => {
    const linked = byTraining.get(text(course.capacitacion_id)) || [];
    return linked.length ? linked.map((commission) => opportunity(course, commission, now)) : [opportunity(course, void 0, now)];
  });
  for (const commission of commissions) if (!courseIds.has(text(commission.capacitacion_id))) result2.push(opportunity(commission, commission, now));
  return [...new Map(result2.map((item) => [item.id, item])).values()];
}

// lib/fdci-import.ts
var FDCI_METADATA_LIMIT = 6e3;
function serializeFdciMetadata(value) {
  const full = JSON.stringify(value);
  if (full.length <= FDCI_METADATA_LIMIT || !value.content) return full;
  let lower = 0, upper = value.content.length, best = "";
  while (lower <= upper) {
    const middle = Math.floor((lower + upper) / 2);
    const candidate = JSON.stringify({ ...value, content: `${value.content.slice(0, middle)}\u2026` });
    if (candidate.length <= FDCI_METADATA_LIMIT) {
      best = candidate;
      lower = middle + 1;
    } else upper = middle - 1;
  }
  return best || full;
}
async function prepareFdciImports(courses, commissions, now = /* @__PURE__ */ new Date()) {
  return Promise.all(mergeTrainingData(courses, commissions, now).map(async (item) => {
    const metadata = serializeFdciMetadata(item.metadata);
    const inferred = inferCircuit({ locality: item.location });
    const sourceHash = await hashSourceSnapshot(item.raw, { metadata: item.metadata, status: item.status, startsAt: item.startsAt, endsAt: item.endsAt });
    const contentHash = await hashSourceSnapshot(sourceHash, { circuit: inferred.normalizedCircuit, raw: inferred.sourceCircuitRaw, via: inferred.circuitInferenceSource });
    const registrationOpenAt = item.metadata.registrationOpensAt || null;
    const registrationCloseAt = item.metadata.registrationClosesAt || null;
    const expiresAt = item.metadata.courseEndsAt || null;
    return {
      id: item.id,
      externalId: item.externalId,
      category: item.metadata.entity === "commission" ? `Comisi\xF3n #${item.metadata.commissionId}` : "Capacitaci\xF3n",
      title: item.title,
      summary: item.summary,
      level: item.level,
      area: item.area,
      location: item.location,
      character: item.modality,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      status: item.status,
      officialUrl: item.officialUrl,
      metadata,
      contentHash,
      sourceUpdatedAt: item.sourceUpdatedAt && Number.isFinite(Date.parse(item.sourceUpdatedAt)) ? item.sourceUpdatedAt : null,
      registrationOpenAt,
      registrationCloseAt,
      expiresAt,
      normalizedStatus: publicationLifecycle({ sourceStatus: item.status, sourceStatusIsExplicit: true, registrationOpenAt, registrationCloseAt, expiresAt, dateStatus: item.metadata.dateStatus, now }),
      circuit: inferred.normalizedCircuit,
      sourceCircuitRaw: inferred.sourceCircuitRaw,
      circuitInferenceSource: inferred.circuitInferenceSource,
      circuitConfidence: inferred.circuitConfidence
    };
  }));
}
var smallText = (value, max) => typeof value === "string" && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
var optionalDate = (value) => value === null || smallText(value, 40) && Number.isFinite(Date.parse(value));
function validFdciImport(value, onReject) {
  const reject = (reason) => {
    onReject?.(reason);
    return false;
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) return reject("record");
  const row = value;
  if (!/^fdci:(?:course|commission):[A-Za-z0-9_-]{1,80}$/.test(String(row.id)) || !smallText(row.externalId, 80)) return reject("identity");
  for (const [key, max] of Object.entries({ category: 120, title: 500, summary: 2e3, level: 300, area: 300, location: 300, character: 300, status: 100, metadata: 6e3, contentHash: 64, circuit: 20, sourceCircuitRaw: 300, circuitInferenceSource: 30 })) {
    if (!smallText(row[key], max)) return reject(`text:${key}`);
  }
  if (!/^[a-f0-9]{64}$/.test(String(row.contentHash))) return reject("hash");
  if (!["ACTIVE", "UPCOMING", "CLOSED", "EXPIRED", "UNKNOWN"].includes(String(row.normalizedStatus))) return reject("status");
  if (!["UNKNOWN", "I", "II", "III", "IV", "V", "ALL", "MULTIPLE"].includes(String(row.circuit))) return reject("circuit");
  if (!Number.isInteger(row.circuitConfidence) || Number(row.circuitConfidence) < 0 || Number(row.circuitConfidence) > 100) return reject("circuitConfidence");
  for (const key of ["startsAt", "endsAt", "sourceUpdatedAt", "registrationOpenAt", "registrationCloseAt", "expiresAt"])
    if (!optionalDate(row[key])) return reject(`date:${key}`);
  try {
    const url = new URL(String(row.officialUrl));
    if (url.protocol !== "https:" || url.hostname !== "capacitaciondocente.educaciontuc.gov.ar" || url.username || url.password) return reject("url");
    const metadata = JSON.parse(String(row.metadata));
    if (metadata.entity !== (String(row.id).startsWith("fdci:commission:") ? "commission" : "course") || !metadata.trainingId) return reject("metadata");
    if (metadata.entity === "commission" && String(metadata.commissionId) !== row.externalId) return reject("metadata");
  } catch {
    return reject("metadataOrUrl");
  }
  return true;
}

// scripts/import-fdci.mjs
import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
var FDCI = "https://apicapacitaciones.educaciontuc.edu.ar/api";
var pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function requestJson(url, options = {}, fetcher = fetch) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try {
      response = await fetcher(url, { ...options, signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(2e4)]) : AbortSignal.timeout(2e4) });
    } catch (error) {
      if (attempt === 2 || options.signal?.aborted || ["FDCI_PROBE_REQUEST_LIMIT", "FDCI_CANCELLED", "FDCI_SOURCE_FORBIDDEN"].includes(error?.message)) throw error;
      await pause(300 * 2 ** attempt);
      continue;
    }
    if (response.ok) return response.json();
    if (![500, 502, 503, 504].includes(response.status) || attempt === 2) throw new Error(`HTTP_${response.status}`);
    await pause(300 * 2 ** attempt);
  }
  throw new Error("REQUEST_FAILED");
}
async function collectFdci(fetcher = fetch, selection, scope = "full") {
  const active = await requestJson(`${FDCI}/gestionCapas/getCapaActivas`, {}, fetcher);
  const courses = await requestJson(`${FDCI}/gestionCapas/getRestoCapas`, {}, fetcher);
  if (!Array.isArray(active) || !Array.isArray(courses)) throw new Error("FDCI_SCHEMA_CHANGED");
  if (selection && (!/^[A-Za-z0-9_-]{1,80}$/.test(selection.token) || !/^[a-z0-9-]{1,160}$/.test(selection.slug) || !/^[0-9]{1,12}$/.test(selection.commissionId))) throw new Error("FDCI_SELECTION_INVALID");
  const activeIds = new Set(active.map((item) => String(item.capacitacion_id)));
  const activeCommissionIds = new Set(active.map((item) => String(item.id)));
  const candidates = selection ? courses.filter((item) => item.token === selection.token && item.slug === selection.slug) : scope === "active" ? courses.filter((item) => activeIds.has(String(item.capacitacion_id))) : courses;
  if (selection && candidates.length !== 1) throw new Error("FDCI_COURSE_NOT_FOUND");
  const commissions = selection ? active.filter((item) => String(item.id) === selection.commissionId && String(item.capacitacion_id) === String(candidates[0].capacitacion_id)) : [...active];
  const diagnostics = {
    orphanActive: (selection ? commissions : active).filter((item) => !courses.some((course) => String(course.capacitacion_id) === String(item.capacitacion_id))).length,
    missingTokenOrSlug: 0,
    http: {},
    timeoutOrNetwork: 0,
    invalidJson: 0,
    schema: 0,
    other: 0,
    activeDetailFailures: 0,
    requestLimit: 0
  };
  let failures = diagnostics.orphanActive;
  let coursesExamined = 0;
  for (const course of candidates) {
    coursesExamined++;
    if (!course.token || !course.slug) {
      failures++;
      diagnostics.missingTokenOrSlug++;
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
      if (message === "FDCI_PROBE_REQUEST_LIMIT") {
        diagnostics.requestLimit++;
        break;
      }
      if (message === "HTTP_429") {
        diagnostics.http.HTTP_429 = (diagnostics.http.HTTP_429 || 0) + 1;
        break;
      }
      if (/^HTTP_\d{3}$/.test(message)) diagnostics.http[message] = (diagnostics.http[message] || 0) + 1;
      else if (message === "FDCI_DETAIL_SCHEMA_CHANGED") diagnostics.schema++;
      else if (error instanceof SyntaxError) diagnostics.invalidJson++;
      else if (error instanceof Error && /timeout|abort|fetch failed/i.test(`${error.name} ${message}`)) diagnostics.timeoutOrNetwork++;
      else diagnostics.other++;
    }
  }
  const items = await prepareFdciImports(candidates, commissions);
  if (selection && !items.some((item) => item.id === `fdci:commission:${selection.commissionId}`)) throw new Error("FDCI_COMMISSION_NOT_FOUND");
  return {
    items: selection ? items.filter((item) => item.id === `fdci:commission:${selection.commissionId}`) : scope === "active" ? items.filter((item) => activeCommissionIds.has(item.externalId)) : items,
    failures,
    diagnostics,
    coursesFetched: coursesExamined,
    coursesAvailable: candidates.length,
    commissionsExamined: new Set(commissions.map((item) => String(item.id))).size,
    activeCommissions: active.length
  };
}
async function sendFdci(url, token, payload, fetcher = fetch, owner = "") {
  let response;
  try {
    response = await fetcher(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(2e4),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...owner ? { "x-import-gate-owner": owner } : {}
      },
      body: JSON.stringify(payload)
    });
  } catch {
    throw new Error("IMPORT_RESULT_UNCERTAIN");
  }
  if (!response.ok) throw new Error(response.status >= 500 ? "IMPORT_RESULT_UNCERTAIN" : `HTTP_${response.status}`);
  let result2;
  try {
    result2 = await response.json();
  } catch {
    throw new Error("IMPORT_RESULT_UNCERTAIN");
  }
  if (result2?.ok !== true || result2.received !== payload.items.length || ![result2.created, result2.updated, result2.unchanged].every((n) => Number.isSafeInteger(n) && n >= 0) || result2.created + result2.updated + result2.unchanged !== result2.received) throw new Error("IMPORT_ACK_INVALID");
  return result2;
}
async function runFdciImport({ endpoint, token, fetcher = fetch, collect = collectFdci, selection = (
  /** @type {{token: string, slug: string, commissionId: string} | undefined} */
  void 0
), scope = "single", safety = (
  /** @type {{maxPublications: number} | undefined} */
  void 0
), owner = "" }) {
  let target;
  try {
    target = new URL(endpoint);
  } catch {
    throw new Error("IMPORT_CONFIGURATION_INVALID");
  }
  if (target.protocol !== "https:" && !(target.protocol === "http:" && target.hostname === "127.0.0.1") || !/^[A-Za-z0-9_-]{32,}$/.test(token)) throw new Error("IMPORT_CONFIGURATION_INVALID");
  if (!["single", "active", "full"].includes(scope) || scope === "single" !== Boolean(selection)) throw new Error("FDCI_SELECTION_INVALID");
  if (selection && (!/^[A-Za-z0-9_-]{1,80}$/.test(selection.token) || !/^[a-z0-9-]{1,160}$/.test(selection.slug) || !/^[0-9]{1,12}$/.test(selection.commissionId))) throw new Error("FDCI_SELECTION_INVALID");
  let created = 0, updated = 0, unchanged = 0, batches = 0, rejected = 0;
  const rejectedReasons = {}, rejectedStatuses = {};
  const count = (target2, key) => {
    target2[key] = (target2[key] || 0) + 1;
  };
  let discovered = 0, skipped = 0, deferred = 0, uncertain = 0;
  const snapshot = () => ({ discovered, created, updated, unchanged, rejected, skipped, deferred, uncertain, batches, completed: false });
  try {
    const { items, failures, diagnostics, coursesFetched, coursesAvailable, commissionsExamined, activeCommissions } = await collect(fetcher, selection, scope);
    discovered = items?.length || 0;
    if (!Array.isArray(items) || scope === "single" && !items.length) throw new Error("FDCI_EMPTY_RESPONSE");
    if (failures && scope !== "full" || scope === "single" && (items.length !== 1 || items[0].id !== `fdci:commission:${selection.commissionId}`)) {
      const error = new Error("FDCI_SELECTION_INCOMPLETE");
      error.diagnostics = diagnostics;
      throw error;
    }
    for (const item of items) {
      if (safety && (item.id === "fdci:commission:6375" || !item.id.startsWith("fdci:commission:") || item.normalizedStatus === "UNKNOWN")) {
        skipped++;
        continue;
      }
      if (safety && batches + rejected >= safety.maxPublications) {
        deferred++;
        continue;
      }
      if ((safety || scope === "full") && !validFdciImport(item, (reason) => count(rejectedReasons, reason))) {
        rejected++;
        count(rejectedStatuses, item.normalizedStatus || "UNKNOWN");
        continue;
      }
      let result2;
      try {
        result2 = await sendFdci(endpoint, token, { mode: "batch", items: [item] }, fetcher, owner);
      } catch (error) {
        if ((scope === "full" || safety) && error instanceof Error && ["HTTP_400", "HTTP_422"].includes(error.message)) {
          rejected++;
          count(rejectedReasons, error.message === "HTTP_422" ? "protectedExistingRecord" : "receiverHttp400");
          count(rejectedStatuses, item.normalizedStatus || "UNKNOWN");
          continue;
        }
        if (["IMPORT_RESULT_UNCERTAIN", "IMPORT_ACK_INVALID"].includes(error?.message)) uncertain++;
        throw error;
      }
      if (!result2.ok || result2.received !== 1) throw new Error("IMPORT_ACK_INVALID");
      created += result2.created;
      updated += result2.updated;
      unchanged += result2.unchanged;
      batches++;
    }
    if (failures || rejected || skipped || deferred) {
      const error = new Error("FDCI_PARTIAL_SOURCE");
      error.failures = failures + rejected;
      error.diagnostics = { ...diagnostics, rejected, rejectedReasons, rejectedStatuses };
      error.result = { ...snapshot(), coursesFetched, coursesAvailable, commissionsExamined, activeCommissions };
      throw error;
    }
    return { ...snapshot(), coursesFetched, coursesAvailable, commissionsExamined, activeCommissions, completed: scope === "full" };
  } catch (error) {
    error.result ||= snapshot();
    error.diagnostics ||= { rejectedReasons, rejectedStatuses };
    throw error;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  const summarize = async (status, details) => {
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `### FDCI: ${status}

- \xDAltimo intento: ${startedAt}
- ${details}

`
    );
  };
  try {
    const scope = process.env.FDCI_SCOPE || "single";
    const selection = scope === "single" ? { token: process.env.FDCI_COURSE_TOKEN || "", slug: process.env.FDCI_COURSE_SLUG || "", commissionId: process.env.FDCI_COMMISSION_ID || "" } : void 0;
    const result2 = await runFdciImport({ endpoint: process.env.FDCI_IMPORT_URL || "", token: process.env.FDCI_IMPORT_SECRET || "", selection, scope });
    console.log(JSON.stringify({ ...result2, startedAt, finishedAt: (/* @__PURE__ */ new Date()).toISOString() }));
    await summarize("\xE9xito", `\xDAltimo \xE9xito: ${(/* @__PURE__ */ new Date()).toISOString()}; nuevas: ${result2.created}; actualizadas: ${result2.updated}; sin cambios: ${result2.unchanged}`);
  } catch (error) {
    const code = error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, "[url]") : "unknown";
    console.error("FDCI_IMPORT_FAILED", code);
    await summarize("fall\xF3", `Error: ${code}`);
    process.exitCode = 1;
  }
}

// scripts/fdci-incremental.mjs
var root = "https://apicapacitaciones.educaciontuc.edu.ar/api";
var id = (value) => /^[1-9]\d{0,11}$/.test(String(value));
var fdciKey = (course, commission) => {
  if (!id(course) || !id(commission)) throw new Error("FDCI_SCHEMA_CHANGED");
  return `${String(course).padStart(12, "0")}:${String(commission).padStart(12, "0")}`;
};
async function checkpointRequest(target, owner, payload, fetcher) {
  let response;
  try {
    response = await fetcher(`${target.origin}/api/internal/fdci-checkpoint`, {
      method: "POST",
      redirect: "error",
      headers: { authorization: `Bearer ${target.secret}`, "content-type": "application/json", "x-import-gate-owner": owner },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(2e4)
    });
  } catch {
    throw new Error("FDCI_CHECKPOINT_UNCERTAIN");
  }
  if (!response.ok) throw new Error(response.status >= 500 ? "FDCI_CHECKPOINT_UNCERTAIN" : `FDCI_CHECKPOINT_HTTP_${response.status}`);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("FDCI_CHECKPOINT_UNCERTAIN");
  }
  const state = body?.state;
  if (!body?.ok || !state || state.id !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0 || !Number.isSafeInteger(state.cycle) || state.cycle < 1 || !Number.isSafeInteger(state.failures) || state.failures < 0 || ![state.after_key, state.upper_key].every((k) => k === "" || typeof k === "string" && /^\d{12}:\d{12}$/.test(k)) || payload.op !== "get" && state.revision !== payload.revision + 1 || payload.op === "advance" && state.after_key !== payload.after || payload.op === "start" && state.upper_key !== payload.upper || payload.op === "finish" && (state.upper_key !== "" || state.after_key !== "")) throw new Error("FDCI_CHECKPOINT_ACK_INVALID");
  return state;
}
async function runIncrementalFdci(target, safety, fetcher) {
  let state, examined = 0, created = 0, updated = 0, unchanged = 0, rejected = 0, skipped = 0, batches = 0;
  let discovered = 0, coursesAvailable = 0, coursesFetched = 0, cycleComplete = false;
  const errors = [], sourceErrors = {};
  const snapshot = () => ({
    discovered,
    examined,
    created,
    updated,
    unchanged,
    rejected,
    skipped,
    batches,
    coursesFetched,
    coursesAvailable,
    commissionsExamined: examined,
    completed: false,
    cycleComplete,
    cursor: state,
    sourceErrors,
    errors
  });
  const checkpoint = async (payload) => {
    state = await checkpointRequest(target, safety.owner, payload, fetcher);
  };
  const advance = async (key, failed = false, code = null) => checkpoint({ op: "advance", revision: state.revision, after: key, failed, code });
  try {
    await checkpoint({ op: "get" });
    const active = await requestJson(`${root}/gestionCapas/getCapaActivas`, {}, fetcher);
    const courses = await requestJson(`${root}/gestionCapas/getRestoCapas`, {}, fetcher);
    if (!Array.isArray(active) || !Array.isArray(courses)) throw new Error("FDCI_SCHEMA_CHANGED");
    const keyed = /* @__PURE__ */ new Map(), ids = /* @__PURE__ */ new Map();
    for (const item of active) {
      if (!item || typeof item !== "object") throw new Error("FDCI_SCHEMA_CHANGED");
      const key = fdciKey(item.capacitacion_id, item.id);
      if (ids.has(String(item.id)) && ids.get(String(item.id)) !== key) throw new Error("FDCI_SCHEMA_CHANGED");
      ids.set(String(item.id), key);
      keyed.set(key, item);
    }
    const entries = [...keyed].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    discovered = entries.length;
    const activeCourses = new Set(entries.map(([, c]) => String(c.capacitacion_id)));
    coursesAvailable = activeCourses.size;
    const parents = /* @__PURE__ */ new Map();
    for (const course of courses) {
      if (!course || !activeCourses.has(String(course.capacitacion_id))) continue;
      if (parents.has(String(course.capacitacion_id))) throw new Error("FDCI_SCHEMA_CHANGED");
      parents.set(String(course.capacitacion_id), course);
    }
    if (!entries.length) return {
      ...snapshot(),
      ...state.upper_key ? { code: "FDCI_EMPTY_RESPONSE" } : {},
      status: state.upper_key ? "PARTIAL" : "OK",
      failed: Boolean(state.upper_key),
      empty: true,
      progressPending: false
    };
    if (!state.upper_key) await checkpoint({ op: "start", revision: state.revision, upper: entries.at(-1)[0] });
    const pending = entries.filter(([key]) => key > state.after_key && key <= state.upper_key);
    const details = /* @__PURE__ */ new Map();
    let budgetStop = false;
    for (const [key, commission] of pending) {
      if (examined >= safety.maxPublications) break;
      const courseId = String(commission.capacitacion_id);
      if (String(commission.id) === "6375") {
        examined++;
        skipped++;
        await advance(key);
        continue;
      }
      let item;
      try {
        const course = parents.get(courseId);
        if (!course || !/^[A-Za-z0-9_-]{1,80}$/.test(course.token || "") || !/^[a-z0-9-]{1,160}$/.test(course.slug || ""))
          throw new Error("FDCI_COURSE_UNAVAILABLE");
        if (!details.has(courseId)) {
          coursesFetched++;
          try {
            const detail2 = await requestJson(`${root}/capa/getCupo`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token: course.token, slug: course.slug })
            }, fetcher);
            if (!Array.isArray(detail2?.comisiones)) throw new Error("FDCI_DETAIL_SCHEMA_CHANGED");
            details.set(courseId, detail2.comisiones);
          } catch (error) {
            details.set(courseId, error);
          }
        }
        const detail = details.get(courseId);
        if (detail instanceof Error) throw detail;
        const matches = detail.filter((c) => String(c.id) === String(commission.id) && String(c.capacitacion_id) === courseId);
        if (matches.length !== 1) throw new Error("FDCI_COMMISSION_UNAVAILABLE");
        [item] = await prepareFdciImports([course], matches);
        if (!item || item.normalizedStatus === "UNKNOWN") item = null;
        else if (!validFdciImport(item)) throw new Error("FDCI_RECORD_INVALID");
      } catch (error) {
        if (["FDCI_PROBE_REQUEST_LIMIT", "HTTP_429", "FDCI_CANCELLED"].includes(error.message)) {
          sourceErrors[error.message === "FDCI_PROBE_REQUEST_LIMIT" ? "requestLimit" : error.message] = 1;
          budgetStop = true;
          break;
        }
        const code = /^FDCI_[A-Z_]+$/.test(error.message) ? error.message : /^HTTP_\d{3}$/.test(error.message) ? `FDCI_${error.message}` : error instanceof SyntaxError ? "FDCI_INVALID_JSON" : "FDCI_NETWORK_ERROR";
        examined++;
        rejected++;
        errors.push({ key, code });
        await advance(key, true, code);
        continue;
      }
      if (!item) {
        examined++;
        skipped++;
        await advance(key);
        continue;
      }
      examined++;
      let ack;
      try {
        ack = await sendFdci(target.endpoint, target.secret, { mode: "batch", items: [item] }, fetcher, safety.owner);
      } catch (error) {
        if (error.message === "HTTP_422") {
          skipped++;
          await advance(key);
          continue;
        }
        throw error;
      }
      created += ack.created;
      updated += ack.updated;
      unchanged += ack.unchanged;
      batches++;
      await advance(key);
    }
    const failed = state.failures > 0 || rejected > 0 || Object.keys(sourceErrors).some((k) => k !== "requestLimit");
    if (!budgetStop && !entries.some(([key]) => key > state.after_key && key <= state.upper_key)) {
      await checkpoint({ op: "finish", revision: state.revision });
      cycleComplete = true;
    }
    return {
      ...snapshot(),
      status: failed || !cycleComplete ? "PARTIAL" : "OK",
      failed,
      progressPending: !cycleComplete,
      deferred: entries.filter(([key]) => !cycleComplete && key > state.after_key && key <= state.upper_key).length
    };
  } catch (error) {
    error.result = { ...snapshot(), uncertain: ["IMPORT_RESULT_UNCERTAIN", "IMPORT_ACK_INVALID"].includes(error.message) ? 1 : 0 };
    throw error;
  }
}

// scripts/import-via-gateway.mjs
var productionId = "baaf5886-0123-4948-96da-aa7106424549";
var paths = {
  fdci: "/api/internal/fdci-import",
  sime: "/api/internal/sime-import",
  juntas: "/api/internal/public-source-import/juntas",
  cenet: "/api/internal/public-source-import/cenet",
  infd: "/api/internal/public-source-import/infd"
};
function resolveGatewayConfig(config, revision = "") {
  if (config.SYNC_SOURCE !== "fdci") throw new Error("GATEWAY_SOURCE_INVALID");
  const source = config.SYNC_SOURCE, path = typeof source === "string" && Object.hasOwn(paths, source) ? paths[source] : null;
  if (!path) throw new Error("GATEWAY_SOURCE_INVALID");
  let origin;
  try {
    origin = new URL(config.IMPORT_GATEWAY_ORIGIN);
  } catch {
    throw new Error("GATEWAY_CONFIG_INVALID");
  }
  if (origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password || !(origin.protocol === "https:" && /^docentetuc-import-(?:canary-1-2|1-2)\.[a-z0-9-]+\.workers\.dev$/.test(origin.hostname) || origin.protocol === "http:" && origin.hostname === "127.0.0.1")) throw new Error("GATEWAY_CONFIG_INVALID");
  const target = config.IMPORT_GATEWAY_TARGET || "canary";
  const id2 = config.IMPORT_GATEWAY_DATABASE_ID, name = config.IMPORT_GATEWAY_DATABASE_NAME;
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id2 || "") || !name)
    throw new Error("GATEWAY_CONFIG_INVALID");
  if (target === "canary") {
    if (id2 === productionId || !/^docentetuc-[a-z0-9-]*canary[a-z0-9-]*$/.test(name) || origin.protocol !== "http:" && !origin.hostname.startsWith("docentetuc-import-canary-1-2."))
      throw new Error("GATEWAY_TARGET_FORBIDDEN");
  } else if (target !== "production" || id2 !== productionId || name !== "docentetuc-db" || origin.protocol !== "https:" || !origin.hostname.startsWith("docentetuc-import-1-2.") || config.IMPORT_GATEWAY_PRODUCTION_ENABLED !== "true" || !/^[a-f0-9]{40}$/i.test(config.IMPORT_GATEWAY_APPROVED_SHA || "") || config.IMPORT_GATEWAY_APPROVED_SHA.toLowerCase() !== revision.toLowerCase())
    throw new Error("GATEWAY_PRODUCTION_NOT_APPROVED");
  const secret = config[`${source.toUpperCase()}_IMPORT_SECRET`];
  if (!/^[A-Za-z0-9_-]{32,}$/.test(secret || "")) throw new Error("GATEWAY_SECRET_INVALID");
  return { source, endpoint: new URL(path, origin).toString(), origin: origin.origin, id: id2, name, secret };
}
async function verifyGatewayIdentity(target, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(
      `${target.origin}/api/internal/import-identity?source=${target.source}`,
      { headers: { Authorization: `Bearer ${target.secret}` }, redirect: "error", signal: AbortSignal.timeout(2e4) }
    );
  } catch {
    throw new Error("GATEWAY_IDENTITY_UNAVAILABLE");
  }
  if (!response.ok) throw new Error(`GATEWAY_IDENTITY_HTTP_${response.status}`);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("GATEWAY_IDENTITY_INVALID");
  }
  if (body?.id !== target.id || body?.name !== target.name) throw new Error("GATEWAY_IDENTITY_MISMATCH");
}
async function runGatewayImport(target, config, sourceFetch = fetch, receiverFetch = fetch) {
  const safety = target.source === "fdci" ? fdciSafety(config) : null;
  await verifyGatewayIdentity(target, receiverFetch);
  if (target.source === "fdci") {
    let requests = 0;
    const started = Date.now();
    const fetcher = async (url, init) => {
      const parsed = new URL(url);
      if (parsed.origin === target.origin) return receiverFetch(url, init);
      if (parsed.origin !== "https://apicapacitaciones.educaciontuc.edu.ar" || ![
        "/api/gestionCapas/getCapaActivas",
        "/api/gestionCapas/getRestoCapas",
        "/api/capa/getCupo"
      ].includes(parsed.pathname) || parsed.search || parsed.username || parsed.password) throw new Error("FDCI_SOURCE_FORBIDDEN");
      if (requests >= safety.maxRequests) throw new Error("FDCI_PROBE_REQUEST_LIMIT");
      if (requests) await new Promise((resolve, reject) => {
        const finish = () => {
          init?.signal?.removeEventListener("abort", abort);
          resolve();
        };
        const timer = setTimeout(finish, safety.pauseMs);
        const abort = () => {
          clearTimeout(timer);
          init.signal.removeEventListener("abort", abort);
          reject(new Error("FDCI_CANCELLED"));
        };
        if (init?.signal?.aborted) abort();
        else init?.signal?.addEventListener("abort", abort, { once: true });
      });
      requests++;
      return sourceFetch(url, { ...init, redirect: "error" });
    };
    try {
      return { ...await runIncrementalFdci(target, safety, fetcher), sourceRequests: requests, elapsedMs: Date.now() - started };
    } catch (error) {
      error.result = { ...error.result, sourceRequests: requests, elapsedMs: Date.now() - started };
      throw error;
    }
  }
  throw new Error("GATEWAY_SOURCE_INVALID");
}
function fdciSafety(config) {
  if (config.FDCI_SCOPE !== "active") throw new Error("FDCI_ACTIVE_SCOPE_REQUIRED");
  const owner = config.IMPORT_GATE_RUN_ID || (config.GITHUB_RUN_ID ? `${config.GITHUB_RUN_ID}-${config.GITHUB_RUN_ATTEMPT || "1"}` : "");
  if (!/^[A-Za-z0-9_:-]{1,100}$/.test(owner)) throw new Error("GATE_RUN_ID_REQUIRED");
  const maxRequests = Number(config.FDCI_MAX_REQUESTS || 6);
  const maxPublications = Number(config.FDCI_MAX_PUBLICATIONS || 5);
  const pauseMs = Number(config.FDCI_PAUSE_MS || 400);
  if (!Number.isInteger(maxRequests) || maxRequests < 2 || maxRequests > 6 || !Number.isInteger(maxPublications) || maxPublications < 1 || maxPublications > 5 || !Number.isInteger(pauseMs) || pauseMs < 400 || pauseMs > 1e3) throw new Error("FDCI_BUDGET_INVALID");
  return { maxRequests, maxPublications, pauseMs, owner };
}
function safeImportError(error) {
  const code = /^[A-Z_0-9]+$/.test(error?.message || "") ? error.message : "GATEWAY_IMPORT_FAILED";
  const result2 = {};
  for (const key of ["discovered", "created", "updated", "unchanged", "rejected", "skipped", "deferred", "uncertain", "batches", "sourceRequests", "elapsedMs"])
    result2[key] = Number.isSafeInteger(error?.result?.[key]) && error.result[key] >= 0 ? error.result[key] : 0;
  const sourceErrors = {};
  for (const key of ["orphanActive", "missingTokenOrSlug", "timeoutOrNetwork", "invalidJson", "schema", "other", "activeDetailFailures", "requestLimit"])
    if (Number.isSafeInteger(error?.diagnostics?.[key]) && error.diagnostics[key] > 0) sourceErrors[key] = error.diagnostics[key];
  for (const [key, value] of Object.entries(error?.diagnostics?.http || {}))
    if (/^HTTP_\d{3}$/.test(key) && Number.isSafeInteger(value) && value > 0) sourceErrors[key] = value;
  const rejectedReasons = {};
  for (const [key, value] of Object.entries(error?.diagnostics?.rejectedReasons || {}))
    if (/^(?:record|identity|hash|status|circuit|circuitConfidence|url|metadata|metadataOrUrl|receiverHttp400|protectedExistingRecord|text:(?:category|title|summary|level|area|location|character|status|metadata|contentHash|circuit|sourceCircuitRaw|circuitInferenceSource)|date:(?:startsAt|endsAt|sourceUpdatedAt|registrationOpenAt|registrationCloseAt|expiresAt))$/.test(key) && Number.isSafeInteger(value) && value > 0) rejectedReasons[key] = value;
  const cursor = error?.result?.cursor;
  const safeCursor = cursor && Number.isSafeInteger(cursor.revision) && Number.isSafeInteger(cursor.cycle) && [cursor.after_key, cursor.upper_key].every((k) => k === "" || typeof k === "string" && /^\d{12}:\d{12}$/.test(k)) ? { revision: cursor.revision, cycle: cursor.cycle, after_key: cursor.after_key, upper_key: cursor.upper_key } : void 0;
  return { status: ["FDCI_PARTIAL_SOURCE", "FDCI_SELECTION_INCOMPLETE", "FDCI_PROBE_REQUEST_LIMIT", "HTTP_429", "FDCI_EMPTY_RESPONSE"].includes(code) ? "PARTIAL" : "ERROR", code, ...result2, ...safeCursor ? { cursor: safeCursor } : {}, sourceErrors, rejectedReasons, completed: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL2(process.argv[1]).href) {
  try {
    if (process.env.IMPORT_GATEWAY_ENABLED !== "true") throw new Error("GATEWAY_DISABLED");
    const revision = process.env.IMPORT_GATEWAY_TARGET === "production" ? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() : "";
    const target = resolveGatewayConfig(process.env, revision);
    console.log(JSON.stringify({ source: target.source, ...await runGatewayImport(target, process.env) }));
  } catch (error) {
    console.log(JSON.stringify(safeImportError(error)));
    process.exitCode = 1;
  }
}

// scripts/import-gate.mjs
var paths2 = {
  fdci: "/api/internal/fdci-import",
  sime: "/api/internal/sime-import",
  juntas: "/api/internal/public-source-import/juntas",
  cenet: "/api/internal/public-source-import/cenet",
  infd: "/api/internal/public-source-import/infd"
};
function resolveGateConfig(config) {
  const source = config.SYNC_SOURCE;
  if (typeof source !== "string" || !Object.hasOwn(paths2, source)) throw new Error("GATE_SOURCE_INVALID");
  let origin;
  try {
    origin = new URL(config.IMPORT_GATEWAY_ORIGIN);
  } catch {
    throw new Error("GATE_CONFIG_INVALID");
  }
  if (origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password || !(origin.protocol === "https:" && /^docentetuc-import-(?:canary-1-2|1-2)\.[a-z0-9-]+\.workers\.dev$/.test(origin.hostname) || origin.protocol === "http:" && origin.hostname === "127.0.0.1")) throw new Error("GATE_CONFIG_INVALID");
  const secret = config[`${source.toUpperCase()}_IMPORT_SECRET`];
  if (!/^[A-Za-z0-9_-]{32,}$/.test(secret || "")) throw new Error("GATE_SECRET_INVALID");
  const ttlSeconds = Number(config.IMPORT_GATE_TTL_SECONDS || 600);
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 600) throw new Error("GATE_TTL_INVALID");
  const owner = config.IMPORT_GATE_RUN_ID || (config.GITHUB_RUN_ID ? `${config.GITHUB_RUN_ID}-${config.GITHUB_RUN_ATTEMPT || "1"}` : "");
  if (!/^[A-Za-z0-9_:-]{1,100}$/.test(owner)) throw new Error("GATE_RUN_ID_REQUIRED");
  return { source, endpoint: new URL("/api/internal/import-gate", origin).toString(), secret, ttlSeconds, owner };
}
async function callGate(action, config, fetcher = fetch, revision = "") {
  if (action !== "open" && action !== "close") throw new Error("GATE_ACTION_INVALID");
  const target = resolveGateConfig(config);
  resolveGatewayConfig(config, revision);
  let response;
  try {
    response = await fetcher(target.endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${target.secret}`, "content-type": "application/json" },
      body: JSON.stringify({ source: target.source, action, ttlSeconds: target.ttlSeconds, owner: target.owner }),
      redirect: "error",
      signal: AbortSignal.timeout(2e4)
    });
  } catch {
    throw new Error("GATE_UNAVAILABLE");
  }
  if (!response.ok) throw new Error(`GATE_HTTP_${response.status}`);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("GATE_RESPONSE_INVALID");
  }
  if (body?.source !== target.source || body?.owner !== target.owner) throw new Error("GATE_RESPONSE_INVALID");
  if (action === "open" && (body?.ok !== true || !Number.isFinite(Date.parse(body?.expiresAt)) || Date.parse(body.expiresAt) <= Date.now()))
    throw new Error("GATE_RESPONSE_INVALID");
  if (action === "close" && (body?.ok !== true || body?.closed !== true)) throw new Error("GATE_RESPONSE_INVALID");
  return { source: target.source, action, expiresAt: body.expiresAt || null };
}
async function preflightFdciJob(config, revision, fetcher = fetch) {
  if (config.IMPORT_GATEWAY_ENABLED !== "true" || config.SYNC_SOURCE !== "fdci") throw new Error("GATE_DISABLED");
  const target = resolveGatewayConfig(config, revision);
  resolveGateConfig(config);
  fdciSafety(config);
  await verifyGatewayIdentity(target, fetcher);
  return target;
}
async function runFdciGatewayJob(config, revision, sourceFetch = fetch, receiverFetch = fetch, signal) {
  let attempted = false, result2;
  const cancellable = (fetcher) => (url, init = {}) => {
    if (signal?.aborted) throw new Error("FDCI_CANCELLED");
    return fetcher(url, { ...init, signal: signal ? AbortSignal.any([signal, ...init.signal ? [init.signal] : []]) : init.signal });
  };
  try {
    if (signal?.aborted) throw new Error("FDCI_CANCELLED");
    const target = await preflightFdciJob(config, revision, cancellable(receiverFetch));
    if (signal?.aborted) throw new Error("FDCI_CANCELLED");
    attempted = true;
    await callGate("open", config, receiverFetch, revision);
    if (signal?.aborted) throw new Error("FDCI_CANCELLED");
    result2 = { status: "OK", ...await runGatewayImport(target, {
      ...config,
      IMPORT_GATE_RUN_ID: resolveGateConfig(config).owner
    }, cancellable(sourceFetch), cancellable(receiverFetch)) };
  } catch (error) {
    result2 = safeImportError(error);
  } finally {
    if (attempted) {
      try {
        await callGate("close", config, receiverFetch, revision);
        result2.closed = true;
      } catch (error) {
        result2 = { ...result2, status: "ERROR", closed: false, closeCode: safeImportError(error).code };
      }
    } else result2.closed = null;
  }
  return result2;
}
if (process.argv[1] && import.meta.url === pathToFileURL3(process.argv[1]).href) {
  try {
    if (process.env.IMPORT_GATEWAY_ENABLED !== "true") throw new Error("GATE_DISABLED");
    const action = process.argv[2] || "open";
    const revision = process.env.IMPORT_GATEWAY_TARGET === "production" ? execFileSync2("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() : "";
    if (action === "preflight") {
      await preflightFdciJob(process.env, revision);
      console.log(JSON.stringify({ ok: true, preflight: true }));
    } else if (action === "run") {
      const controller = new AbortController();
      const abort = () => controller.abort();
      process.once("SIGTERM", abort);
      process.once("SIGINT", abort);
      const result2 = await runFdciGatewayJob(process.env, revision, fetch, fetch, controller.signal);
      console.log(JSON.stringify(result2));
      if (result2.closed !== true || !(result2.status === "OK" || result2.status === "PARTIAL" && result2.progressPending === true && result2.failed === false)) process.exitCode = 1;
    } else console.log(JSON.stringify(await callGate(action, process.env, fetch, revision)));
  } catch (error) {
    console.error("GATE_CALL_FAILED", error instanceof Error && /^[A-Z_0-9]+$/.test(error.message) ? error.message : "GATE_CALL_FAILED");
    process.exitCode = 1;
  }
}
export {
  callGate,
  preflightFdciJob,
  resolveGateConfig,
  runFdciGatewayJob
};
