import { htmlToText } from "./public-documents.ts";
import { normalizeOfficialText } from "./official-publication.ts";
export const BOARD_PORTAL = "https://padrones.educaciontuc.gov.ar/";
export type BoardPlacement = { junta: string; label: string; url: string };
// Preserve every official occurrence, including duplicate folder URLs. Only
// download public Google documents/folders; never follow arbitrary portal hrefs.
export function parseBoardPlacements(html: string): BoardPlacement[] {
  const placements: BoardPlacement[] = [];
  let junta = "";
  for (const m of html.matchAll(/<h4\b[^>]*>([\s\S]*?)<\/h4>|<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    if (m[1] !== undefined) {
      const heading = normalizeOfficialText(htmlToText(m[1]));
      junta = heading.includes("primaria") ? "Inicial y Primaria" : heading.includes("secundaria") ? "Secundaria" : heading.includes("tecnica") ? "Técnica, Agrotécnica y No Formal" : heading.includes("superior") ? "Superior, Especial y Artística" : "";
      continue;
    }
    if (!junta) continue;
    const url = m[2].replace(/&amp;/g, "&");
    if (!/^https:\/\/(?:docs\.google\.com\/document\/d\/[\w-]+\/|drive\.google\.com\/drive\/folders\/[\w-]+)/.test(url)) continue;
    placements.push({ junta, label: htmlToText(m[3]), url });
  }
  if (new Set(placements.map(x => x.junta)).size !== 4) throw new Error("FORMAT_CHANGED Official board portal sections missing");
  return placements;
}
