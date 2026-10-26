import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { runExternalNotificationStep } from "../scripts/external-notifications.mjs";
import { dispatchPushNotifications, type NotificationProvider, type PushMessage } from "./push.ts";

test("recordatorios externos respetan preferencias, envían una vez y no mezclan eventos manuales con avisos", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE publications (id TEXT PRIMARY KEY,title TEXT,content_hash TEXT,normalized_status TEXT,removed_at TEXT,kind TEXT,summary TEXT,level TEXT,area TEXT,junta TEXT,location TEXT,shift TEXT,character TEXT,circuit TEXT,source_circuit_raw TEXT,category TEXT,metadata TEXT,ends_at TEXT,starts_at TEXT,source_updated_at TEXT);
    CREATE TABLE profiles (user_id TEXT PRIMARY KEY,notify_new_trainings INTEGER,training_notify_scope TEXT,level TEXT,area TEXT,subjects TEXT,junta TEXT,roles TEXT,department TEXT,locality TEXT,shifts TEXT,characters TEXT,circuits TEXT,personal_match_threshold INTEGER,wants_interim INTEGER,wants_substitute INTEGER,training_interests TEXT);
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
  sqlite.exec(`INSERT INTO publications(id,title) VALUES ('p1','Capacitación'),('p2','Designación'),('p3','Agenda');
    INSERT INTO profiles(user_id,notify_new_trainings,training_notify_scope,level) VALUES ('user-a',1,'all','Primaria'),('user-b',0,'all','Primaria');
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
    first: async () => sqlite.prepare(sql).get(...params as []) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...params as []) }),
    run: async () => { const changes = Number(sqlite.prepare(sql).run(...params as []).changes);
      return { meta: { rows_written: changes, changes } }; },
  }) }) } as unknown as D1Database;
  const sent: { endpoint: string; message: PushMessage }[] = [];
  const provider: NotificationProvider = { send: async (subscription, message) => {
    sent.push({ endpoint: subscription.endpoint, message });
    return new Response(null, { status: 201 });
  } };
  const now = new Date("2026-10-22T12:00:00Z");
  const hash = "a".repeat(64);
  sqlite.prepare("UPDATE publications SET kind='capacitacion', normalized_status='UPCOMING', metadata=? WHERE id='p1'")
    .run(JSON.stringify({ entity: "commission", dateStatus: "confirmed", registrationHasTime: true, registrationOpensAt: "2026-10-22T13:00:00Z", registrationClosesAt: "2026-10-23T13:00:00Z" }));
  sqlite.prepare(`INSERT INTO publications(id,title,content_hash,normalized_status,kind,metadata,circuit)
    VALUES ('fdci:commission:synthetic','Curso sintético',?,'ACTIVE','capacitacion',?,'UNKNOWN')`)
    .run(hash, JSON.stringify({ entity: "commission", availablePreCapacity: 5, registrationOpensAt: "2026-10-23T12:00:00Z", registrationClosesAt: "2026-10-24T12:00:00Z", dateStatus: "confirmed" }));
  const events = [{ id: "fdci:commission:synthetic", contentHash: hash, change: "created" }];
  await assert.rejects(runExternalNotificationStep(db, { events, now }), /PUSH_PROVIDER_REQUIRED/);
  await assert.rejects(dispatchPushNotifications(db, {}, now, provider), /VAPID_NOT_CONFIGURED/);
  const syntheticEnvironment = { VAPID_PUBLIC_KEY: "synthetic", VAPID_PRIVATE_KEY: "synthetic", VAPID_SUBJECT: "mailto:test@example.invalid" };
  const first = await runExternalNotificationStep(db, { events, now, provider, environment: syntheticEnvironment });
  assert.equal(first.notices.inserted, 1);
  assert.deepEqual(first.reminders, { considered: 5, inserted: 5, processed: 5 });
  assert.deepEqual(first.delivery, { considered: 2, sent: 2, failed: 0, removed: 0, deferred: 0 });
  for (let page = 0; page < 4; page++)
    await dispatchPushNotifications(db, syntheticEnvironment, now, provider);
  assert.equal(sent.length, 5);
  assert.ok(sent.every(({ endpoint }) => endpoint.endsWith("/a")));
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM push_deliveries WHERE status='skipped'").get()?.n, 1);
  const manual = sqlite.prepare("SELECT id FROM manual_event_push_queue").get() as { id: number };
  const notice = sqlite.prepare("SELECT accepted_at FROM notifications WHERE id=?").get(manual.id) as { accepted_at: string | null };
  assert.equal(notice.accepted_at, null, "un evento manual no debe modificar un aviso con el mismo ID numérico");
  const repeated = await runExternalNotificationStep(db, { events, now, provider, environment: syntheticEnvironment });
  assert.equal(repeated.notices.inserted, 0);
  assert.deepEqual(repeated.reminders, { considered: 0, inserted: 0, processed: 0 });
  assert.deepEqual(repeated.delivery, { considered: 0, sent: 0, failed: 0, removed: 0, deferred: 0 });
  assert.equal(sent.length, 5);
  sqlite.prepare(`INSERT INTO notifications(user_id,publication_id,type,dedupe_key,scheduled_at,created_at)
    VALUES('user-a','p1','CAPACITACION_NUEVA','recover-pending','2026-10-22T11:00:00Z','2026-10-22T11:00:00Z')`).run();
  const retryId = (sqlite.prepare("SELECT id FROM notifications WHERE dedupe_key='recover-pending'").get() as { id: number }).id;
  sqlite.prepare(`INSERT INTO push_deliveries(endpoint,notification_id,event_key,status,attempts,scheduled_at,attempted_at)
    VALUES(?,? ,?,'pending',1,'2026-10-22T11:00:00Z','2026-10-22T11:00:00Z')`)
    .run("https://fcm.googleapis.com/a", retryId, `notice:${retryId}`);
  const concurrent = await Promise.all([
    dispatchPushNotifications(db, syntheticEnvironment, now, provider),
    dispatchPushNotifications(db, syntheticEnvironment, now, provider),
  ]);
  assert.equal(concurrent.reduce((sum, result) => sum + result.sent, 0), 1);
  assert.equal(sent.length, 6);
  const recovered = sqlite.prepare("SELECT status,attempts FROM push_deliveries WHERE event_key=?").get(`notice:${retryId}`);
  assert.equal(recovered?.status, "sent");
  assert.equal(recovered?.attempts, 2);
  sqlite.prepare(`INSERT INTO notifications(user_id,publication_id,type,dedupe_key,scheduled_at,created_at)
    VALUES('user-a','p1','CAPACITACION_NUEVA','fresh-pending','2026-10-22T11:00:00Z','2026-10-22T11:00:00Z')`).run();
  const freshId = (sqlite.prepare("SELECT id FROM notifications WHERE dedupe_key='fresh-pending'").get() as { id: number }).id;
  sqlite.prepare(`INSERT INTO push_deliveries(endpoint,notification_id,event_key,status,attempts,scheduled_at,attempted_at)
    VALUES(?,? ,?,'pending',1,'2026-10-22T11:00:00Z','2026-10-22T11:59:00Z')`)
    .run("https://fcm.googleapis.com/a", freshId, `notice:${freshId}`);
  assert.equal((await dispatchPushNotifications(db, syntheticEnvironment, now, provider)).sent, 0);
  assert.equal(sent.length, 6);
  sqlite.close();
});
