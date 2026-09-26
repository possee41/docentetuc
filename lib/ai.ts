import type { Profile, Publication } from "@/lib/types";

export type AIConfig = { provider: string; apiKey: string; model: string };
export type AISource = { id: string; title: string; source: string; url: string; updatedAt: string; status: string };
export interface AIProvider { generate(input: string, instructions: string): Promise<string>; }

const outputText = (data: Record<string, unknown>) => {
  if (typeof data.output_text === "string") return data.output_text;
  const output = Array.isArray(data.output) ? data.output : [];
  return output.flatMap((item) => typeof item === "object" && item && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: Record<string, unknown>[] }).content : []).map((item) => item.text).filter((value): value is string => typeof value === "string").join("\n");
};

async function request(url: string, init: RequestInit) {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(`El proveedor de IA respondió ${response.status}.`);
    return data;
  } finally { clearTimeout(timeout); }
}

export function createAIProvider(config: AIConfig): AIProvider {
  if (config.provider === "openai") return { async generate(input, instructions) {
    const data = await request("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: config.model, instructions, input, max_output_tokens: 700, store: false }) });
    const text = outputText(data); if (!text) throw new Error("El proveedor no devolvió texto."); return text;
  } };
  if (config.provider === "gemini") return { async generate(input, instructions) {
    const data = await request(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`, { method: "POST", headers: { "x-goog-api-key": config.apiKey, "Content-Type": "application/json" }, body: JSON.stringify({ system_instruction: { parts: [{ text: instructions }] }, contents: [{ role: "user", parts: [{ text: input }] }], generationConfig: { maxOutputTokens: 700 } }) });
    const candidates = Array.isArray(data.candidates) ? data.candidates : [], first = candidates[0] as { content?: { parts?: { text?: string }[] } } | undefined;
    const text = first?.content?.parts?.map((part) => part.text || "").join("\n").trim(); if (!text) throw new Error("El proveedor no devolvió texto."); return text;
  } };
  throw new Error("AI_PROVIDER debe ser openai o gemini.");
}

const normalize = (value = "") => value.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const tokens = (question: string) => [...new Set(normalize(question).split(/[^a-z0-9]+/).filter((word) => word.length > 3 && !["para", "esta", "este", "tengo", "cuales", "sobre", "alguna"].includes(word)))];

export function retrievePublications(question: string, publications: Publication[], limit = 8) {
  const query = normalize(question), words = tokens(question), wantsTraining = /capacit|curso|inscrip|abre/.test(query), wantsVacancy = /vacant|designacion|cargo|hora/.test(query);
  return publications.map((item) => {
    if (wantsTraining && item.kind !== "capacitacion") return { item, score: -1 };
    if (wantsVacancy && !wantsTraining && item.kind !== "vacante") return { item, score: -1 };
    const haystack = normalize([item.title, item.summary, item.kind, item.category, item.level, item.area, item.location, item.status].join(" "));
    let score = words.reduce((total, word) => total + (haystack.includes(word) ? 2 : 0), 0);
    if (/proxim|abre|semana|primero/.test(query) && item.status === "próximamente") score += 8;
    if (/abiert|inscrip/.test(query) && item.status === "inscripción abierta") score += 5;
    if (/ultima|novedad|reciente/.test(query)) score += Math.max(0, 5 - (Date.now() - new Date(item.updated_at).getTime()) / 86400000);
    return { item, score };
  }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score || new Date(a.item.ends_at || a.item.starts_at || "9999").getTime() - new Date(b.item.ends_at || b.item.starts_at || "9999").getTime()).slice(0, limit).map(({ item }) => item);
}

export function buildAIContext(question: string, publications: Publication[], profile?: Profile) {
  const selected = retrievePublications(question, publications);
  const sources: AISource[] = selected.map((item) => ({ id: item.id, title: item.title, source: item.source, url: item.official_url, updatedAt: item.updated_at, status: item.status }));
  const records = selected.map((item, index) => `[${index + 1}] ${item.title}\nTipo: ${item.kind}. Estado: ${item.status}. Nivel: ${item.level || "no informado"}. Área: ${item.area || "no informada"}. Lugar: ${item.location || "no informado"}. Inicio: ${item.starts_at || "no informado"}. Cierre: ${item.ends_at || "no informado"}. Detalle: ${(item.summary || "no informado").slice(0, 900)}\nFuente: ${item.source}. URL: ${item.official_url}`).join("\n\n");
  const profileText = profile ? `Perfil autorizado: nivel ${profile.level || "no informado"}; área ${profile.area || "no informada"}; materias ${profile.subjects || "no informadas"}; localidad ${profile.locality || "no informada"}; intereses ${profile.training_interests || "no informados"}.` : "El usuario no autorizó usar su perfil.";
  return { sources, context: `${profileText}\n\nREGISTROS OFICIALES RECUPERADOS:\n${records || "No se recuperaron registros oficiales suficientes."}` };
}
