// Runs in Node against isolated D1. A failed insert never marks its reminder sent.
const sources = [
  {
    table: "training_reminders", flag: "notified", touch: true, type: "CAPACITACION_ABRE",
    select: "SELECT id,user_id,publication_id,opens_at,advance_minutes,remind_at FROM training_reminders WHERE notified=0 AND datetime(remind_at)<=datetime(?) ORDER BY remind_at,id LIMIT ?",
    key: (row) => `training-reminder:${row.id}:${row.opens_at}:${row.advance_minutes ?? 0}`,
    where: "id=? AND remind_at=? AND notified=0",
    args: (row) => [row.id, row.remind_at],
  },
  {
    table: "designation_tracking", flag: "reminder_notified", touch: true, type: "DESIGNACION_RECORDATORIO",
    select: "SELECT id,user_id,publication_id,reminder_at FROM designation_tracking WHERE reminder_notified=0 AND reminder_at IS NOT NULL AND datetime(reminder_at)<=datetime(?) ORDER BY reminder_at,id LIMIT ?",
    key: (row) => `designation-reminder:${row.id}:${row.reminder_at}`,
    where: "id=? AND reminder_at=? AND reminder_notified=0",
    args: (row) => [row.id, row.reminder_at],
  },
  {
    table: "saved_publications", flag: "agenda_reminder_notified", touch: false, type: "AGENDA_RECORDATORIO",
    select: "SELECT user_id,publication_id,agenda_reminder_at FROM saved_publications WHERE in_agenda=1 AND agenda_reminder_notified=0 AND agenda_reminder_at IS NOT NULL AND datetime(agenda_reminder_at)<=datetime(?) ORDER BY agenda_reminder_at,user_id,publication_id LIMIT ?",
    key: (row) => `agenda-reminder:${row.user_id}:${row.publication_id}:${row.agenda_reminder_at}`,
    where: "user_id=? AND publication_id=? AND agenda_reminder_at=? AND in_agenda=1 AND agenda_reminder_notified=0",
    args: (row) => [row.user_id, row.publication_id, row.agenda_reminder_at],
  },
];

export async function materializeExternalReminderBatch(db, { limit = 10, now = new Date() } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10 || !(now instanceof Date) || !Number.isFinite(now.getTime()))
    throw new Error("EXTERNAL_REMINDERS_INVALID");
  let remaining = limit, inserted = 0, processed = 0;
  for (const source of sources) {
    if (!remaining) break;
    const due = await db.prepare(source.select).bind(now.toISOString(), remaining).all();
    for (const row of due.results || []) {
      const key = source.key(row);
      const args = source.args(row);
      const notice = await db.prepare(`INSERT OR IGNORE INTO notifications (user_id,publication_id,type,dedupe_key,scheduled_at)
        SELECT user_id,publication_id,?,?,? FROM ${source.table} WHERE ${source.where}`)
        .bind(source.type, key, now.toISOString(), ...args).run();
      // A retry can find an already inserted notice. Mark only that exact due version.
      const done = await db.prepare(`UPDATE ${source.table} SET ${source.flag}=1${source.touch ? ",updated_at=CURRENT_TIMESTAMP" : ""} WHERE ${source.where}
        AND EXISTS (SELECT 1 FROM notifications WHERE user_id=? AND dedupe_key=?)`)
        .bind(...args, row.user_id, key).run();
      inserted += Number(notice.meta?.rows_written || 0);
      processed += Number(done.meta?.rows_written || 0);
    }
    remaining -= (due.results || []).length;
  }
  return { considered: limit - remaining, inserted, processed };
}
