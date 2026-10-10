import type { Publication } from "./types";
import { eventDate, hasOfficialTopic, officialMetadata, officialLifecycle } from "./official-publication.ts";

export type BoardView = "padrones" | "comunicados" | "llamados" | "actos";

// Drive folders and undated files are references, not confirmed active calls.
export function boardItems(publications: Publication[], view: BoardView, now = new Date()): Publication[] {
  const category = { padrones: "Padrones", comunicados: "Comunicados", llamados: "Llamados abiertos", actos: "Actos de designación" }[view];
  const topic = { padrones: "PADRON", comunicados: "OTRO_COMUNICADO", llamados: "LLAMADO_ABIERTO", actos: "ACTO_DESIGNACION" } as const;
  const items = publications.filter((item) => {
    const m = officialMetadata(item);
    if (!m) return item.kind === "junta" && item.category === category;
    if (m.canonicalId) return false;
    if (view === "comunicados") return m.entity === "notice";
    if (view === "padrones" && m.entity === "reference") return item.category === "Padrones";
    return hasOfficialTopic(item, topic[view]) && (view !== "actos" || m.entity === "event");
  });
  if (view === "padrones" || view === "comunicados") return items.sort((a, b) => Date.parse(b.source_published_at || b.updated_at) - Date.parse(a.source_published_at || a.updated_at));
  return items.filter((item) => {
    const m = officialMetadata(item);
    if (m) return view === "llamados" || !!eventDate(item) && officialLifecycle(item, now) !== "EXPIRED";
    const start = Date.parse(item.starts_at || ""), end = Date.parse(item.ends_at || "");
    return !item.id.startsWith("padrones:") && Number.isFinite(start) && (Number.isFinite(end) ? end : start) >= now.getTime();
  }).sort((a, b) => (Date.parse(eventDate(a) || a.starts_at || "") || Number.MAX_SAFE_INTEGER) - (Date.parse(eventDate(b) || b.starts_at || "") || Number.MAX_SAFE_INTEGER));
}
