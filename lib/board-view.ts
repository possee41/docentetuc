import type { Publication } from "./types";

export type BoardView = "padrones" | "comunicados" | "llamados" | "actos";

// Drive folders and undated files are references, not confirmed active calls.
export function boardItems(publications: Publication[], view: BoardView, now = new Date()): Publication[] {
  const category = { padrones: "Padrones", comunicados: "Comunicados", llamados: "Llamados abiertos", actos: "Actos de designación" }[view];
  const items = publications.filter((item) => item.kind === "junta" && item.category === category);
  if (view === "padrones" || view === "comunicados") return items.sort((a, b) => Date.parse(b.source_published_at || b.updated_at) - Date.parse(a.source_published_at || a.updated_at));
  return items.filter((item) => {
    const start = Date.parse(item.starts_at || ""), end = Date.parse(item.ends_at || "");
    return !item.id.startsWith("padrones:") && Number.isFinite(start) && (Number.isFinite(end) ? end : start) >= now.getTime();
  }).sort((a, b) => Date.parse(a.starts_at || "") - Date.parse(b.starts_at || ""));
}
