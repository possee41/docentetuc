import { isEligibleForPersonalizedHome, profileMatch } from "./matching.ts";
import { enrollmentState, parseTrainingMetadata } from "./training.ts";
import { usefulMetadata } from "./useful-information.ts";
import type { DesignationTracking, Profile, Publication } from "./types.ts";

export type AIConfig = { provider: string; apiKey: string; model: string };
export type AISource = { id: string; title: string; source: string; sourceType: "official" | "internal" | "complementary"; url: string; updatedAt: string; status: string };
export type PublicAISource = Pick<AISource, "title" | "source" | "sourceType" | "url">;
export type AIIntent = "capacitaciones" | "inscripcion" | "vacantes" | "designaciones" | "llamados" | "agenda" | "perfil" | "novedades" | "documentos" | "junta" | "licencias" | "inasistencia" | "titulos" | "informacion" | "app" | "busqueda_general" | "conversacion_general";
export type AIContextInput = { type: string; id?: string; title?: string };
export type AIAgendaEntry = { id: string; title: string; startsAt: string; category?: string; recurrence?: string; updatedAt?: string; kind: "publication" | "manual" };
export type AISourceIssue = { source: string; state: "unavailable" | "unverified" };
export type AISourceHealthRow = { source: string; error?: string | null; sync_status?: string | null };
export type AIContextOptions = { profile?: Profile; agendaIds?: string[]; agendaEntries?: AIAgendaEntry[]; designations?: DesignationTracking[]; context?: AIContextInput; sourceFailures?: string[]; sourceNotVerified?: string[]; now?: Date };
export interface AIProvider { generate(input: string, instructions: string): Promise<string>; }

export function aiResponseCacheKey(userId: string, intent: AIIntent, message: string, latestPublicationUpdate: string) {
  return `${userId}:${intent}:${message.toLocaleLowerCase("es")}:${latestPublicationUpdate || "empty"}`;
}

const trackedSources = ["SIME", "Capacitación Docente", "Padrones", "Llamados abiertos", "Comunicados", "Resoluciones", "Información oficial Tucumán", "CeNET / INET", "INFoD / AulaS-TIC"];
const sourcesForIntent: Partial<Record<AIIntent, string[]>> = {
  capacitaciones: ["Capacitación Docente", "CeNET / INET", "INFoD / AulaS-TIC"], inscripcion: ["Capacitación Docente", "CeNET / INET", "INFoD / AulaS-TIC", "SIME"],
  vacantes: ["SIME"], designaciones: ["SIME"], llamados: ["Llamados abiertos"], junta: ["Padrones", "Comunicados", "Resoluciones"], documentos: ["Padrones", "Comunicados", "Resoluciones"],
  licencias: ["SIME", "Información oficial Tucumán"], inasistencia: ["SIME", "Información oficial Tucumán"], titulos: ["Información oficial Tucumán"], informacion: ["SIME", "Información oficial Tucumán"],
  novedades: trackedSources, busqueda_general: trackedSources,
};

function relevantSourcesForQuestion(intent: AIIntent, question: string) {
  const requestedBoardSource = /comunicad/i.test(question) ? "Comunicados" : /padr[oó]n/i.test(question) ? "Padrones" : /resoluci[oó]n/i.test(question) ? "Resoluciones" : null;
  const relevant = intent === "junta" && requestedBoardSource ? [requestedBoardSource] : sourcesForIntent[intent] || [];
  // A generic information intent does not make the SIME vacancy feed relevant to CENDIE, salaries, etc.
  return relevant.filter((source) => source !== "SIME" || !["informacion", "licencias", "inasistencia"].includes(intent) || /\bsime\b/i.test(question));
}

export function aiSourceIssuesFor(intent: AIIntent, rows: AISourceHealthRow[], question: string): AISourceIssue[] {
  const relevant = relevantSourcesForQuestion(intent, question);
  return [...new Set(relevant)].flatMap((source): AISourceIssue[] => {
    const row = rows.find((item) => item.source === source);
    if (!row) return [{ source, state: "unverified" as const }];
    const status = (row.sync_status || "UNKNOWN").toUpperCase();
    if (row.error || (status !== "OK" && status !== "UNKNOWN")) return [{ source, state: "unavailable" as const }];
    return status === "OK" ? [] : [{ source, state: "unverified" as const }];
  });
}

