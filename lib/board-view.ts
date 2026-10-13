import type { Publication } from "./types";
import { eventDate, hasOfficialTopic, officialMetadata } from "./official-publication.ts";

export type BoardView = "padrones" | "comunicados" | "llamados" | "actos";
export type BoardPublication = Pick<Publication, "id" | "kind" | "category" | "metadata" | "starts_at" | "ends_at" | "updated_at" | "source_published_at" | "removed_at" | "normalized_status">;

/** An indexed document is not evidence of a current individual opportunity. */
export function isVerifiedCurrentBoardItem(item: BoardPublication, view: "actos" | "llamados", now = new Date()) {
  if (item.removed_at || ["EXPIRED", "CLOSED", "REMOVED_FROM_SOURCE"].includes(item.normalized_status || "")) return false;
  const m = officialMetadata(item);
  if (!m) {
    const start = Date.parse(item.starts_at || ""), end = Date.parse(item.ends_at || "");
    return !item.id.startsWith("padrones:") && Number.isFinite(start) && (Number.isFinite(end) ? end : start) >= now.getTime();
  }
  if (m.canonicalId || m.issues.some(issue => /conflict/i.test(issue))) return false;
  const fact = view === "actos" ? m.facts.designation : m.facts.registrationEnd;
  if (!fact || fact.status !== "reported" || !fact.evidence.length || !Number.isFinite(Date.parse(fact.value))) return false;
  if (view === "actos" && m.entity !== "event") return false;
  if (view === "llamados") {
    const open = m.facts.registrationStart;
    if (m.entity !== "opportunity" || !["direct", "both"].includes(m.procedure) || !open || open.status !== "reported" ||
      !open.evidence.length || !Number.isFinite(Date.parse(open.value)) || Date.parse(open.value) > Date.parse(fact.value)) return false;
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Tucuman", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return fact.precision === "datetime" ? Date.parse(fact.value) >= now.getTime() : fact.precision === "date" && fact.value >= today;
}

// Drive folders and undated files are references, not confirmed active calls.
export function boardItems<T extends BoardPublication>(publications: T[], view: BoardView, now = new Date()): T[] {
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
  return items.filter(item => isVerifiedCurrentBoardItem(item, view, now))
    .sort((a, b) => (Date.parse(eventDate(a) || a.starts_at || "") || Number.MAX_SAFE_INTEGER) - (Date.parse(eventDate(b) || b.starts_at || "") || Number.MAX_SAFE_INTEGER));
}
