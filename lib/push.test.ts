import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { categoryForNotification, isPushNotificationDue, isQuietTime, materializeScheduledNotifications, publicationFitsProfileCircuit, PUSH_DELIVERY_BATCH_SIZE, scheduledNotificationTypes, UPSERT_PUSH_SUBSCRIPTION_SQL, validPushEndpoint } from "./push.ts";

test("quiet hours work across midnight in Tucumán", () => {
  assert.equal(isQuietTime(new Date("2026-09-27T02:30:00Z"), "22:00", "07:00", "America/Argentina/Buenos_Aires"), true);
  assert.equal(isQuietTime(new Date("2026-09-27T15:00:00Z"), "22:00", "07:00", "America/Argentina/Buenos_Aires"), false);
});

test("notification types map to user-facing categories", () => {
  assert.equal(categoryForNotification("VACANTE_NUEVA"), "vacancies");
  assert.equal(categoryForNotification("DESIGNACION_EXACTA_CARGO"), "vacancies");
  assert.equal(categoryForNotification("DESIGNACION_RECORDATORIO"), "reminders");
  assert.equal(categoryForNotification("AGENDA_RECORDATORIO"), "reminders");
  assert.equal(categoryForNotification("COMISION_NUEVA"), "commissions");
  assert.equal(categoryForNotification("CIERRE_PROXIMO"), "closing_soon");
  assert.equal(categoryForNotification("CAPACITACION_ACTUALIZADA"), "trainings");
  assert.equal(categoryForNotification("COMUNICADO_ACTUALIZADO"), "boards");
});

test("push endpoints reject arbitrary hosts", () => {
  assert.equal(validPushEndpoint("https://fcm.googleapis.com/fcm/send/example"), true);
  assert.equal(validPushEndpoint("https://example.com/steal"), false);
  assert.equal(validPushEndpoint("http://fcm.googleapis.com/example"), false);
});

test("una suscripción push no puede reasignarse a otra cuenta o instalación", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE push_subscriptions(endpoint TEXT PRIMARY KEY,user_id TEXT,device_id TEXT,p256dh TEXT,auth TEXT,expiration_time INTEGER,user_agent TEXT,active INTEGER,updated_at TEXT,last_seen_at TEXT)");
    const upsert = db.prepare(UPSERT_PUSH_SUBSCRIPTION_SQL);
    const endpoint = "https://fcm.googleapis.com/fcm/send/synthetic";
    assert.equal(upsert.run(endpoint, "device:a", "device-a", "key-a", "auth-a", null, "browser-a").changes, 1);
    assert.equal(upsert.run(endpoint, "account-b", "device-b", "key-b", "auth-b", null, "browser-b").changes, 0);
    const stored = db.prepare("SELECT user_id,device_id,p256dh FROM push_subscriptions WHERE endpoint=?").get(endpoint) as { user_id: string; device_id: string; p256dh: string };
    assert.equal(stored.user_id, "device:a");
    assert.equal(stored.device_id, "device-a");
    assert.equal(stored.p256dh, "key-a");
    assert.equal(upsert.run(endpoint, "device:a", "device-a", "key-a2", "auth-a", null, "browser-a").changes, 1);
  } finally { db.close(); }
});

test("el despacho programa lotes acotados para respetar el presupuesto de CPU del cron", () => {
  assert.equal(PUSH_DELIVERY_BATCH_SIZE, 2);
});

test("el push no reenvía notificaciones históricas sin programación y respeta las futuras", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  assert.equal(isPushNotificationDue(null, now), false);
  assert.equal(isPushNotificationDue("2026-09-28T13:00:00Z", now), false);
  assert.equal(isPushNotificationDue("2026-09-28T11:59:00Z", now), true);
});

test("closing-soon alerts require a saved training and an opted-in alert profile, never a designation", () => {
  const vacancy = { id: "v1", kind: "vacante", title: "Cargo", summary: "", level: "", area: "", junta: "", location: "", shift: "", character: "", starts_at: null, ends_at: "2026-09-28T15:00:00Z", status: "abierta", metadata: "{}" };
  const training = { ...vacancy, id: "t1", kind: "capacitacion", metadata: JSON.stringify({ dateStatus: "confirmed", registrationClosesAt: "2026-09-28T15:00:00Z" }), normalized_status: "ACTIVE" };
  const profile = { user_id: "u1", notify_new_trainings: 1, training_notify_scope: "all" };
  const now = new Date("2026-09-28T12:00:00Z");
  assert.deepEqual(scheduledNotificationTypes(vacancy, profile, true, now), []);
  assert.deepEqual(scheduledNotificationTypes(training, profile, false, now), []);
  assert.deepEqual(scheduledNotificationTypes(training, profile, true, now), ["CIERRE_PROXIMO"]);
});

test("automatic training alerts respect the explicit opt-in", () => {
  const publication = { id: "t1", kind: "capacitacion", title: "Curso", summary: "", level: "", area: "", junta: "", location: "", shift: "", character: "", starts_at: null, ends_at: null, status: "abierta", normalized_status: "UPCOMING", metadata: JSON.stringify({ dateStatus: "confirmed", registrationOpensAt: "2026-09-29T12:00:00Z" }) };
  const now = new Date("2026-09-28T12:00:00Z");
  assert.deepEqual(scheduledNotificationTypes(publication, { user_id: "u1", notify_new_trainings: 0 }, false, now), []);
  assert.ok(scheduledNotificationTypes(publication, { user_id: "u1", notify_new_trainings: 1, training_notify_scope: "all" }, false, now).includes("CAPACITACION_ABRE_MANANA"));
  assert.deepEqual(scheduledNotificationTypes({ ...publication, metadata: JSON.stringify({ registrationOpensAt: "2026-09-29T12:00:00Z", dateStatus: "general_window" }) }, { user_id: "u1", notify_new_trainings: 1, training_notify_scope: "all" }, false, now), []);
});

