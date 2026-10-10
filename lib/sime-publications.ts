import { extractOfficialScope, fact, newOfficial, officialMetadata, opportunityTopics, parseOfficialDate, procedureFromText, readMetadata, withOfficial, type CollectedPublication } from "./official-publication.ts";

export type SimeVacancy = { id: number; codigo: string; caracter: string; fechaPublicacionInicio: string; fechaPublicacionFin: string; cargos: string; abierto: boolean };
export type SimeDetail = { fechaDesignacion?: string; descripcion?: string; estadoId?: number };
export function validSimeDetail(value: unknown): value is { vacante: SimeDetail } {
  if (!value || typeof value !== "object") return false;
  const v = (value as { vacante?: SimeDetail }).vacante;
  return !!v && typeof v === "object" && (v.fechaDesignacion === undefined || typeof v.fechaDesignacion === "string") && (v.descripcion === undefined || typeof v.descripcion === "string");
}
export function normalizeSimeVacancy(v: SimeVacancy, junta: string, juntaId: number, previousMetadata?: string, now = new Date()): CollectedPublication {
  const id = `sime:${v.id}`, url = `https://sime.educaciontuc.gov.ar/Vacantes/Detalle/${v.id}?seleccionado=${juntaId - 1}&tab=1&accion=-1`;
  const cached = readMetadata(previousMetadata);
  const detail = cached.simeDetail as SimeDetail | undefined;
  const source = { id, source: "SIME", url, excerpt: `${v.codigo}\n${v.cargos}` };
  const description = detail?.descripcion || "";
  const m = newOfficial("opportunity", junta, [source]);
  const old = officialMetadata({ metadata: previousMetadata });
  m.abierto = v.abierto;
  m.codes = [v.codigo].filter(Boolean);
  m.procedure = procedureFromText(description, v.abierto);
  m.topics = opportunityTopics(m.procedure, v.abierto);
  m.positions = v.cargos.split(/,\s*(?=\[\d{7,9}\/\d{2}\])/).map(extractOfficialScope);
  m.scope = m.positions.length === 1 ? m.positions[0] : extractOfficialScope("");
  m.scope.character = v.caracter;
  const start = parseOfficialDate(v.fechaPublicacionInicio), end = parseOfficialDate(v.fechaPublicacionFin);
  if (start) m.facts.publicationStart = { ...start, status: "reported", evidence: [source] };
  if (end) m.facts.publicationEnd = { ...end, status: "reported", evidence: [source] };
  m.detailCheckedAt = old?.detailCheckedAt; m.detailAttemptedAt = old?.detailAttemptedAt;
  m.detailStatus = old?.detailStatus || "PENDING";
  if (description) {
    const ds = { id: `${id}:detail`, source: "SIME", url, excerpt: `${detail?.fechaDesignacion || ""}\n${description}` };
    m.sources.push(ds);
    const appointment = fact(detail?.fechaDesignacion, ds, description);
    if (appointment) m.facts.designation = appointment;
    const location = description.match(/(?:LUGAR|DOMICILIO)\s*:\s*([^\n]+?)(?=\s+-\s+(?:DOMICILIO|HORARIO)|$)/im)?.[1]?.trim();
    if (location) m.facts.location = { value: location, precision: "text", status: "reported", evidence: [ds] };
    m.facts.instructions = { value: description, precision: "text", status: "reported", evidence: [ds] };
    if (/designaci[oó]n\s+presencial/i.test(description)) m.facts.modality = { value: "Presencial", precision: "text", status: "reported", evidence: [ds] };
  } else if (detail?.fechaDesignacion) {
    const ds = { ...source, id: `${id}:detail`, excerpt: detail.fechaDesignacion };
    const appointment = fact(detail.fechaDesignacion, ds);
    if (appointment) m.facts.designation = appointment;
    m.sources.push(ds);
  }
  if (v.abierto && m.procedure === "unknown") m.issues.push("Procedimiento de inscripción no informado; abierto:true no demuestra inscripción online.");
  const first = v.cargos.split(", ")[0].replace(/^\[[^\]]+\]\s*/, "");
  const title = first.split(/\s+\[[^\]]*(?:TURNO|#)/i)[0].slice(0, 220);
  const startsAt = start?.precision === "datetime" ? start.value : null, endsAt = end?.precision === "datetime" ? end.value : null;
  return { id, source: "SIME", externalId: String(v.id), kind: "vacante", category: v.abierto ? "Llamado abierto" : "Vacante", title,
    summary: [v.cargos, description].filter(Boolean).join("\n\n"), level: junta, area: title, junta, location: "", shift: m.scope.shift || "", character: v.caracter,
    startsAt, endsAt, status: endsAt && Date.parse(endsAt) < now.getTime() ? "cerrada" : "vigente", officialUrl: url,
    metadata: withOfficial(JSON.stringify({ ...cached, simeCode: v.codigo, simeRecordId: String(v.id), simeVacancy: v }), m), contentHash: "", sourceUpdatedAt: startsAt, sourcePublishedAt: startsAt };
}

// Fair bounded rotation, refreshing details independently of the list hash.
export function selectSimeDetails(items: CollectedPublication[], limit = 12) {
  return [...items].sort((a, b) => {
    const x = officialMetadata(a), y = officialMetadata(b);
    return String(x?.detailAttemptedAt || "").localeCompare(String(y?.detailAttemptedAt || "")) || a.id.localeCompare(b.id);
  }).slice(0, limit);
}
export function applySimeDetail(item: CollectedPublication, detail: SimeDetail | null, now: string) {
  const m = officialMetadata(item)!;
  m.detailAttemptedAt = now;
  m.detailStatus = detail ? "OK" : m.detailCheckedAt ? "STALE" : "PENDING";
  if (detail) m.detailCheckedAt = now;
  const cached = readMetadata(item.metadata);
  // Never store designado/person data returned by the public endpoint.
  if (detail) cached.simeDetail = { fechaDesignacion: detail.fechaDesignacion, descripcion: detail.descripcion, estadoId: detail.estadoId };
  item.metadata = withOfficial(JSON.stringify(cached), m);
}
export function designationFromOpportunity(item: CollectedPublication): CollectedPublication | null {
  const m = officialMetadata(item);
  if (!m?.facts.designation) return null;
  const event = { ...m, entity: "event" as const, topics: ["ACTO_DESIGNACION" as const], relatedIds: [item.id],
    sources: [...m.sources], issues: [...m.issues], facts: { ...m.facts } };
  // Separate schedule semantics: an enrollment deadline never expires the Acto.
  const { publicationStart: _start, publicationEnd: _end, ...facts } = event.facts;
  event.facts = facts;
  const f = facts.designation;
  return { ...item, id: `acto:${item.id}`, externalId: `acto:${item.externalId}`, kind: "junta", category: "Actos de designación",
    title: `Acto de designación · ${item.title}`, startsAt: f.precision === "datetime" && f.status === "reported" ? f.value : null,
    endsAt: null, status: "Fecha informada por fuente oficial", sourcePublishedAt: null,
    location: facts.location?.value || "", metadata: withOfficial(item.metadata, event), contentHash: "" };
}
