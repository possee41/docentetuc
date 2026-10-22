import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { materializeExternalReminderBatch } from "../scripts/external-reminders.mjs";

function isolated() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE training_reminders (id TEXT PRIMARY KEY,user_id TEXT,publication_id TEXT,opens_at TEXT,advance_minutes INTEGER,remind_at TEXT,notified INTEGER DEFAULT 0,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE designation_tracking (id TEXT PRIMARY KEY,user_id TEXT,publication_id TEXT,reminder_at TEXT,reminder_notified INTEGER DEFAULT 0,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE saved_publications (user_id TEXT,publication_id TEXT,agenda_reminder_at TEXT,in_agenda INTEGER,agenda_reminder_notified INTEGER DEFAULT 0);
    CREATE TABLE notifications (id INTEGER PRIMARY KEY,user_id TEXT,publication_id TEXT,type TEXT,dedupe_key TEXT,scheduled_at TEXT);
    CREATE UNIQUE INDEX idx_notice_dedupe ON notifications(user_id,dedupe_key);`);
  sqlite.prepare("INSERT INTO training_reminders(id,user_id,publication_id,opens_at,advance_minutes,remind_at) VALUES('t','a','p1','2026-10-23T12:00:00Z',60,'2026-10-22T10:00:00Z')").run();
  sqlite.prepare("INSERT INTO designation_tracking(id,user_id,publication_id,reminder_at) VALUES('d','b','p2','2026-10-22T10:00:00Z')").run();
  sqlite.prepare("INSERT INTO saved_publications(user_id,publication_id,agenda_reminder_at,in_agenda) VALUES('a','p3','2026-10-22T10:00:00Z',1)").run();
  const db = { prepare: (sql: string) => ({ bind: (...params: unknown[]) => ({
    all: async () => ({ results: sqlite.prepare(sql).all(...params as []) }),
    run: async () => ({ meta: { rows_written: Number(sqlite.prepare(sql).run(...params as []).changes) } }),
  }) }) };
  return { sqlite, db };
}

test("recordatorios externos se procesan por lotes sin perder tipos ni duplicar usuarios", async () => {
  const { sqlite, db } = isolated();
  const now = new Date("2026-10-22T12:00:00Z");
  assert.deepEqual(await materializeExternalReminderBatch(db, { limit: 2, now }), { considered: 2, inserted: 2, processed: 2 });
  assert.deepEqual(await materializeExternalReminderBatch(db, { limit: 2, now }), { considered: 1, inserted: 1, processed: 1 });
  assert.deepEqual(await materializeExternalReminderBatch(db, { limit: 2, now }), { considered: 0, inserted: 0, processed: 0 });
  const rows = (sqlite.prepare("SELECT user_id,type FROM notifications ORDER BY id").all() as { user_id: string; type: string }[])
    .map(({ user_id, type }) => ({ user_id, type }));
  assert.deepEqual(rows, [{ user_id: "a", type: "CAPACITACION_ABRE" }, { user_id: "b", type: "DESIGNACION_RECORDATORIO" }, { user_id: "a", type: "AGENDA_RECORDATORIO" }]);
  sqlite.close();
});

test("interrupción tras insertar se reanuda sin duplicar el recordatorio", async () => {
  const { sqlite, db } = isolated();
  let failed = false;
  const interrupted = { prepare: (sql: string) => ({ bind: (...params: unknown[]) => {
    const statement = db.prepare(sql).bind(...params);
    return { ...statement, run: async () => {
      if (!failed && sql.startsWith("UPDATE training_reminders")) { failed = true; throw new Error("D1_INTERRUPTED"); }
      return statement.run();
    } };
  } }) };
  const now = new Date("2026-10-22T12:00:00Z");
  await assert.rejects(materializeExternalReminderBatch(interrupted, { limit: 1, now }), /D1_INTERRUPTED/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notifications").get()?.n, 1);
  assert.deepEqual(await materializeExternalReminderBatch(db, { limit: 1, now }), { considered: 1, inserted: 0, processed: 1 });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notifications").get()?.n, 1);
  sqlite.close();
});
