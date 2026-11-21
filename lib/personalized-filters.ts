import { circuitMatches, inferCircuit, TUCUMAN_CIRCUITS } from "./circuits.ts";
import { matchesCharacter, matchesJunta, normalizeSearchText, OFFICIAL_CHARACTERS, OFFICIAL_JUNTAS } from "./juntas.ts";
import { profileMatch } from "./matching.ts";
import { parseTrainingMetadata } from "./training.ts";
import { matchProfileFromUser, publicationForMatch, type PersonalKind } from "./personalized-catalog.ts";
import type { Profile, Publication } from "./types.ts";

export type PersonalFilters = { query: string; junta: string; circuit: string; character: string; source: string; compatibility: string; date: string };
export const emptyPersonalFilters: PersonalFilters = { query: "", junta: "todas", circuit: "todos", character: "todos", source: "todas", compatibility: "todas", date: "" };

export const publicationCircuitMatch = (item: Publication, circuit: string) => {
  if (item.circuit === "ALL") return true;
  const direct = item.circuit && /^[iv]+$|^[1-5]$/i.test(item.circuit) ? `Circuito ${item.circuit}` : item.source_circuit_raw || "";
  const inference = inferCircuit({ explicit: direct, locality: item.location || item.source_circuit_raw || "" });
  return circuitMatches(inference, [circuit]) === true;
};
export const trainingPlatform = (source: string) => { const key = normalizeSearchText(source); return /cenet|inet/.test(key) ? "cenet" : /infod|aulastic/.test(key) ? "infod" : /fdci|capacitacion docente/.test(key) ? "fdci" : "other"; };
export const publicationSearchText = (item: Publication, now = new Date()) => [item.title, item.summary, item.level, item.area, item.junta, item.location, item.character, item.category, item.source, item.metadata, item.circuit, item.source_circuit_raw, item.kind === "vacante" ? "designaciones vacantes" : "", now.getTime() - new Date(`${item.updated_at}Z`).getTime() < 30 * 864e5 ? "novedades" : ""].join(" ");

export function parsePersonalFilters(params: URLSearchParams, kind: PersonalKind): PersonalFilters {
  const filters = Object.fromEntries(Object.keys(emptyPersonalFilters).map(key => [key, params.get(key) ?? emptyPersonalFilters[key as keyof PersonalFilters]])) as PersonalFilters;
  if (Object.values(filters).some(value => value.length > 120) ||
    !["todas", ...OFFICIAL_JUNTAS.map(item => item.id)].includes(filters.junta) ||
    !["todos", ...TUCUMAN_CIRCUITS.map(item => item.id)].includes(filters.circuit) ||
    !(kind === "vacante" ? ["todos", ...OFFICIAL_CHARACTERS] : ["todos", "virtual", "presencial", "semipresencial"]).includes(filters.character) ||
    !["todas", "high", "good", "partial", "low", "unknown"].includes(filters.compatibility) ||
    !["", "week", "month"].includes(filters.date)) throw new Error("Filtros inválidos.");
  return filters;
}

export function passesPersonalFilters(item: Publication, profile: Profile, kind: PersonalKind, filters: PersonalFilters, now = new Date()) {
  if (filters.query.trim() && !normalizeSearchText(publicationSearchText(item, now)).includes(normalizeSearchText(filters.query))) return false;
  if (filters.character !== "todos") {
    if (kind === "vacante" && !matchesCharacter(item.character, filters.character as typeof OFFICIAL_CHARACTERS[number])) return false;
    if (kind === "capacitacion") {
      const value = normalizeSearchText(item.character), modality = filters.character;
      if (!(modality === "virtual" ? /virtual|online|distancia|autoasistida/.test(value) : modality === "presencial" ? /presencial/.test(value) && !/semipresencial|mixta/.test(value) : /semipresencial|mixta|hibrida/.test(value))) return false;
    }
  }
  if (kind === "vacante") {
    if (filters.junta !== "todas" && !matchesJunta(item, filters.junta as typeof OFFICIAL_JUNTAS[number]["id"])) return false;
    if (filters.circuit !== "todos" && !publicationCircuitMatch(item, filters.circuit)) return false;
    return true;
  }
  if (filters.source.startsWith("platform:")) {
    if (trainingPlatform(item.source) !== filters.source.slice("platform:".length)) return false;
  } else if (filters.source !== "todas" && item.source !== filters.source) return false;
  if (filters.source === "platform:fdci" && filters.circuit !== "todos" && !publicationCircuitMatch(item, filters.circuit)) return false;
  if (filters.date) {
    const opensAt = parseTrainingMetadata(item.metadata)?.registrationOpensAt;
    const difference = opensAt ? new Date(opensAt).getTime() - now.getTime() : Number.NaN;
    if (!(difference >= 0 && difference <= (filters.date === "week" ? 7 : 30) * 86_400_000)) return false;
  }
  if (filters.compatibility !== "todas") {
    const match = profileMatch(publicationForMatch(item), matchProfileFromUser(profile));
    const { score, confidence } = match;
    if (!(filters.compatibility === "high" ? score >= 85 && confidence >= 70
      : filters.compatibility === "good" ? score >= 70 && score < 85 && confidence >= 70
      : filters.compatibility === "partial" ? score >= 50 && score < 70 && confidence >= 50
      : filters.compatibility === "low" ? score < 50 && confidence >= 50 : confidence < 50)) return false;
  }
  return true;
}
