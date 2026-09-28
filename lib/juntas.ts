import type { Publication } from "./types";

export const OFFICIAL_JUNTAS = [
  { id: "inicial-primaria", label: "Inicial y Primaria" },
  { id: "secundaria", label: "Secundaria" },
  { id: "tecnica", label: "Técnica, Agrotécnica y No Formal" },
  { id: "superior-especial-artistica", label: "Superior, Especial y Artística" },
] as const;

export type JuntaId = typeof OFFICIAL_JUNTAS[number]["id"];
export const OFFICIAL_CHARACTERS = ["Interino", "Suplente", "Titular"] as const;
export type OfficialCharacter = typeof OFFICIAL_CHARACTERS[number];

export const normalizeSearchText = (value = "") => value
  .toLocaleLowerCase("es")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, " ")
  .trim()
  .replace(/\s+/g, " ");

export function normalizeJunta(value: string): JuntaId | null {
  const text = normalizeSearchText(value);
  if (!text) return null;
  if (/\b(etp|tecnica|agrotecnica|no formal|formacion profesional)\b/.test(text)) return "tecnica";
  if (/\b(inicial|primaria)\b/.test(text)) return "inicial-primaria";
  if (/\b(secundaria|secundario)\b/.test(text)) return "secundaria";
  if (/\b(superior|especial|artistica|organismos de apoyo)\b/.test(text)) return "superior-especial-artistica";
  return null;
}

export function publicationJunta(item: Pick<Publication, "junta" | "level">): JuntaId | null {
  return normalizeJunta(item.junta) || normalizeJunta(item.level);
}

export function matchesJunta(item: Pick<Publication, "junta" | "level">, junta: JuntaId | "todas") {
  return junta === "todas" || publicationJunta(item) === junta;
}

export function normalizeCharacter(value: string): OfficialCharacter | null {
  const text = normalizeSearchText(value);
  if (/\binterin[oa]?\b/.test(text)) return "Interino";
  if (/\bsuplent[ea]?\b|\bsuplenci\w*\b/.test(text)) return "Suplente";
  if (/\btitular\b/.test(text)) return "Titular";
  return null;
}

export function matchesCharacter(value: string, character: OfficialCharacter | "todos") {
  return character === "todos" || normalizeCharacter(value) === character;
}
