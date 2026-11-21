// A versioned domain model inside existing Publication.metadata; no DB migration.
export type OfficialTopic = "INSCRIPCION_SIME" | "LLAMADO_ABIERTO" | "ACTO_DESIGNACION" | "PADRON" | "OTRO_COMUNICADO" | "CLASIFICACION_PENDIENTE";
export type OfficialSource = { id: string; url: string; source: string; publishedAt?: string | null; excerpt: string };
export type OfficialFact = { value: string; precision: "date" | "datetime" | "text"; status: "reported" | "provisional" | "conflict"; evidence: OfficialSource[];
  alternatives?: { value: string; precision: "date" | "datetime" | "text"; status: "reported" | "provisional" | "conflict"; evidence: OfficialSource[] }[] };
export type OfficialScope = { school: string | null; role: string | null; subject: string | null; hours: string | null; shift: string | null; character: string | null; circuit: string | null };
export type OfficialMetadata = {
  version: 1;
  entity: "opportunity" | "event" | "notice" | "padron" | "reference";
  topics: OfficialTopic[];
  procedure: "online_sime" | "direct" | "both" | "unknown";
  junta: string;
  codes: string[];
  scope: OfficialScope;
  sources: OfficialSource[];
  facts: Record<string, OfficialFact>;
  relatedIds: string[];
  issues: string[];
  canonicalId?: string;
  candidateIds?: string[];
  sourceCategory?: string;
  noticeKey?: string;
  detailCheckedAt?: string;
  detailAttemptedAt?: string;
  detailStatus?: "OK" | "STALE" | "PENDING";
  abierto?: boolean;
  correction?: boolean;
  positions?: OfficialScope[];
  sourceRootId?: string;
  section?: string;
};
export type CollectedPublication = {
  id: string; source: string; externalId: string; kind: string; category: string; title: string; summary: string;
  level: string; area: string; junta: string; location: string; shift: string; character: string;
  circuit?: string; sourceCircuitRaw?: string; circuitInferenceSource?: string; circuitConfidence?: number;
  startsAt: string | null; endsAt: string | null; status: string; officialUrl: string; metadata?: string; contentHash: string;
  sourceUpdatedAt: string | null; sourcePublishedAt?: string | null;
};
type MetadataLike = { metadata?: string | null; kind?: string; category?: string; source?: string; id?: string };
export const normalizeOfficialText = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
export const readMetadata = (value?: string | null): Record<string, unknown> => {
  try { const data = JSON.parse(value || "{}"); return data && typeof data === "object" && !Array.isArray(data) ? data : {}; } catch { return {}; }
};
export function officialMetadata(item: MetadataLike): OfficialMetadata | null {
  const m = readMetadata(item.metadata).official as OfficialMetadata | undefined;
  return m?.version === 1 && Array.isArray(m.topics) && Array.isArray(m.sources) && m.facts && m.scope ? m : null;
}
export function withOfficial(metadata: string | undefined, official: OfficialMetadata) {
  return JSON.stringify({ ...readMetadata(metadata), official });
}
export function newOfficial(entity: OfficialMetadata["entity"], junta: string, sources: OfficialSource[], sourceCategory?: string): OfficialMetadata {
  return { version: 1, entity, junta, sources, topics: [], procedure: "unknown", codes: [], scope: { school: null, role: null, subject: null, hours: null, shift: null, character: null, circuit: null }, facts: {}, relatedIds: [], issues: [], sourceCategory };
}
export function fromStoredPublication(row: Record<string, unknown>): CollectedPublication {
  const s = (key: string) => typeof row[key] === "string" ? row[key] as string : "";
  return { id: s("id"), source: s("source"), externalId: s("external_id"), kind: s("kind"), category: s("category"), title: s("title"), summary: s("summary"),
    level: s("level"), area: s("area"), junta: s("junta"), location: s("location"), shift: s("shift"), character: s("character"),
    startsAt: s("starts_at") || null, endsAt: s("ends_at") || null, status: s("status"), officialUrl: s("official_url"),
    metadata: s("metadata"), contentHash: s("content_hash"), sourceUpdatedAt: s("source_updated_at") || null, sourcePublishedAt: s("source_published_at") || null };
}
export function parseOfficialDate(raw: string | null | undefined): Pick<OfficialFact, "value" | "precision"> | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(?:a\s+las\s+)?(\d{1,2}):(\d{2})\s*(a\.?\s*m\.?|p\.?\s*m\.?)?)?(?:\s*(?:hs?\.?|horas))?$/i);
  if (!m) return null;
  const day = Number(m[1]), month = Number(m[2]), year = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (year < 2000 || d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (!m[4]) return { value: date, precision: "date" };
  let h = Number(m[4]); const minute = Number(m[5]);
  if (minute > 59 || (m[6] ? h < 1 || h > 12 : h > 23)) return null;
  if (m[6]) h = h % 12 + (m[6].toLowerCase().startsWith("p") ? 12 : 0);
  return { value: `${date}T${String(h).padStart(2, "0")}:${m[5]}:00-03:00`, precision: "datetime" };
}
export function fact(raw: string | undefined | null, source: OfficialSource, text = ""): OfficialFact | null {
  const parsed = parseOfficialDate(raw);
  if (!parsed) return null;
  const provisional = /(?:horario|hora|fecha).{0,50}(?:a confirmar|por confirmar|tentativ)/i.test(normalizeOfficialText(text));
  return { ...parsed, status: provisional ? "provisional" : "reported", evidence: [source] };
}
export function extractCodes(text: string) {
  return [...new Set((text.match(/\bPDVC-\d{8}-\d+\b/gi) || []).map(x => x.toUpperCase()))];
}
export function extractOfficialScope(text: string): OfficialScope {
  const n = normalizeOfficialText(text);
  const school = text.match(/\[(\d{7,9}\/\d{2})\]/)?.[1] || text.match(/(?:establecimiento|escuela)\s*:\s*([^\n;]+)/i)?.[1]?.trim() || null;
  const role = text.match(/(?:cargo|materia)\s*:\s*([^\n;]+)/i)?.[1]?.trim() ||
    text.match(/-\s*([^,\n[\]]+\s-\s\d{2,4})(?:#|\s*\[|$)/)?.[1]?.trim() || null;
  return { school, role, subject: text.match(/materia\s*:\s*([^\n;]+)/i)?.[1]?.trim() || null,
    hours: n.match(/\b(\d+)\s*(?:horas(?:\s+catedra)?|hs?\s*catedra|h\.?c\.?)\b/)?.[1] || null,
    shift: text.match(/TURNO\s+([^\]\n,;]+)/i)?.[1]?.trim() || null,
    character: n.match(/\b(interino|suplente|titular)\b/)?.[1] || null,
    circuit: n.match(/\bcircuito\s+(iv|iii|ii|i|v|[1-5])\b/)?.[1]?.toUpperCase() || null };
}
export function procedureFromText(text: string): OfficialMetadata["procedure"] {
  const t = normalizeOfficialText(text);
  const deniedOnline = /sin (?:inscripcion|postulacion)(?:\s+\w+){0,3}\s+sime/.test(t);
  const online = !deniedOnline && /(?:inscri(?:pcion|pciones|birse)|postula(?:cion|ciones|rse)).{0,70}(?:sime|on\s*line|en linea)|sime.{0,45}(?:inscri(?:pcion|pciones|birse)|postula(?:cion|rse))/.test(t);
  const direct = deniedOnline || /(?:inscripcion presencial|presentarse directamente|presentacion directa)/.test(t);
  if (online && direct) return "both";
  if (online) return "online_sime";
  if (direct) return "direct";
  // Neither value of abierto proves how a teacher must apply.
  return "unknown";
}
export function opportunityTopics(procedure: OfficialMetadata["procedure"]) {
  const topics: OfficialTopic[] = [];
  if (procedure === "online_sime" || procedure === "both") topics.push("INSCRIPCION_SIME");
  if (procedure === "direct" || procedure === "both") topics.push("LLAMADO_ABIERTO");
  if (!topics.length) topics.push("CLASIFICACION_PENDIENTE");
  return topics;
}
export function hasOfficialTopic(item: MetadataLike, topic: OfficialTopic) {
  const m = officialMetadata(item);
  if (m) return !m.canonicalId && m.topics.includes(topic);
  if (topic === "INSCRIPCION_SIME") return false; // No legacy category proves online enrollment.
  if (topic === "CLASIFICACION_PENDIENTE") return item.kind === "vacante" && item.source === "SIME";
  const categories: Partial<Record<OfficialTopic, string>> = { PADRON: "Padrones", ACTO_DESIGNACION: "Actos de designación", LLAMADO_ABIERTO: "Llamados abiertos", OTRO_COMUNICADO: "Comunicados" };
  return item.kind === "junta" && item.category === categories[topic];
}
export function officialDestination(item: MetadataLike) {
  if (hasOfficialTopic(item, "INSCRIPCION_SIME")) return "vacantes";
  if (item.source === "SIME" && hasOfficialTopic(item, "CLASIFICACION_PENDIENTE")) return "vacantes";
  if (hasOfficialTopic(item, "LLAMADO_ABIERTO")) return "llamados";
  if (hasOfficialTopic(item, "ACTO_DESIGNACION")) return "actos";
  if (hasOfficialTopic(item, "PADRON")) return "padrones";
  return "comunicados";
}
export function eventDate(item: MetadataLike): string | null {
  return officialMetadata(item)?.facts.designation?.value?.slice(0, 10) || null;
}
export function confirmedEventTime(item: MetadataLike): string | null {
  const m = officialMetadata(item), f = m?.facts.designation;
  return f?.precision === "datetime" && f.status === "reported" && !m?.issues.some(x => /conflict/i.test(x)) ? f.value : null;
}
export function officialDateLabel(item: MetadataLike) {
  const f = officialMetadata(item)?.facts.designation;
  if (!f) return "Fecha no informada";
  const [y, mo, d] = f.value.slice(0, 10).split("-");
  const time = f.precision === "datetime" ? f.value.slice(11, 16) : "";
  return `${d}/${mo}/${y}${time ? ` · ${time}${f.status === "provisional" ? " (horario a confirmar)" : f.status === "conflict" ? " (dato en conflicto)" : " hs"}` : f.status === "conflict" ? " · fecha en conflicto" : f.status === "provisional" ? " · horario a confirmar" : " · horario no informado"}`;
}
export function officialLifecycle(item: MetadataLike, now = new Date()): "ACTIVE" | "UPCOMING" | "CLOSED" | "EXPIRED" | "UNKNOWN" | null {
  const m = officialMetadata(item);
  if (!m) return null;
  if (m.canonicalId || m.entity === "reference" || m.topics.includes("CLASIFICACION_PENDIENTE")) return "UNKNOWN";
  if (m.entity === "opportunity" && m.topics.includes("INSCRIPCION_SIME")) {
    const open = m.facts.publicationStart, close = m.facts.publicationEnd;
    if (!open || !close || open.precision !== "datetime" || close.precision !== "datetime") return "UNKNOWN";
    if (Date.parse(close.value) < now.getTime()) return "CLOSED";
    if (Date.parse(open.value) > now.getTime()) return m.abierto === false ? "UPCOMING" : "UNKNOWN";
    return m.abierto === true ? "ACTIVE" : m.abierto === false ? "CLOSED" : "UNKNOWN";
  }
  if (m.entity === "opportunity" && m.topics.includes("LLAMADO_ABIERTO") && !m.topics.includes("INSCRIPCION_SIME")) {
    const close = m.facts.registrationEnd, open = m.facts.registrationStart;
    if (!close || close.status !== "reported") return "UNKNOWN";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Tucuman", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    if (close.precision === "datetime" ? Date.parse(close.value) < now.getTime() : close.value.slice(0, 10) < today) return "EXPIRED";
    if (open && (open.precision === "datetime" ? Date.parse(open.value) > now.getTime() : open.value.slice(0, 10) > today)) return "UPCOMING";
    return open ? "ACTIVE" : "UNKNOWN";
  }
  if (m.entity !== "event") return null;
  const day = m.facts.designation?.value.slice(0, 10);
  if (!day || m.facts.designation.status === "conflict") return "UNKNOWN";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return day < today ? "EXPIRED" : day === today ? "ACTIVE" : "UPCOMING";
}
// Stable two-word hash for source anchors, never based on array position.
export function noticeAnchor(text: string) {
  let a = 2166136261, b = 5381;
  for (const c of text) { a = Math.imul(a ^ c.charCodeAt(0), 16777619); b = Math.imul(b, 33) ^ c.charCodeAt(0); }
  return `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}
