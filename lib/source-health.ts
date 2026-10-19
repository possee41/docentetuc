import type { AppView } from "./app-navigation.ts";
import type { SyncStatus } from "./types.ts";

const sources = {
  "Capacitación Docente": { label: "FDCI", url: "https://capacitaciondocente.educaciontuc.gov.ar/" },
  "CeNET / INET": { label: "CeNET / INET", url: "https://cenet.inet.edu.ar/mod/page/view.php?id=30493" },
  "INFoD / AulaS-TIC": { label: "INFoD", url: "https://red.infd.edu.ar/cursos-nacionales-2/" },
  SIME: { label: "SIME", url: "https://sime.educaciontuc.gov.ar/" },
  Comunicados: { label: "Juntas", url: "https://padrones.educaciontuc.gov.ar/" },
  "Llamados abiertos": { label: "Juntas", url: "https://padrones.educaciontuc.gov.ar/" },
} as const;
type SourceName = keyof typeof sources;

export function sourceHealth(row: SyncStatus | undefined, now = new Date()) {
  if (!row) return "unknown" as const;
  const timestamp = (value?: string | null) => value ? Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value.replace(" ", "T")}Z`) : NaN;
  const success = timestamp(row.last_successful_sync_at);
  const attempt = timestamp(row.last_attempt_at);
  if (row.sync_status && row.sync_status !== "OK") return "failed" as const;
  if (Number.isFinite(attempt) && (!Number.isFinite(success) || attempt > success)) return now.getTime() - attempt <= 15 * 60_000 ? "running" as const : "interrupted" as const;
  if (!Number.isFinite(success)) return "unknown" as const;
  return now.getTime() - success > 3 * 60 * 60_000 ? "stale" as const : "current" as const;
}

export function sourceNotices(view: AppView, trainingSource: string, sync: SyncStatus[], now = new Date()) {
  const selected: SourceName[] = view === "capacitaciones"
    ? trainingSource === "platform:fdci" ? ["Capacitación Docente"]
      : trainingSource === "platform:cenet" ? ["CeNET / INET"]
      : trainingSource === "platform:infod" ? ["INFoD / AulaS-TIC"]
      : ["Capacitación Docente", "CeNET / INET", "INFoD / AulaS-TIC"]
    : view === "vacantes" ? ["SIME"]
      : view === "actos" ? ["SIME", "Comunicados"]
      : view === "llamados" ? ["SIME", "Llamados abiertos"]
      : [];
  return selected.map((source) => {
    const row = sync.find((item) => item.source === source);
    return { source, ...sources[source], health: sourceHealth(row, now), lastSuccess: row?.last_successful_sync_at || null };
  }).filter((item) => item.health !== "current");
}
