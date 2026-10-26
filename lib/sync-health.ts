export type SourceHealth = {
  source: string;
  sync_status: string;
  last_attempt_at: string | null;
  last_successful_sync_at: string | null;
};

export async function readSyncHealth(db: D1Database): Promise<SourceHealth[]> {
  const result = await db.prepare(`SELECT source,sync_status,last_attempt_at,last_successful_sync_at
    FROM sync_state ORDER BY source LIMIT 20`).all<SourceHealth>();
  return result.results;
}
