import type { Publication } from "./types.ts";

export function tucumanCalendarDay(now: Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Tucuman", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function recentComunicadoDays(now: Date = new Date()) {
  const today = tucumanCalendarDay(now);
  const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
  return { today, yesterday };
}

export function isRecentComunicado(item: Pick<Publication, "id" | "source" | "source_published_at">, now: Date = new Date()) {
  if (item.source !== "Padrones y Comunicados" || !item.id.startsWith("notice:")) return true;
  const { today, yesterday } = recentComunicadoDays(now);
  return item.source_published_at === today || item.source_published_at === yesterday;
}
