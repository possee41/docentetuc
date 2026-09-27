import { profileMatch } from "./matching.ts";
import { parseTrainingMetadata } from "./training.ts";
import type { Profile, Publication } from "./types.ts";

export type AIConfig = { provider: string; apiKey: string; model: string };
export type AISource = { id: string; title: string; source: string; url: string; updatedAt: string; status: string };
export type AIContextInput = { type: string; id?: string; title?: string };
export type AIContextOptions = { profile?: Profile; agendaIds?: string[]; context?: AIContextInput };
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
const forMatch = (item: Publication) => ({ kind: item.kind, title: item.title, summary: item.summary, level: item.level, area: item.area, junta: item.junta, location: item.location, shift: item.shift, character: item.character });
const matchProfile = (profile: Profile) => ({ levels: profile.levels, areas: profile.areas, subjects: profile.subjects, boards: profile.boards, department: profile.department, locality: profile.locality, shifts: profile.shifts, wantsInterim: Boolean(profile.wants_interim), wantsSubstitute: Boolean(profile.wants_substitute), trainingInterests: profile.training_interests });

export function retrievePublications(question: string, publications: Publication[], limit = 8, options: AIContextOptions = {}) {
  const query = normalize(question), words = tokens(question), agenda = new Set(options.agendaIds || []);
  const wantsTraining = /capacit|curso|inscrip|abre/.test(query), wantsVacancy = /vacant|designacion|cargo|hora/.test(query);
  const wantsAgenda = /mi agenda|mis eventos|que tengo/.test(query);
  const wantsMatches = /coincid|compatible|sirve|para mi perfil/.test(query);
  const configuredProfile = options.profile ? matchProfile(options.profile) : null;
  return publications.map((item) => {
    if (wantsAgenda && !agenda.has(item.id)) return { item, score: -1 };
    if (wantsTraining && item.kind !== "capacitacion") return { item, score: -1 };
    if (wantsVacancy && !wantsTraining && item.kind !== "vacante") return { item, score: -1 };
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
  const sources: AISource[] = selected.map((item) => ({ id: item.id, title: item.title, source: item.source, url: item.official_url, updatedAt: item.updated_at, status: item.status }));
  const configuredProfile = options.profile ? matchProfile(options.profile) : null;
  const records = selected.map((item, index) => {
    const training = item.kind === "capacitacion" ? parseTrainingMetadata(item.metadata) : null;
    const match = configuredProfile ? profileMatch(forMatch(item), configuredProfile) : null;
    return `[${index + 1}] ${item.title}\nTipo: ${item.kind}. Estado: ${item.status}. Nivel: ${item.level || "no informado"}. Área: ${item.area || "no informada"}. Lugar: ${item.location || "no informado"}. Inicio: ${item.starts_at || "no informado"}. Cierre: ${item.ends_at || "no informado"}. Apertura de inscripción: ${training?.registrationOpensAt || "no informada"}. Cierre de inscripción: ${training?.registrationClosesAt || "no informado"}.${match ? ` Coincidencia calculada por DocenteTuc: ${match.score}% (${match.status}).` : ""} Detalle: ${(item.summary || "no informado").slice(0, 900)}\nFuente: ${item.source}. URL: ${item.official_url}`;
  }).join("\n\n");
  const profileText = options.profile ? `Perfil autorizado: niveles ${options.profile.levels.join(", ") || "no informados"}; áreas ${options.profile.areas.join(", ") || "no informadas"}; materias ${options.profile.subjects.join(", ") || "no informadas"}; localidad ${options.profile.locality || "no informada"}; intereses ${options.profile.training_interests.join(", ") || "no informados"}.` : "El usuario no autorizó usar su perfil.";
  const panelContext = options.context ? `Contexto del panel: tipo ${options.context.type}; identificador ${options.context.id || "sin identificador"}; título ${options.context.title || "sin título"}.` : "Contexto del panel no informado.";
  return { sources, context: `${panelContext}\n${profileText}\n\nREGISTROS OFICIALES RECUPERADOS:\n${records || "No se recuperaron registros oficiales suficientes."}` };
}
