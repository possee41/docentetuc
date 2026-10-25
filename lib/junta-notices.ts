import { plainDocumentText } from "./public-documents.ts";
import { padronTitleFacts } from "./padron-documents.ts";
import { extractCodes, extractOfficialScope, newOfficial, normalizeOfficialText, noticeAnchor, parseOfficialDate, procedureFromText, opportunityTopics, withOfficial, type CollectedPublication, type OfficialFact, type OfficialMetadata, type OfficialSource } from "./official-publication.ts";

export type NoticeBlock = { text: string; section: string };
export function splitNoticeBlocks(raw: string): NoticeBlock[] {
  const lines = plainDocumentText(raw, Number.MAX_SAFE_INTEGER).split("\n");
  const blocks: NoticeBlock[] = [];
  let current: string[] = [], section = "";
  const flush = () => { if (current.length) blocks.push({ text: current.join("\n").trim(), section }); current = []; };
  for (const line of lines) {
    if (/^(NIVEL SUPERIOR|MODALIDAD (?:ART[IÍ]STICA|(?:EDUCACI[OÓ]N )?ESPECIAL)|AVISOS GENERALES)\s*$/i.test(line)) {
      flush(); section = line; continue;
    }
    if (/^(COMUNICADO(?: DE PRENSA)?|LLAMADO(?:S)? ABIERTO(?:S)?|ACTO DE DESIGNACI[OÓ]N)\s*[:.]?\s*$/i.test(line)) {
      flush(); current.push(line); continue;
    }
    if (current.length) current.push(line);
  }
  flush();
  return blocks.filter(b => b.text.split("\n").filter(Boolean).length >= 2);
}
const datePattern = String.raw`\d{1,2}[/-]\d{1,2}[/-]\d{4}`;
const parseDateInText = (text: string) => {
  const s = text.match(new RegExp(`${datePattern}(?:\\s+(?:a las\\s+)?\\d{1,2}:\\d{2}\\s*(?:a\\.?\\s*m\\.?|p\\.?\\s*m\\.?)?)?`, "i"))?.[0];
  return parseOfficialDate(s?.replace(/(\d)[-](?=\d)/g, "$1/"));
};
function sourceFact(value: string, source: OfficialSource): OfficialFact {
  return { value, precision: "text", status: "reported", evidence: [{ ...source, excerpt: value }] };
}
export function classifyJuntaBlock(block: NoticeBlock, junta: string, source: OfficialSource): OfficialMetadata {
  const text = block.text, n = normalizeOfficialText(text);
  const m = newOfficial("notice", junta, [source], "Comunicados");
  m.scope = extractOfficialScope(text); m.codes = extractCodes(text);
  m.correction = /reprogram|pasaran|pasan para|se posterga|cambio de fecha/.test(n) && /designa/.test(n);
  const labeled = text.match(new RegExp(`(?:FECHA DE DESIGNACI[OÓ]N\\s*[:–-]?|DESIGNACI[OÓ]N PRESENCIAL\\s*[:–-]?|designaciones? (?:se realizar[aá]n|para|el))[^\\n]*?(${datePattern}(?:\\s+\\d{1,2}:\\d{2}\\s*(?:a\\.?\\s*m\\.?|p\\.?\\s*m\\.?)?)?)`, "i"));
  let appointment = labeled ? parseDateInText(labeled[1]) : null;
  if (m.correction) {
    const previous = text.match(new RegExp(`(?:designadas?|designaciones?)[^\\n]*?(${datePattern})`, "i"))?.[1];
    const next = text.match(new RegExp(`(?:pasar[aá]n|pasan para|se posterga(?:n)? (?:para|al)|reprograma(?:das?|n)? (?:para|al))[\\s\\S]{0,100}?(${datePattern})`, "i"))?.[1];
    const a = parseDateInText(previous || ""), b = parseDateInText(next || "");
    if (a && b) {
      m.facts.previousDesignation = { ...a, status: "reported", evidence: [{ ...source, excerpt: previous! }] };
      appointment = b;
    }
  }
  if (appointment) {
    const time = text.match(/(?:HORARIO|HORA)(?:\s+DE\s+DESIGNACI[OÓ]N)?\s*:\s*(\d{1,2}:\d{2})\s*(?:hs?\.?|horas)?/i)?.[1];
    if (time && appointment.precision === "date") {
      const [y, mo, d] = appointment.value.split("-");
      appointment = parseOfficialDate(`${d}/${mo}/${y} ${time}`) || appointment;
    }
    m.facts.designation = { ...appointment, status: /(?:horario|hora).{0,60}(?:a confirmar|tentativ)/.test(n) ? "provisional" : "reported",
      evidence: [{ ...source, excerpt: m.correction ? text : labeled?.[0] || text }] };
  }
  const explicitTime = text.match(/(?:HORARIO|HORA)\s+DE\s+DESIGNACI[OÓ]N\s*:\s*(\d{1,2}:\d{2})/i);
  if (explicitTime && Number(explicitTime[1].split(":")[0]) < 24 && Number(explicitTime[1].split(":")[1]) < 60) {
    m.facts.designationTime = sourceFact(explicitTime[1], { ...source, excerpt: explicitTime[0] });
    if (/horario.{0,50}(a confirmar|tentativ)/.test(n)) m.facts.designationTime.status = "provisional";
  }
  const location = text.match(/(?:LUGAR|DOMICILIO)\s*:\s*([^\n]+)/i)?.[1]?.trim();
  if (location) m.facts.location = sourceFact(location, { ...source, excerpt: location });
  if (/\bpresencial\b/.test(n)) m.facts.modality = sourceFact("Presencial", { ...source, excerpt: text.match(/\bpresencial\b/i)?.[0] || "Presencial" });
  // The full notice already lives in summary; repeating it as an instructions fact
  // and in every citation can turn one public document into a >100 KB payload.
  const instructional = /pasos a seguir|instructivo|formulario|como (?:participar|inscribirse)/.test(n);
  const jurado = /eleccion.{0,50}jurado|eleccion de los miembros|sorteo.{0,40}jurado/.test(n);
  const called = !instructional && /\bllamado(?:s)? abierto(?:s)?\b/.test(n) &&
    (!!m.codes.length || !!m.scope.school || /\b(?:convoca|inscripcion|recepcion de documentacion)\b/.test(n));
  if (called) {
    m.entity = "opportunity"; m.procedure = procedureFromText(text);
    m.topics = opportunityTopics(m.procedure); m.abierto = true;
    const window = text.match(new RegExp(`inscripci[oó]n(?:\\s+(?:en|sime|online|on line)){0,3}\\s*[:–-]?\\s*(${datePattern})\\s*(?:al|hasta)\\s*(${datePattern})`, "i"));
    if (window) {
      const a = parseDateInText(window[1]), b = parseDateInText(window[2]);
      if (a) m.facts.registrationStart = { ...a, status: "reported", evidence: [{ ...source, excerpt: window[0] }] };
      if (b) m.facts.registrationEnd = { ...b, status: "reported", evidence: [{ ...source, excerpt: window[0] }] };
    }
  } else if (!jurado && /designa/.test(n) && appointment && !/\bejemplo\b/.test(n)) {
    m.entity = m.correction ? "notice" : "event"; m.topics = ["ACTO_DESIGNACION"];
  } else if (/designa/.test(n) && !jurado && !instructional) {
    m.topics = ["CLASIFICACION_PENDIENTE"]; m.issues.push("Designación sin fecha o alcance inequívoco.");
  } else {
    m.topics = ["OTRO_COMUNICADO"];
  }
  if (/\b(?:sin fecha|a confirmar|tentativ)\b/.test(n)) m.issues.push("Hay datos que la fuente deja pendientes de confirmación.");
  if (block.section) m.issues.push(`Sección oficial: ${block.section}`);
  return m;
}
export function extractJuntaNotices(root: CollectedPublication, raw: string, previous: CollectedPublication[] = []) {
  const seen = new Set<string>(), result: CollectedPublication[] = [];
  for (const block of splitNoticeBlocks(raw)) {
    const lines = block.text.split("\n").filter(Boolean);
    const rawPublished = lines.slice(1, 4).find(x => /^\d{1,2}\/\d{1,2}\/(?:\d{4}|\d{2})$/.test(x.trim()));
    const published = rawPublished ? parseOfficialDate(rawPublished.replace(/\/(\d{2})$/, "/20$1"))?.value || null : null;
    const key = `${root.externalId}|${block.section}|${published || ""}|${extractCodes(block.text).join(",")}|${normalizeOfficialText(block.text).replace(/\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}:\d{2}/g, "@date")}`;
    const anchor = noticeAnchor(key);
    if (seen.has(anchor)) continue; seen.add(anchor);
    const existing = previous.find(x => {
      try { return JSON.parse(x.metadata || "{}").official?.noticeKey === anchor; } catch { return false; }
    });
    const id = existing?.id || `notice:${root.externalId}:${anchor}`;
    const source = { id, source: "Junta", url: root.officialUrl, publishedAt: published,
      excerpt: block.text.length > 500 ? `${block.text.slice(0, 499)}…` : block.text };
    const m = classifyJuntaBlock(block, root.junta, source); m.noticeKey = anchor; m.sourceRootId = root.id; m.sourceCategory = root.category; m.section = block.section;
    if (block.text.length > 500) m.issues.push("Extracto de evidencia abreviado; el texto completo está en la síntesis y la fuente original.");
    const category = m.entity === "event" ? "Actos de designación" : m.entity === "opportunity" ? "Llamados abiertos" : m.topics.includes("CLASIFICACION_PENDIENTE") ? "Clasificación pendiente" : "Comunicados";
    const title = lines.filter(x => !/^COMUNICADO|^\d{1,2}\/|^LLAMADO ABIERTO$/i.test(x)).slice(0, 2).join(" · ").slice(0, 220) || lines[0];
    const appointment = m.facts.designation;
    result.push({ ...root, id, externalId: id, category, title, summary: block.text, metadata: withOfficial("{}", m),
      startsAt: m.entity === "event" && appointment?.precision === "datetime" && appointment.status === "reported" ? appointment.value : null,
      endsAt: null, sourcePublishedAt: published, sourceUpdatedAt: null, status: m.entity === "event" ? "Fecha informada por Junta" : "Aviso oficial · verificar vigencia",
      location: m.facts.location?.value || "", contentHash: "" });
  }
  return result;
}
export function documentReference(item: CollectedPublication) {
  const source = { id: item.id, source: "Junta", url: item.officialUrl, excerpt: item.title };
  const m = newOfficial("reference", item.junta, [source], item.category);
  m.issues.push("Contenedor o archivo sin extracción fiable; no es prueba de convocatoria vigente.");
  return { ...item, metadata: withOfficial(item.metadata, m) };
}
export function classifyDriveReference(item: CollectedPublication, mime: string) {
  const ref = documentReference(item);
  if (mime !== "application/vnd.google-apps.folder" && /\bpadr[oó]n(?:es)?\b/i.test(item.title)) {
    const evidence = { id: item.id, source: "Junta", url: item.officialUrl, excerpt: item.title };
    const m = newOfficial("padron", item.junta, [evidence], item.category);
    m.topics = ["PADRON"];
    const parsed = padronTitleFacts(item.title);
    if (parsed.year) m.facts.padronYear = sourceFact(String(parsed.year), evidence);
    if (parsed.type !== "Otro") m.facts.padronType = sourceFact(parsed.type, evidence);
    if (parsed.subject) m.facts.padronSubject = sourceFact(parsed.subject, evidence);
    if (parsed.version) m.facts.padronVersion = sourceFact(parsed.version, evidence);
    ref.metadata = withOfficial(ref.metadata, m);
  }
  return ref;
}
