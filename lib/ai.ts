import { profileMatch } from "./matching.ts";
import { parseTrainingMetadata } from "./training.ts";
import { usefulMetadata } from "./useful-information.ts";
import type { DesignationTracking, Profile, Publication } from "./types.ts";

export type AIConfig = { provider: string; apiKey: string; model: string };
export type AISource = { id: string; title: string; source: string; sourceType: "official" | "internal" | "complementary"; url: string; updatedAt: string; status: string };
export type AIIntent = "capacitaciones" | "vacantes" | "designaciones" | "llamados" | "agenda" | "perfil" | "novedades" | "documentos" | "informacion" | "busqueda_general" | "conversacion_general";
export type AIContextInput = { type: string; id?: string; title?: string };
export type AIContextOptions = { profile?: Profile; agendaIds?: string[]; designations?: DesignationTracking[]; context?: AIContextInput; now?: Date };
export interface AIProvider { generate(input: string, instructions: string): Promise<string>; }

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
const forMatch = (item: Publication) => ({ kind: item.kind, title: item.title, summary: item.summary, level: item.level, area: item.area, junta: item.junta, location: item.location, shift: item.shift, character: item.character, circuit: item.circuit, sourceCircuitRaw: item.source_circuit_raw });
const matchProfile = (profile: Profile) => ({ levels: profile.levels, areas: profile.areas, subjects: profile.subjects, boards: profile.boards, roles: profile.roles, department: profile.department, locality: profile.locality, shifts: profile.shifts, characters: profile.characters, circuits: profile.circuits, personalMatchThreshold: profile.personal_match_threshold, wantsInterim: Boolean(profile.wants_interim), wantsSubstitute: Boolean(profile.wants_substitute), trainingInterests: profile.training_interests });
const dayKey = (value: Date | string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(typeof value === "string" ? new Date(value) : value);

export function detectIntent(question: string): AIIntent {
  const query = normalize(question);
  if (/\b(mi agenda|mis eventos|que tengo|proximo evento|agend)/.test(query)) return "agenda";
  if (/\b(designacion|donde me inscribi|presentarme|obtuve|cargo.*inscrib)/.test(query)) return "designaciones";
  if (/\b(sueldo|haber|cobr|liquid|boleta|legajo|jubil|previsional|ciidept|cendie|digituc|titulo|certificado|licencia|sesop|expediente|sinide|sime|fdci|oficina|direccion|telefono|horario|tramite)/.test(query)) return "informacion";
  if (/\b(llamad[^ ]* abiert|convocatoria)/.test(query)) return "llamados";
  if (/\b(capacit|curso|inscrip|cupo)/.test(query)) return "capacitaciones";
  if (/\b(vacant|cargo|horas? catedra)/.test(query)) return "vacantes";
  if (/\b(mi perfil|para mi perfil|coincide conmigo|que me sirve)/.test(query)) return "perfil";
  if (/\b(novedad|ultima|reciente)/.test(query)) return "novedades";
  if (/\b(document|padron|comunicado|resolucion|junta)/.test(query)) return "documentos";
  if (/^(hola|buenas|buen dia|gracias|chau)[!. ]*$/.test(query)) return "conversacion_general";
  return "busqueda_general";
}

function requestedDay(question: string, now: Date) {
  const query = normalize(question), date = new Date(now);
  if (/\bmanana\b/.test(query)) date.setDate(date.getDate() + 1);
  else if (!/\bhoy\b/.test(query)) {
    const weekdays = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
    const wanted = weekdays.findIndex((day) => new RegExp(`\\b${day}\\b`).test(query));
    if (wanted < 0) return null;
    date.setDate(date.getDate() + ((wanted - date.getDay() + 7) % 7));
  }
  return dayKey(date);
}

export function retrievePublications(question: string, publications: Publication[], limit = 8, options: AIContextOptions = {}) {
  const query = normalize(question), words = tokens(question), agenda = new Set(options.agendaIds || []), intent = detectIntent(question);
  if (/\b(no existe|inexistente|fictici|inventad)/.test(query)) return [];
  const wantsTraining = intent === "capacitaciones", wantsVacancy = ["vacantes", "designaciones"].includes(intent);
  const wantsAgenda = intent === "agenda", now = options.now || new Date(), requested = wantsAgenda ? requestedDay(question, now) : null;
  const wantsMatches = /coincid|compatible|sirve|para mi perfil/.test(query);
  const configuredProfile = options.profile ? matchProfile(options.profile) : null;
  return publications.map((item) => {
    if (wantsAgenda && !agenda.has(item.id)) return { item, score: -1 };
    if (wantsTraining && item.kind !== "capacitacion") return { item, score: -1 };
    if (wantsVacancy && !wantsTraining && item.kind !== "vacante") return { item, score: -1 };
    if (intent === "llamados" && !normalize(item.category).includes("llamado")) return { item, score: -1 };
    if (intent === "documentos" && item.kind !== "junta") return { item, score: -1 };
    if (intent === "informacion" && item.kind !== "informacion") return { item, score: -1 };
    const eventDate = item.ends_at || item.starts_at || (item.kind === "capacitacion" ? parseTrainingMetadata(item.metadata)?.registrationOpensAt : undefined);
    if (requested && (!eventDate || dayKey(eventDate) !== requested)) return { item, score: -1 };
    if (wantsAgenda && /esta semana/.test(query) && (!eventDate || new Date(eventDate).getTime() < now.getTime() || new Date(eventDate).getTime() > now.getTime() + 7 * 86400000)) return { item, score: -1 };
    const match = configuredProfile ? profileMatch(forMatch(item), configuredProfile) : null;
    if (wantsMatches && (!match || !["exact", "partial"].includes(match.status))) return { item, score: -1 };
    const haystack = normalize([item.title, item.summary, item.kind, item.category, item.level, item.area, item.location, item.status].join(" "));
    let score = words.reduce((total, word) => total + (haystack.includes(word) ? 2 : 0), 0);
    if (item.id === options.context?.id) score += 100;
    if (wantsAgenda && agenda.has(item.id)) score += 20;
    if (wantsMatches && match) score += match.score;
    if (/proxim|abre|semana|primero/.test(query) && item.status === "próximamente") score += 8;
    if (/abiert|inscrip/.test(query) && item.status === "inscripción abierta") score += 5;
    if (/ultima|novedad|reciente/.test(query)) score += Math.max(0, 5 - (Date.now() - new Date(item.updated_at).getTime()) / 86400000);
    return { item, score };
  }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score || new Date(a.item.ends_at || a.item.starts_at || "9999").getTime() - new Date(b.item.ends_at || b.item.starts_at || "9999").getTime()).slice(0, limit).map(({ item }) => item);
}

export function buildAIContext(question: string, publications: Publication[], options: AIContextOptions = {}) {
  const selected = retrievePublications(question, publications, 8, options);
  const sources: AISource[] = selected.map((item) => ({ id: item.id, title: item.title, source: item.source, sourceType: "official", url: item.official_url, updatedAt: item.updated_at, status: item.status }));
  const configuredProfile = options.profile ? matchProfile(options.profile) : null;
  const records = selected.map((item, index) => {
    const training = item.kind === "capacitacion" ? parseTrainingMetadata(item.metadata) : null;
    const useful = item.kind === "informacion" ? usefulMetadata(item.metadata) : null;
    const match = configuredProfile ? profileMatch(forMatch(item), configuredProfile) : null;
    const usefulFacts = useful ? `\nDatos oficiales publicados: tipo ${useful.recordType}; domicilio ${useful.address || "no publicado"}; horario ${useful.openingHours || "no publicado"}; teléfonos ${(useful.phones || []).join("; ") || "no publicados"}; correos ${(useful.emails || []).join("; ") || "no publicados"}; servicios ${(useful.services || []).join("; ") || "no publicados"}; requisitos/documentación ${[...(useful.requirements || []), ...(useful.documents || [])].join("; ") || "no publicados"}; organismo ${useful.parentOrganization || "no publicado"}; acceso ${useful.access || "no informado"}; verificado ${useful.lastVerified}. ${useful.notes || ""} ${useful.discrepancy || ""}` : "";
    return `[${index + 1}] ${item.title}\nTipo: ${item.category || item.kind}. Estado: ${item.status}. Nivel: ${item.level || "No informado"}. Área: ${item.area || "No informada"}. Lugar: ${item.location || "No informado"}. Circuito: ${item.circuit || "UNKNOWN"} (${item.circuit_inference_source || "unknown"}). Inicio: ${item.starts_at || "No informado"}. Cierre: ${item.ends_at || "No informado"}. Apertura de inscripción: ${training?.registrationOpensAt || "No informada"}. Cierre de inscripción: ${training?.registrationClosesAt || "No informado"}. Cupo: ${training?.capacity ?? training?.preCapacity ?? "No informado"}. Requisitos: ${useful ? "ver datos oficiales publicados" : "No informados"}. Puntaje: No informado.${match ? ` Compatibilidad calculada por DocenteTuc: ${match.score}%; confianza: ${match.confidence}%; resultado: ${match.status}.` : ""} Detalle: ${(item.summary || "No informado").slice(0, item.kind === "junta" ? 6000 : item.kind === "informacion" ? 3000 : 900)}${usefulFacts}\nFuente: ${item.source}. URL: ${item.official_url}`;
  }).join("\n\n");
  const profileText = options.profile ? `Perfil autorizado: niveles ${options.profile.levels.join(", ") || "no informados"}; áreas ${options.profile.areas.join(", ") || "no informadas"}; materias ${options.profile.subjects.join(", ") || "no informadas"}; cargos ${options.profile.roles?.join(", ") || "no informados"}; localidad ${options.profile.locality || "no informada"}; circuitos ${options.profile.circuits?.join(", ") || "no seleccionados"}; intereses ${options.profile.training_interests.join(", ") || "no informados"}.` : "El usuario no autorizó usar su perfil.";
  const trackingText = options.designations?.length ? `\n\nSEGUIMIENTO PERSONAL DE DESIGNACIONES (datos ingresados por el usuario):\n${options.designations.map((item) => `${item.role || "Cargo no informado"} · ${item.school || "Establecimiento no informado"} · estado ${item.status} · inscripción ${item.applied_at || "no informada"} · designación ${item.appointment_at || "no informada"} · notas ${item.notes || "sin notas"}`).join("\n")}` : "";
  const panelContext = options.context ? `Contexto del panel: tipo ${options.context.type}; identificador ${options.context.id || "sin identificador"}; título ${options.context.title || "sin título"}.` : "Contexto del panel no informado.";
  return { intent: detectIntent(question), sources, context: `${panelContext}\n${profileText}\n\nREGISTROS OFICIALES RECUPERADOS:\n${records || "No se recuperaron registros oficiales suficientes."}${trackingText}` };
}
