// Both arms are scoped to the authenticated owner. Manual titles never enter publications.
export const PRIVATE_NOTIFICATIONS_QUERY = `
  SELECT n.id AS id,n.user_id,n.publication_id,n.type,n.created_at,n.read,n.dedupe_key,n.scheduled_at,n.attempted_at,n.accepted_at,n.failure_reason,
    p.title,p.kind,NULL AS manual_event_id,NULL AS occurrence_at
  FROM notifications n JOIN publications p ON p.id=n.publication_id WHERE n.user_id=?
  UNION ALL
  SELECT -q.id,q.user_id,'manual:' || q.event_id,'AGENDA_RECORDATORIO',q.created_at,q.internal_read,
    'manual-reminder:' || q.event_id || ':' || q.occurrence_at,q.created_at,NULL,NULL,NULL,
    q.title,'manual_event',q.event_id,q.occurrence_at
  FROM manual_event_push_queue q JOIN manual_events e ON e.id=q.event_id AND e.user_id=q.user_id
  WHERE q.user_id=? AND q.internal_notice=1
  ORDER BY created_at DESC,id DESC LIMIT 100`;

type Database = { prepare(sql: string): { bind(...values: (string | number)[]): {
  all(): Promise<{ results: unknown[] }>; run(): Promise<unknown>;
} } };

export async function privateNotifications(db: Database, userId: string) {
  try { return await db.prepare(PRIVATE_NOTIFICATIONS_QUERY).bind(userId, userId).all(); }
  catch (error) {
    // Additive release compatibility only; other D1 failures must still reach the caller.
    if (!(error instanceof Error) || !/no such column: q\.internal_(notice|read)\b/i.test(error.message)) throw error;
    return db.prepare("SELECT n.*,p.title,p.kind FROM notifications n JOIN publications p ON p.id=n.publication_id WHERE n.user_id=? ORDER BY n.created_at DESC LIMIT 100").bind(userId).all();
  }
}

export async function readPrivateNotification(db: Database, userId: string, id: number) {
  if (!Number.isSafeInteger(id) || id === 0) throw new Error("INVALID_NOTIFICATION_ID");
  if (id > 0) return db.prepare("UPDATE notifications SET read=1 WHERE id=? AND user_id=? AND read=0").bind(id, userId).run();
  return db.prepare(`UPDATE manual_event_push_queue SET internal_read=1 WHERE id=? AND user_id=? AND internal_notice=1 AND internal_read=0
    AND EXISTS (SELECT 1 FROM manual_events e WHERE e.id=manual_event_push_queue.event_id AND e.user_id=manual_event_push_queue.user_id)`)
    .bind(-id, userId).run();
}