test("automatic relevant-training alerts include recipient metadata in matching", () => {
  const publication = { id: "t2", kind: "capacitacion", title: "Herramientas para el aula", summary: "", level: "Secundario", area: "", junta: "", location: "Online", shift: "", character: "virtual", circuit: "UNKNOWN", source_circuit_raw: "", starts_at: null, ends_at: null, status: "próximamente", normalized_status: "UPCOMING", metadata: JSON.stringify({ entity: "course", trainingId: "t2", dateStatus: "confirmed", registrationOpensAt: "2026-09-29T12:00:00Z", recipients: "Docentes de nivel Secundario y Matemática" }) };
  const profile = { user_id: "u1", level: "Secundario", notify_new_trainings: 1, training_notify_scope: "relevant", training_interests: "Matemática" };
  const now = new Date("2026-09-28T12:00:00Z");
  assert.ok(scheduledNotificationTypes(publication, profile, false, now).includes("CAPACITACION_ABRE_MANANA"));
});

test("sin capacitaciones en ventana se conservan recordatorios y se omite el recorrido de perfiles", async () => {
  const raw = new DatabaseSync(":memory:");
  try {
    raw.exec(`CREATE TABLE notifications(id INTEGER PRIMARY KEY,user_id TEXT,publication_id TEXT,type TEXT,dedupe_key TEXT,scheduled_at TEXT,UNIQUE(user_id,dedupe_key));
      CREATE TABLE training_reminders(id TEXT,user_id TEXT,publication_id TEXT,opens_at TEXT,advance_minutes INTEGER,notified INTEGER,remind_at TEXT,updated_at TEXT);
      CREATE TABLE designation_tracking(id TEXT,user_id TEXT,publication_id TEXT,reminder_notified INTEGER,reminder_at TEXT,updated_at TEXT);
      CREATE TABLE saved_publications(user_id TEXT,publication_id TEXT,in_agenda INTEGER,agenda_reminder_notified INTEGER,agenda_reminder_at TEXT);
      CREATE TABLE manual_events(id TEXT,user_id TEXT,title TEXT,starts_at TEXT,recurrence TEXT,reminder_minutes INTEGER,reminder_at TEXT,reminder_notified INTEGER,updated_at TEXT);
      CREATE TABLE manual_event_push_queue(id INTEGER PRIMARY KEY,user_id TEXT,event_id TEXT,title TEXT,occurrence_at TEXT,UNIQUE(event_id,occurrence_at));
      CREATE TABLE profiles(user_id TEXT,notify_new_trainings INTEGER);
      CREATE TABLE publications(id TEXT,kind TEXT,title TEXT,summary TEXT,level TEXT,area TEXT,junta TEXT,location TEXT,shift TEXT,character TEXT,circuit TEXT,source_circuit_raw TEXT,starts_at TEXT,ends_at TEXT,status TEXT,normalized_status TEXT,metadata TEXT);
      INSERT INTO training_reminders VALUES('t','u','training','2026-10-27T12:00:00Z',60,0,'2026-10-26T11:00:00Z',NULL);
      INSERT INTO designation_tracking VALUES('d','u','vacancy',0,'2026-10-26T11:00:00Z',NULL);
      INSERT INTO saved_publications VALUES('u','agenda',1,0,'2026-10-26T11:00:00Z');
      INSERT INTO manual_events VALUES('m','u','Reunión','2026-10-27T12:00:00Z','none',NULL,'2026-10-26T11:00:00Z',0,NULL);
      INSERT INTO profiles VALUES('u',1);`);
    let profileQueries = 0;
    const db = { prepare: (sql: string) => {
      if (sql.includes("SELECT * FROM profiles")) profileQueries++;
      const bound = (...values: unknown[]) => {
        const statement = raw.prepare(sql);
        const runSync = () => ({ meta: { rows_written: Number(statement.run(...values as []).changes) } });
        return { runSync, run: async () => runSync(),
          all: async () => ({ results: statement.all(...values as []) }),
          first: async () => statement.get(...values as []) || null };
      };
      return { ...bound(), bind: bound };
    }, batch: async (statements: unknown[]) => (statements as { runSync(): unknown }[]).map((statement) => statement.runSync()) };
    const now = new Date("2026-10-26T12:00:00Z");
    await materializeScheduledNotifications(db as never, now);
    await materializeScheduledNotifications(db as never, now);
    assert.equal(profileQueries, 0);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM notifications").get()?.n, 3);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM manual_event_push_queue").get()?.n, 1);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM training_reminders WHERE notified=1").get()?.n, 1);
  } finally { raw.close(); }
});

test("las alertas territoriales excluyen incompatibilidades y conservan UNKNOWN", () => {
  const profile = { user_id: "u1", circuits: "II, III" };
  assert.equal(publicationFitsProfileCircuit({ circuit: "V", source_circuit_raw: "Circuito V", location: "" }, profile), false);
  assert.equal(publicationFitsProfileCircuit({ circuit: "III", source_circuit_raw: "Circuito III", location: "" }, profile), true);
  assert.equal(publicationFitsProfileCircuit({ circuit: "ALL", source_circuit_raw: "Todos los circuitos", location: "" }, profile), true);
  assert.equal(publicationFitsProfileCircuit({ circuit: "UNKNOWN", source_circuit_raw: "", location: "" }, profile), true);
});