export function aiAnswerDisclosure(sources: Pick<AISource, "sourceType">[], issues: AISourceIssue[], intent: AIIntent) {
  const unavailable = issues.filter((item) => item.state === "unavailable").map((item) => item.source);
  const unverified = issues.filter((item) => item.state === "unverified").map((item) => item.source);
  if (unavailable.length) return { kind: "unavailable" as const, label: "Fuente temporalmente no disponible", detail: `Falló la última actualización de ${unavailable.join(", ")}. La IA puede apoyarse en información sincronizada anteriormente, que quizá no refleje novedades; verificá su vigencia en la fuente oficial.` };
  if (unverified.length) return { kind: "unverified" as const, label: "Fuente sin verificación reciente", detail: `No se pudo confirmar el estado de ${unverified.join(", ")}; esto no significa que no existan resultados.` };
  const hasOfficial = sources.some((source) => source.sourceType === "official"), hasInternal = sources.some((source) => source.sourceType === "internal");
  if (hasOfficial && hasInternal) return { kind: "mixed" as const, label: "Registros oficiales + datos personales", detail: "Se combinaron los registros oficiales listados abajo con tu agenda o seguimiento de DocenteTuc; esos datos personales no son información oficial." };
  if (hasOfficial) return { kind: "official" as const, label: "Registros oficiales sincronizados", detail: "Se recuperaron los registros oficiales listados abajo desde las fuentes integradas; confirmá cambios directamente en el sitio de origen." };
  if (sources.some((source) => source.sourceType === "internal")) return { kind: "internal" as const, label: "Información personal de DocenteTuc", detail: "La agenda o el seguimiento son datos tuyos, no fuentes oficiales." };
  if (["agenda", "designaciones", "perfil"].includes(intent)) return { kind: "internal" as const, label: "Consulta personal de DocenteTuc", detail: "No se recuperaron registros personales coincidentes en esta consulta." };
  if (intent === "conversacion_general") return { kind: "general" as const, label: "Orientación general de IA", detail: "Esta respuesta no se basa en registros oficiales de DocenteTuc." };
  return { kind: "general" as const, label: "Orientación general de IA", detail: "No se recuperaron registros oficiales de DocenteTuc; esta orientación no confirma datos actuales." };
}

export function safeAISourceUrl(value: string | null | undefined): string {
  try { const url = new URL(value || ""); return url.protocol === "https:" ? url.href : ""; } catch { return ""; }
}

export function publicAISources(sources: AISource[]): PublicAISource[] {
  return sources.map(({ title, source, sourceType, url }) => ({ title, source, sourceType, url }));
}

export class AIProviderError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

const outputText = (data: Record<string, unknown>) => {
  if (typeof data.output_text === "string") return data.output_text;
  const output = Array.isArray(data.output) ? data.output : [];
  return output.flatMap((item) => typeof item === "object" && item && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: Record<string, unknown>[] }).content : []).map((item) => item.text).filter((value): value is string => typeof value === "string").join("\n");
};

async function request(url: string, init: RequestInit) {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new AIProviderError("El proveedor de IA no pudo completar la consulta.", response.status);
    return data;
  } finally { clearTimeout(timeout); }
}

export class GeminiProvider implements AIProvider {
  private readonly apiKey: string; private readonly model: string;
  constructor(apiKey: string, model: string) { this.apiKey = apiKey; this.model = model; }
  async generate(input: string, instructions: string) {
    const data = await request(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": this.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: instructions }] }, contents: [{ role: "user", parts: [{ text: input }] }], generationConfig: { maxOutputTokens: 700, temperature: 0.2 } }),
    });
    const candidates = Array.isArray(data.candidates) ? data.candidates : [], first = candidates[0] as { content?: { parts?: { text?: string }[] } } | undefined;
    const text = first?.content?.parts?.map((part) => part.text || "").join("\n").trim();
    if (!text) throw new AIProviderError("El proveedor no devolvió texto.", 502);
    return text;
  }
}

