import type { Publication } from "./types.ts";
import { officialMetadata, officialLifecycle, withOfficial } from "./official-publication.ts";
import { isPublicPublication } from "./publication-visibility.ts";
const dayInTucuman = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Tucuman", year: "numeric", month: "2-digit", day: "2-digit" });

// Read model only: the SIME id remains the identity used by personal tracking.
// No extra publication, hash, import cursor or private row is created.
export function simeDesignationView(item: Publication, now = new Date()): Publication | null {
  if (item.source !== "SIME" || item.kind !== "vacante" || !/^sime:\d+$/.test(item.id) || !isPublicPublication(item) || item.removed_at) return null;
  const original = officialMetadata(item), date = original?.facts.designation;
  if (!original || original.canonicalId || !date || !Array.isArray(date.evidence) || typeof date.value !== "string" || !["date", "datetime"].includes(date.precision) || !Number.isFinite(Date.parse(date.value))) return null;
  if (!(date.precision === "date" ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00$/).test(date.value) || new Date(date.value.slice(0,10)+"T00:00:00Z").toISOString().slice(0,10) !== date.value.slice(0,10)) return null;
  // Dates must originate in the corresponding official detail, never enrollment.
  if (!date.evidence.some(e => {
    try { const url = new URL(e.url); return url.protocol === "https:" && url.hostname === "sime.educaciontuc.gov.ar" && url.pathname === `/Vacantes/Detalle/${item.id.slice(5)}`; } catch { return false; }
  })) return null;
  const m = { ...original, facts: { ...original.facts }, issues: Array.isArray(original.issues) ? original.issues.filter(x=>typeof x === "string") : [] };
  m.entity = "event"; m.topics = ["ACTO_DESIGNACION"]; m.relatedIds = [...new Set([...(Array.isArray(m.relatedIds) ? m.relatedIds : []), item.id])];
  delete m.facts.publicationStart; delete m.facts.publicationEnd;
  const checked = Date.parse(m.detailCheckedAt || ""), age = now.getTime() - checked;
  const fresh = m.detailStatus === "OK" && Number.isFinite(age) && age >= 0 && age <= 36 * 60 * 60 * 1000;
  if (!fresh) {
    m.issues.push("Fecha de acto pendiente de nueva verificación oficial.");
    m.detailStatus = "STALE";
  }
  const result: Publication = { ...item, category: "Actos de designación",
    starts_at: date.status === "reported" && date.precision === "datetime" ? date.value : null,
    ends_at: null, expires_at: null, registration_open_at: null, registration_close_at: null,
    // The act's venue stays in facts.location; it is not the school's locality for matching.
    metadata: withOfficial(item.metadata, m),
    status: fresh ? "Acto informado por SIME; no confirma adjudicación" : "Fecha de acto por verificar",
    normalized_status: "UNKNOWN" };
  const today = dayInTucuman.format(now), day = date.value.slice(0,10);
  result.normalized_status = fresh && date.status === "reported" ? day < today ? "EXPIRED" : day === today ? "ACTIVE" : "UPCOMING" : "UNKNOWN";
  if (result.normalized_status === "EXPIRED") result.status = "Acto pasado; no confirma adjudicación";
  return result;
}

export function designationCatalog(rows: Publication[], now = new Date(), history = false) {
  const result = new Map<string, Publication>();
  for (const row of rows) {
    const item = row.source === "SIME" && row.kind === "vacante" ? simeDesignationView(row, now) : row;
    if (!item || !isPublicPublication(item) || item.removed_at) continue;
    const m = officialMetadata(item), date = m?.facts.designation;
    if (m?.entity !== "event" || m.canonicalId || !m.topics.includes("ACTO_DESIGNACION") || !date?.evidence.length) continue;
    const lifecycle = row.source === "SIME" && row.kind === "vacante" ? item.normalized_status : officialLifecycle(item, now);
    const current = date.status === "reported" && !m.issues.some(x => /conflict/i.test(x)) && ["ACTIVE", "UPCOMING"].includes(lifecycle || "");
    if (!history && !current) continue;
    const key = item.id.startsWith("acto:sime:") ? item.id.slice(5) : item.id;
    if (!result.has(key) || item.id === key) result.set(key, item);
  }
  return [...result.values()].sort((a,b) => (officialMetadata(a)?.facts.designation?.value || "").localeCompare(officialMetadata(b)?.facts.designation?.value || "") || a.id.localeCompare(b.id));
}
