import type { Publication } from "./types";

export const DESIGNATION_STATUSES = ["GUARDADO", "ME INTERESA", "PENDIENTE", "INSCRIPTO", "PRESENTARME", "FINALIZADO", "NO OBTENIDO", "OBTENIDO"] as const;
export type DesignationStatus = typeof DESIGNATION_STATUSES[number];

export function designationFacts(item: Pick<Publication, "title" | "area" | "location" | "shift" | "junta" | "official_url">) {
  const parts = item.title.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
  return {
    school: parts.length > 2 ? parts.slice(0, 2).join(" - ") : parts.length === 2 ? parts[0] : "",
    role: parts.length > 2 ? parts.slice(2).join(" - ") : parts.length === 2 ? parts[1] : item.area || item.title,
    locality: item.location || (parts.length > 2 ? parts[1] : ""),
    shift: item.shift,
    board: item.junta,
    officialUrl: item.official_url,
  };
}

