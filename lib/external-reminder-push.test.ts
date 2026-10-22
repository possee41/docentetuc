import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { materializeExternalReminderBatch } from "../scripts/external-reminders.mjs";
import { dispatchPushNotifications, type NotificationProvider, type PushMessage } from "./push.ts";

test("recordatorios externos respetan preferencias, envían una vez y no mezclan eventos manuales con avisos", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE publications (id TEXT PRIMARY KEY,title TEXT);
    CREATE TABLE training_reminders (id TEXT PRIMARY KEY,user_id TEXT,publication_id TEXT,opens_at TEXT,advance_minutes INTEGER,remind_at TEXT,notified INTEGER DEFAULT 0,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE designation_tracking (id TEXT PRIMARY KEY,user_id TEXT,publication_id TEXT,reminder_at TEXT,reminder_notified INTEGER DEFAULT 0,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE saved_publications (user_id TEXT,publication_id TEXT,agenda_reminder_at TEXT,in_agenda INTEGER,agenda_reminder_notified INTEGER DEFAULT 0);
    CREATE TABLE manual_events (id TEXT PRIMARY KEY,user_id TEXT,title TEXT,starts_at TEXT,reminder_at TEXT,reminder_notified INTEGER DEFAULT 0,recurrence TEXT DEFAULT 'none',reminder_minutes INTEGER,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE manual_event_push_queue (id INTEGER PRIMARY KEY,user_id TEXT,event_id TEXT,title TEXT,occurrence_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(event_id,occurrence_at));
    CREATE TABLE notifications (id INTEGER PRIMARY KEY,user_id TEXT,publication_id TEXT,type TEXT,dedupe_key TEXT,scheduled_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,attempted_at TEXT,accepted_at TEXT,failure_reason TEXT);
    CREATE UNIQUE INDEX idx_notification_dedupe ON notifications(user_id,dedupe_key);
    CREATE TABLE push_subscriptions (endpoint TEXT PRIMARY KEY,user_id TEXT,p256dh TEXT,auth TEXT,expiration_time INTEGER,active INTEGER DEFAULT 1,created_at TEXT DEFAULT '2026-10-21 00:00:00',updated_at TEXT);
    CREATE TABLE push_preferences (user_id TEXT PRIMARY KEY,enabled INTEGER,reminders INTEGER,vacancies INTEGER DEFAULT 1,trainings INTEGER DEFAULT 1,commissions INTEGER DEFAULT 1,date_changes INTEGER DEFAULT 1,closing_soon INTEGER DEFAULT 1,boards INTEGER DEFAULT 0,designation_exact INTEGER DEFAULT 1,designation_partial INTEGER DEFAULT 1,designation_roles INTEGER DEFAULT 1,quiet_start TEXT,quiet_end TEXT,timezone TEXT);
    CREATE TABLE push_deliveries (id INTEGER PRIMARY KEY,endpoint TEXT,notification_id INTEGER,event_key TEXT,status TEXT,attempts INTEGER,last_error TEXT,next_attempt_at TEXT,scheduled_at TEXT,attempted_at TEXT,accepted_at TEXT,failure_reason TEXT,sent_at TEXT,UNIQUE(endpoint,event_key));`);
  sqlite.exec(`INSERT INTO publications VALUES ('p1','Capacitación'),('p2','Designación'),('p3','Agenda');
    INSERT INTO notifications(user_id,publication_id,type,dedupe_key,scheduled_at) VALUES ('user-z','p3','AGENDA_RECORDATORIO','sentinel','2026-10-22T11:00:00Z');
    INSERT INTO training_reminders(id,user_id,publication_id,opens_at,advance_minutes,remind_at) VALUES
      ('t1','user-a','p1','2026-10-22T13:00:00Z',60,'2026-10-22T11:00:00Z'),
      ('t2','user-b','p1','2026-10-22T13:00:00Z',60,'2026-10-22T11:00:00Z');
    INSERT INTO designation_tracking(id,user_id,publication_id,reminder_at) VALUES ('d1','user-a','p2','2026-10-22T11:00:00Z');
    INSERT INTO saved_publications VALUES ('user-a','p3','2026-10-22T11:00:00Z',1,0);
    INSERT INTO manual_events(id,user_id,title,starts_at,reminder_at) VALUES ('e1','user-a','Evento manual','2026-10-22T13:00:00Z','2026-10-22T11:00:00Z');
    INSERT INTO push_subscriptions(endpoint,user_id,p256dh,auth) VALUES
      ('https://fcm.googleapis.com/a','user-a','synthetic','synthetic'),
      ('https://fcm.googleapis.com/b','user-b','synthetic','synthetic');
    INSERT INTO push_preferences(user_id,enabled,reminders,quiet_start,quiet_end,timezone) VALUES
      ('user-a',1,1,'22:00','07:00','America/Argentina/Buenos_Aires'),
      ('user-b',1,0,'22:00','07:00','America/Argentina/Buenos_Aires');`);
  const db = { prepare: (sql: string) => ({ bind: (...params: unknown[]) => ({
    all: async () => ({ results: sqlite.prepare(sql).all(...params as []) }),
    run: async () => ({ meta: { rows_written: Number(sqlite.prepare(sql).run(...params as []).changes) } }),
  }) }) } as unknown as D1Database;
  const sent: { endpoint: string; message: PushMessage }[] = [];
  const provider: NotificationProvider = { send: async (subscription, message) => {
    sent.push({ endpoint: subscription.endpoint, message });
    return new Response(null, { status: 201 });
  } };
  const now = new Date("2026-10-22T12:00:00Z");
  assert.deepEqual(await materializeExternalReminderBatch(db, { now }), { considered: 5, inserted: 5, processed: 5 });
  await assert.rejects(dispatchPushNotifications(db, {}, now, provider), /VAPID_NOT_CONFIGURED/);
  const syntheticEnvironment = { VAPID_PUBLIC_KEY: "synthetic", VAPID_PRIVATE_KEY: "synthetic", VAPID_SUBJECT: "mailto:test@example.invalid" };
  assert.deepEqual(await dispatchPushNotifications(db, syntheticEnvironment, now, provider), { considered: 5, sent: 4, failed: 0, removed: 0, deferred: 0 });
  assert.equal(sent.length, 4);
  assert.ok(sent.every(({ endpoint }) => endpoint.endsWith("/a")));
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM push_deliveries WHERE status='skipped'").get()?.n, 1);
  const manual = sqlite.prepare("SELECT id FROM manual_event_push_queue").get() as { id: number };
  const notice = sqlite.prepare("SELECT accepted_at FROM notifications WHERE id=?").get(manual.id) as { accepted_at: string | null };
  assert.equal(notice.accepted_at, null, "un evento manual no debe modificar un aviso con el mismo ID numérico");
  assert.deepEqual(await materializeExternalReminderBatch(db, { now }), { considered: 0, inserted: 0, processed: 0 });
  assert.deepEqual(await dispatchPushNotifications(db, syntheticEnvironment, now, provider), { considered: 0, sent: 0, failed: 0, removed: 0, deferred: 0 });
  assert.equal(sent.length, 4);
  sqlite.close();
});