class OpenAIProvider implements AIProvider {
  private readonly apiKey: string; private readonly model: string;
  constructor(apiKey: string, model: string) { this.apiKey = apiKey; this.model = model; }
  async generate(input: string, instructions: string) {
    const data = await request("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: this.model, instructions, input, max_output_tokens: 700, store: false }) });
    const text = outputText(data); if (!text) throw new AIProviderError("El proveedor no devolvió texto.", 502); return text;
  }
}

export function createAIProvider(config: AIConfig): AIProvider {
  if (config.provider === "gemini") return new GeminiProvider(config.apiKey, config.model);
  if (config.provider === "openai") return new OpenAIProvider(config.apiKey, config.model);
  throw new AIProviderError("AI_PROVIDER debe ser gemini u openai.", 500);
}

const normalize = (value = "") => value.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const tokens = (question: string) => [...new Set(normalize(question).split(/[^a-z0-9]+/).filter((word) => word.length > 3 && !["para", "esta", "este", "tengo", "cuales", "sobre", "alguna"].includes(word)))];
const wantsPersonalizedQuestion = (question: string) => /coincid|compatible|sirve|para mi(?: perfil)?/.test(normalize(question));
const forMatch = (item: Publication) => ({ kind: item.kind, title: item.title, summary: item.summary, level: item.level, area: item.area, junta: item.junta, location: item.location, shift: item.shift, character: item.character, circuit: item.circuit, sourceCircuitRaw: item.source_circuit_raw });
const matchProfile = (profile: Profile) => ({ levels: profile.levels, areas: profile.areas, subjects: profile.subjects, boards: profile.boards, roles: profile.roles, department: profile.department, locality: profile.locality, shifts: profile.shifts, characters: profile.characters, circuits: profile.circuits, personalMatchThreshold: profile.personal_match_threshold, wantsInterim: Boolean(profile.wants_interim), wantsSubstitute: Boolean(profile.wants_substitute), trainingInterests: profile.training_interests });
const dayKey = (value: Date | string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(typeof value === "string" ? new Date(value) : value);

export function detectIntent(question: string): AIIntent {
  const query = normalize(question);
  if (/^(?:¿?)(?:que significa|que es|explicame|defini(?:me|cion de))\b/.test(query) && !/\b(mi|mis|esta|este|estos|actual|vigente|publicad|proxim|inscrip|fecha|hoy|manana|disponib|abiert)\w*\b/.test(query)) return "conversacion_general";
  if (/\b(mi agenda|mis eventos|que tengo|proximo evento|agend)/.test(query)) return "agenda";
  if (/\b(faltar|inasist\w*|ausent\w*|no puedo ir|no voy a ir|no asistir|justificar la falta)\b/.test(query)) return "inasistencia";
  if (/\b(licencia|licencias|sesop|salud laboral)\b/.test(query)) return "licencias";
  if (/\b(titulo|titulos|certificado|certificados|constancia)\b/.test(query)) return "titulos";
  if (/\b(designacion|donde me inscribi|presentarme|obtuve|cargo.*inscrib)/.test(query)) return "designaciones";
  if (/\b(llamad[^ ]* abiert|convocatoria)/.test(query)) return "llamados";
  if (/\b(capacit\w*|cursos?|fdci|infod|aula[s-]?tic|cenet|inet)\b/.test(query) || /\bque abre(?:n)? esta semana\b/.test(query)) return "capacitaciones";
  if (/\b(inscrip|inscrib|preinscrip|matricul)/.test(query)) return "inscripcion";
  if (/\b(vacant|cargo|horas? catedra)/.test(query)) return "vacantes";
  if (/\b(mi perfil|para mi perfil|coincide conmigo|que me sirve)/.test(query)) return "perfil";
  if (/\b(padron|comunicado|resolucion|junta)/.test(query)) return "junta";
  if (/\b(novedad|ultima|reciente)/.test(query)) return "novedades";
  if (/\b(sueldo|haber|cobr|liquid|boleta|legajo|jubil|previsional|ciidept|cendie|digituc|sinide|sime|fdci|oficina|direccion|telefono|horario|tramite|expediente)/.test(query)) return "informacion";
  if (/\b(document|archivo)/.test(query)) return "documentos";
  if (/\b(docentetuc|esta app|esta aplicacion|usar la aplicacion|como funciona la app)/.test(query)) return "app";
  if (/^(hola|buenas|buen dia|gracias|chau)[!. ]*$/.test(query)) return "conversacion_general";
  return "busqueda_general";
}

function requestedDay(question: string, now: Date) {
  const query = normalize(question), [year, month, day] = dayKey(now).split("-").map(Number), date = new Date(Date.UTC(year, month - 1, day, 12));
  if (/\bmanana\b/.test(query)) date.setUTCDate(date.getUTCDate() + 1);
  else if (!/\bhoy\b/.test(query)) {
    const weekdays = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
    const wanted = weekdays.findIndex((day) => new RegExp(`\\b${day}\\b`).test(query));
    if (wanted < 0) return null;
    date.setUTCDate(date.getUTCDate() + ((wanted - date.getUTCDay() + 7) % 7));
  }
  return dayKey(date);
}

function dayOrdinal(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

function eventOccursOn(entry: AIAgendaEntry, targetDay: string) {
  const startDay = dayKey(entry.startsAt), difference = dayOrdinal(targetDay) - dayOrdinal(startDay);
  if (difference < 0) return false;
  if (!entry.recurrence || entry.recurrence === "none") return difference === 0;
  if (entry.recurrence === "daily") return true;
  if (entry.recurrence === "weekly") return difference % 7 === 0;
  if (entry.recurrence === "monthly") return Number(targetDay.slice(8, 10)) === Number(startDay.slice(8, 10));
  return difference === 0;
}

function relevantAgendaEntries(question: string, entries: AIAgendaEntry[], now: Date) {
  const query = normalize(question), requested = requestedDay(question, now);
  if (requested) return entries.filter((entry) => eventOccursOn(entry, requested));
  if (/\b(esta semana|durante la semana)\b/.test(query)) {
    const [year, month, day] = dayKey(now).split("-").map(Number);
    return entries.filter((entry) => Array.from({ length: 7 }, (_, offset) => eventOccursOn(entry, dayKey(new Date(Date.UTC(year, month - 1, day + offset, 12))))).some(Boolean));
  }
  return entries.filter((entry) => Date.parse(entry.startsAt) >= now.getTime() || (entry.recurrence && entry.recurrence !== "none" && eventOccursOn(entry, dayKey(now)))).slice(0, 8);
}

export function retrievePublications(question: string, publications: Publication[], limit = 8, options: AIContextOptions = {}) {
  const query = normalize(question), words = tokens(question), agendaEntries = options.agendaEntries || (options.agendaIds || []).map((id) => ({ id, title: "", startsAt: "", kind: "publication" as const })), agenda = new Set(agendaEntries.map((entry) => entry.id)), agendaEntryMap = new Map(agendaEntries.map((entry) => [entry.id, entry])), intent = detectIntent(question);
  if (intent === "conversacion_general") return [];
  if (/\b(no existe|inexistente|fictici|inventad)/.test(query)) return [];
  const wantsTraining = ["capacitaciones", "inscripcion"].includes(intent), wantsVacancy = ["vacantes", "designaciones"].includes(intent);
  const trainingSource = wantsTraining && /\bfdci\b/.test(query) ? "Capacitación Docente"
    : wantsTraining && /\b(infod|aula[s-]?tic)\b/.test(query) ? "INFoD / AulaS-TIC"
    : wantsTraining && /\b(cenet|inet)\b/.test(query) ? "CeNET / INET" : null;
  const confirmedPreinscription = wantsTraining && /preinscrip/.test(query) && /confirmad/.test(query) && /proxim/.test(query);
  const asksOpenTraining = wantsTraining && /\b(inscrip\w*|preinscrip\w*)\b/.test(query) && /\b(abiert\w*)\b/.test(query);
  const asksUpcomingTraining = wantsTraining && /\b(proxim\w*|abre\w*|esta semana)\b/.test(query);
  const wantsAgenda = intent === "agenda", now = options.now || new Date(), requested = wantsAgenda ? requestedDay(question, now) : null;
  const wantsMatches = wantsPersonalizedQuestion(query);
  const configuredProfile = options.profile ? matchProfile(options.profile) : null;
  return publications.map((item) => {
    if (wantsAgenda && !agenda.has(item.id)) return { item, score: -1 };
    if (wantsTraining && item.kind !== "capacitacion") return { item, score: -1 };
    if (trainingSource && item.source !== trainingSource) return { item, score: -1 };
    const training = wantsTraining ? parseTrainingMetadata(item.metadata) : null;
    const trainingState = wantsTraining ? enrollmentState(training, item.source_status || item.status, item.normalized_status, now) : null;
    const opening = training?.registrationOpensAt ? Date.parse(training.registrationOpensAt) : Number.NaN;
    if (wantsTraining && trainingState === "CERRADA") return { item, score: -1 };
    if (asksOpenTraining && trainingState !== "ABIERTA") return { item, score: -1 };
    if (asksUpcomingTraining && !Number.isFinite(opening)) return { item, score: -1 };
    if (asksUpcomingTraining && !["PROXIMAMENTE", "ABRE_HOY"].includes(trainingState || "")) return { item, score: -1 };
    if (/\besta semana\b/.test(query) && asksUpcomingTraining && (opening < now.getTime() || opening > now.getTime() + 7 * 86_400_000)) return { item, score: -1 };
    if (confirmedPreinscription) {
      if (!training?.preinscripcionFechaConfirmada || !Number.isFinite(opening) || opening <= now.getTime()) return { item, score: -1 };
    }
    if (wantsVacancy && !wantsTraining && item.kind !== "vacante") return { item, score: -1 };
    if (intent === "llamados" && !normalize(item.category).includes("llamado")) return { item, score: -1 };
    if (["documentos", "junta"].includes(intent) && item.kind !== "junta") return { item, score: -1 };
    if (intent === "junta" && /comunicad/.test(query) && !normalize(item.category).includes("comunicad")) return { item, score: -1 };
    if (intent === "junta" && /padron/.test(query) && !normalize(item.category).includes("padron")) return { item, score: -1 };
    if (["informacion", "licencias", "inasistencia", "titulos"].includes(intent) && item.kind !== "informacion") return { item, score: -1 };
    const eventDate = agendaEntryMap.get(item.id)?.startsAt || item.ends_at || item.starts_at || (item.kind === "capacitacion" ? parseTrainingMetadata(item.metadata)?.registrationOpensAt : undefined);
    if (requested && (!eventDate || dayKey(eventDate) !== requested)) return { item, score: -1 };
    if (wantsAgenda && /esta semana/.test(query) && (!eventDate || new Date(eventDate).getTime() < now.getTime() || new Date(eventDate).getTime() > now.getTime() + 7 * 86400000)) return { item, score: -1 };
    const match = configuredProfile ? profileMatch(forMatch(item), configuredProfile) : null;
    if (wantsMatches && (!configuredProfile || !match || !isEligibleForPersonalizedHome(forMatch(item), configuredProfile))) return { item, score: -1 };
    const haystack = normalize([item.title, item.summary, item.kind, item.category, item.level, item.area, item.location, item.source, item.status].join(" "));
    let score = words.reduce((total, word) => total + (haystack.includes(word) ? 2 : 0), 0);
    if (wantsTraining) score = Math.max(score, 1);
    if (["licencias", "inasistencia"].includes(intent) && item.id === "info:licencias") score += 12;
    if (item.id === options.context?.id) score += 100;
    if (wantsAgenda && agenda.has(item.id)) score += 20;
    if (wantsMatches && match) score += match.score;
    if (asksUpcomingTraining && trainingState && ["PROXIMAMENTE", "ABRE_HOY"].includes(trainingState)) score += 8;
    if (asksOpenTraining && trainingState === "ABIERTA") score += 5;
    if (/ultima|novedad|reciente/.test(query)) score += Math.max(0, 5 - (Date.now() - new Date(item.updated_at).getTime()) / 86400000);
    return { item, score };
  }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score || new Date(parseTrainingMetadata(a.item.metadata)?.registrationOpensAt || a.item.ends_at || a.item.starts_at || "9999").getTime() - new Date(parseTrainingMetadata(b.item.metadata)?.registrationOpensAt || b.item.ends_at || b.item.starts_at || "9999").getTime()).slice(0, limit).map(({ item }) => item);
}

export function buildAIContext(question: string, publications: Publication[], options: AIContextOptions = {}) {
  const now = options.now || new Date(), intent = detectIntent(question);
  if (intent === "conversacion_general") return { intent, sources: [] as AISource[], context: "INTENCIÓN DETECTADA: conversación general. Respondé con una explicación general; no atribuyas datos actuales a fuentes oficiales ni agregues publicaciones del panel." };
  const selected = retrievePublications(question, publications, 8, { ...options, now });
  const agendaEntries = intent === "agenda" ? relevantAgendaEntries(question, options.agendaEntries || [], now) : [];
  const sourceName = (item: Publication) => item.source === "Padrones y Comunicados" && ["Padrones", "Llamados abiertos", "Comunicados", "Resoluciones"].includes(item.category) ? item.category : item.source;
  const sources: AISource[] = selected.map((item) => ({ id: item.id, title: item.title, source: sourceName(item), sourceType: "official", url: safeAISourceUrl(item.official_url), updatedAt: item.updated_at, status: item.status }));
  sources.push(...agendaEntries.filter((entry) => entry.kind === "manual").map((entry) => ({ id: entry.id, title: entry.title, source: "Tu agenda", sourceType: "internal" as const, url: "", updatedAt: entry.updatedAt || "", status: "personal" })));
  if (options.designations?.length) sources.push({ id: "personal:designation-tracking", title: "Seguimiento de designaciones", source: "Tu seguimiento", sourceType: "internal", url: "", updatedAt: "", status: "personal" });
  const configuredProfile = options.profile ? matchProfile(options.profile) : null;
  const records = selected.map((item, index) => {
    const training = item.kind === "capacitacion" ? parseTrainingMetadata(item.metadata) : null;
    const trainingState = training ? enrollmentState(training, item.source_status || item.status, item.normalized_status, now) : null;
    const trainingDateStatus = !training ? "" : training.dateStatus === "tentative" ? "FECHA TENTATIVA / PREVISTA SEGÚN LA FUENTE" : training.registrationOpensAt && training.dateStatus === "confirmed" ? "APERTURA DE PREINSCRIPCIÓN CONFIRMADA POR LA FUENTE" : training.registrationOpensAt && training.dateStatus === "course_confirmed" ? "FECHA DE INSCRIPCIÓN PUBLICADA ESPECÍFICAMENTE PARA ESTA CAPACITACIÓN" : training.dateStatus === "general_window" ? "VENTANA GENERAL DE CATÁLOGO; NO ES UNA APERTURA CONFIRMADA PARA ESTA CAPACITACIÓN" : training.registrationClosesAt && training.dateStatus === "confirmed" ? "CIERRE DE PREINSCRIPCIÓN CONFIRMADO; APERTURA NO INFORMADA" : training.dateStatus === "course_confirmed" ? "FECHAS DEL CURSO CONFIRMADAS; APERTURA DE INSCRIPCIÓN NO INFORMADA" : "FECHAS DE INSCRIPCIÓN NO CONFIRMADAS";
    const useful = item.kind === "informacion" ? usefulMetadata(item.metadata) : null;
    const match = configuredProfile ? profileMatch(forMatch(item), configuredProfile) : null;
    const usefulFacts = useful ? `\nDatos oficiales publicados: tipo ${useful.recordType}; domicilio ${useful.address || "no publicado"}; horario ${useful.openingHours || "no publicado"}; teléfonos ${(useful.phones || []).join("; ") || "no publicados"}; correos ${(useful.emails || []).join("; ") || "no publicados"}; servicios ${(useful.services || []).join("; ") || "no publicados"}; requisitos/documentación ${[...(useful.requirements || []), ...(useful.documents || [])].join("; ") || "no publicados"}; organismo ${useful.parentOrganization || "no publicado"}; acceso ${useful.access || "no informado"}; verificado ${useful.lastVerified}. ${useful.notes || ""} ${useful.discrepancy || ""}` : "";
    return `[${index + 1}] ${item.title}\nTipo: ${item.category || item.kind}. Estado de la publicación: ${item.status}. Estado de inscripción calculado con los datos sincronizados: ${trainingState || "no aplica"}. Nivel: ${item.level || "No informado"}. Área: ${item.area || "No informada"}. Lugar: ${item.location || "No informado"}. Circuito: ${item.circuit || "UNKNOWN"} (${item.circuit_inference_source || "unknown"}). Inicio del curso: ${training?.courseStartsAt || item.starts_at || "No informado"}. Fin del curso: ${training?.courseEndsAt || "No informado"}. Apertura de preinscripción: ${training?.registrationOpensAt || "No informada por la fuente"}${training?.registrationHasTime ? " (fecha y hora informadas por la fuente)" : training?.registrationOpensAt ? " (la fuente no informa hora exacta)" : ""}. Cierre de preinscripción: ${training?.registrationClosesAt || "No informado por la fuente"}. Calidad de fechas: ${trainingDateStatus}. Confirmación específica de apertura FDCI: ${training?.preinscripcionFechaConfirmada ? "sí, según la comisión oficial" : "no"}. Cupo: ${training?.capacity ?? training?.preCapacity ?? "No informado"}. Requisitos: ${useful ? "ver datos oficiales publicados" : "No informados"}. Puntaje: No informado.${match ? ` Compatibilidad calculada por DocenteTuc: ${match.score}%; confianza: ${match.confidence}%; resultado: ${match.status}.` : ""} Detalle: ${(item.summary || "No informado").slice(0, item.kind === "junta" ? 6000 : item.kind === "informacion" ? 3000 : 900)}${usefulFacts}\nFuente: ${sourceName(item)}. URL: ${safeAISourceUrl(item.official_url) || "No publicada"}`;
  }).join("\n\n");
  const profileText = options.profile ? `Perfil autorizado: niveles ${options.profile.levels.join(", ") || "no informados"}; áreas ${options.profile.areas.join(", ") || "no informadas"}; materias ${options.profile.subjects.join(", ") || "no informadas"}; cargos ${options.profile.roles?.join(", ") || "no informados"}; localidad ${options.profile.locality || "no informada"}; circuitos ${options.profile.circuits?.join(", ") || "no seleccionados"}; intereses ${options.profile.training_interests.join(", ") || "no informados"}.` : "El usuario no autorizó usar su perfil.";
  const trackingText = options.designations?.length ? `\n\nSEGUIMIENTO PERSONAL DE DESIGNACIONES (datos ingresados por el usuario):\n${options.designations.map((item) => `${item.role || "Cargo no informado"} · ${item.school || "Establecimiento no informado"} · estado ${item.status} · inscripción ${item.applied_at || "no informada"} · designación ${item.appointment_at || "no informada"} · notas ${item.notes || "sin notas"}`).join("\n")}` : "";
  const panelContext = options.context ? `Contexto del panel: tipo ${options.context.type}; título ${options.context.title || "sin título"}.` : "Contexto del panel no informado.";
  const agendaText = agendaEntries.length ? `\n\nAGENDA PERSONAL DEL DOCENTE (contenido interno, no oficial):\n${agendaEntries.map((entry) => `${entry.title} · ${entry.category || "Agenda"} · ${entry.startsAt}${entry.recurrence && entry.recurrence !== "none" ? ` · repetición ${entry.recurrence}` : ""}`).join("\n")}` : intent === "agenda" ? "\n\nAGENDA PERSONAL DEL DOCENTE: No hay eventos coincidentes con la fecha consultada en los datos cargados." : "";
  const relevantSources = new Set([...relevantSourcesForQuestion(intent, question), ...sources.map((source) => source.source)]);
  const sourceFailures = options.sourceFailures?.filter((source) => relevantSources.has(source));
  const sourceNotVerified = options.sourceNotVerified?.filter((source) => relevantSources.has(source));
  const failureText = sourceFailures?.length ? `\n\nESTADO INTERNO DE ACTUALIZACIÓN: falló la última actualización de ${sourceFailures.join(", ")}. Si la consulta depende de esos datos, respondé igualmente usando el último contenido disponible y la orientación general; aclarale con precisión qué dato no se pudo verificar. No afirmes que esa fuente fue consultada o verificada hoy ni que no existen novedades posteriores. No uses esta falla como respuesta completa ni como preámbulo genérico.` : "";
  const unverifiedText = sourceNotVerified?.length ? `\n\nESTADO DE VERIFICACIÓN: no hay una verificación reciente registrada para ${sourceNotVerified.join(", ")}. No interpretes registros ausentes como prueba de que no existen resultados y no confirmes datos actuales sin evidencia.` : "";
  const appHelp = intent === "app" ? "\n\nCONTEXTO INTERNO DE LA APLICACIÓN: DocenteTuc organiza información docente pública y personaliza oportunidades con el perfil sólo cuando el usuario lo autoriza. Incluye Designaciones, Capacitaciones, Padrones y comunicados, Información útil, Agenda, Alertas y Guardados. Las inscripciones y trámites se finalizan en la fuente oficial. La agenda permite eventos manuales y recordatorios." : "";
  const evidenceGuidance = "\n\nCLASIFICACIÓN DE EVIDENCIA: Las fuentes oficiales son únicamente los registros enumerados y citados. No atribuyas a esas fuentes conocimiento general del modelo. Si no se recuperó evidencia oficial suficiente sobre un dato actual o cambiante, decí: ‘No encontré información oficial suficiente para confirmar ese dato.’ Si brindás una explicación general, identificala expresamente como ‘Orientación general’; no la presentes como normativa, fecha, requisito ni respuesta oficial. Si hay falla o falta de verificación de una fuente, no concluyas que no existen resultados.";
  const trainingGuidance = ["capacitaciones", "inscripcion"].includes(intent) ? "\n\nREGLAS PARA CAPACITACIONES: Usá estos registros recuperados de publications, los mismos que alimentan el módulo Capacitaciones. No inventes ni reutilices fechas históricas. En FDCI, la apertura sólo es la fecha y hora de inicio de preinscripción de una comisión; el inicio del curso no es apertura. Conservá literalmente la diferencia entre fecha tentativa/prevista, apertura confirmada, ventana general y fecha desconocida. Indicá la fuente, estado de inscripción y fecha/hora exactas disponibles. Si no aparece ninguna apertura confirmada en los registros recuperados, decilo explícitamente; podés mencionar por separado registros tentativos. Si la consulta es personalizada y el perfil no fue autorizado, no calcules ni afirmes compatibilidad." : "";
  const matchingGuidance = wantsPersonalizedQuestion(question) && !options.profile ? "\n\nPERSONALIZACIÓN NO AUTORIZADA: El usuario preguntó qué capacitación es para él/ella, pero no autorizó usar su perfil en esta consulta. Explicá que necesitás activar 'Usar mi perfil docente' para calcular compatibilidad. No concluyas que no hay capacitaciones y no calcules coincidencias." : "";
  return { intent, sources, context: `INTENCIÓN DETECTADA: ${intent}.\n${panelContext}\n${profileText}\n\nREGISTROS OFICIALES RECUPERADOS:\n${records || "No se recuperaron registros oficiales suficientes."}${agendaText}${trackingText}${failureText}${unverifiedText}${evidenceGuidance}${trainingGuidance}${matchingGuidance}${appHelp}` };
}
