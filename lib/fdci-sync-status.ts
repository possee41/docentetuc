import type { SyncStatus } from "./types.ts";

type Checkpoint = { upper_key: string; last_cycle_status: string | null; last_completed_at: string | null } | null;

export function fdciSyncStatus(sync: SyncStatus[], checkpoint: Checkpoint): SyncStatus[] {
  if (!checkpoint) return sync;
  const source = "Capacitación Docente";
  const previous = sync.find(row => row.source === source);
  const status = checkpoint.upper_key ? "PARTIAL" : checkpoint.last_cycle_status || "UNKNOWN";
  const success = status === "OK" && checkpoint.last_completed_at
    ? checkpoint.last_completed_at : previous?.last_successful_sync_at || null;
  const current = { ...previous, source, synced_at: success || undefined,
    last_successful_sync_at: success, last_attempt_at: checkpoint.last_completed_at || previous?.last_attempt_at || null,
    sync_status: status };
  return [...sync.filter(row => row.source !== source), current].sort((a, b) => a.source.localeCompare(b.source));
}
