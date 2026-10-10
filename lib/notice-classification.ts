import { isEligibleMatchResult, type MatchResult } from "./matching.ts";
import { officialMetadata } from "./official-publication.ts";

type NoticeLike = { kind?: string; category?: string; junta?: string; title?: string; summary?: string; metadata?: string };
export type NoticeClassification = "PERSONALIZADO" | "GENERAL" | "NO_RELACIONADO";

export function isGeneralNotice(item: NoticeLike) {
  const official = officialMetadata(item);
  if (official && (official.canonicalId || official.entity !== "notice" || official.topics.includes("CLASIFICACION_PENDIENTE"))) return false;
  if (item.kind !== "junta" || !String(item.category || "").toLocaleLowerCase("es").includes("comunicado")) return false;
  const junta = String(item.junta || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim();
  const copy = `${item.title || ""} ${item.summary || ""}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
  return !junta || /^(general|todas|provincial)$/.test(junta) || /comunicado general|para todos los docentes/.test(copy);
}

export function classifyNotice(item: NoticeLike, match: MatchResult, threshold = 85): NoticeClassification {
  if (isGeneralNotice(item)) return "GENERAL";
  if (item.kind === "junta" && String(item.category || "").toLocaleLowerCase("es").includes("comunicado") && isEligibleMatchResult(match, threshold)) return "PERSONALIZADO";
  return "NO_RELACIONADO";
}
