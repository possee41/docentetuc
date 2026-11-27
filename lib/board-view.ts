import type { Publication } from "./types";
import { eventDate, hasOfficialTopic, officialMetadata, officialLifecycle } from "./official-publication.ts";

export type BoardView = "padrones" | "comunicados" | "llamados" | "actos";

export function isRecentTucumanNotice(value: string | null | undefined, now = new Date()) {
  if (!value) return false;
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Tucuman", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return day === today || day === yesterday;
}

// Drive folders and undated files are references, not confirmed active calls.
export function boardItems(publications: Publication[], view: BoardView, now = new Date()): Publication[] {
  const category = { padrones: "Padrones", comunicados: "Comunicados", llamados: "Llamados abiertos", actos: "Actos de designación" }[view];
  const topic = { padrones: "PADRON", comunicados: "OTRO_COMUNICADO", llamados: "LLAMADO_ABIERTO", actos: "ACTO_DESIGNACION" } as const;
  const items = publications.filter((item) => {
    const m = officialMetadata(item);
    if (!m) return view !== "comunicados" && item.kind === "junta" && item.category === category;
    if (m.canonicalId) return false;
    if (view === "comunicados") return m.entity === "notice" && isRecentTucumanNotice(item.source_published_at, now);
    if (view === "padrones" && m.entity === "reference") return item.category === "Padrones";
    return (hasOfficialTopic(item, topic[view]) || view === "llamados" && hasOfficialTopic(item, "CLASIFICACION_PENDIENTE")) && (view !== "actos" || m.entity === "event");
  });
  if (view === "padrones" || view === "comunicados") return items.sort((a, b) => Date.parse(b.source_published_at || b.updated_at) - Date.parse(a.source_published_at || a.updated_at));
  return items.filter((item) => {
    const m = officialMetadata(item);
    if (m) return view === "llamados" ? officialLifecycle(item, now) !== "EXPIRED" : !!eventDate(item) && officialLifecycle(item, now) !== "EXPIRED";
    const start = Date.parse(item.starts_at || ""), end = Date.parse(item.ends_at || "");
    return !item.id.startsWith("padrones:") && Number.isFinite(start) && (Number.isFinite(end) ? end : start) >= now.getTime();
  }).sort((a, b) => (Date.parse(eventDate(a) || a.starts_at || "") || Number.MAX_SAFE_INTEGER) - (Date.parse(eventDate(b) || b.starts_at || "") || Number.MAX_SAFE_INTEGER));
}
