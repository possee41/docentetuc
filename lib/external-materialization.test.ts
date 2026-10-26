import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { loadScheduledTrainings, materializeScheduledNoticePage, runExternalMaterialization } from "../scripts/materialize-external.mjs";

const now = new Date("2026-10-26T12:00:00Z");

function fixture(profiles = 0) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE publications(id TEXT PRIMARY KEY,source TEXT,kind TEXT,title TEXT,summary TEXT,
    level TEXT,area TEXT,junta TEXT,location TEXT,shift TEXT,character TEXT,circuit TEXT,source_circuit_raw TEXT,
    starts_at TEXT,ends_at TEXT,status TEXT,metadata TEXT,normalized_status TEXT,removed_at TEXT,content_hash TEXT);
    CREATE TABLE profiles(user_id TEXT PRIMARY KEY,notify_new_trainings INTEGER,training_notify_scope TEXT,
      level TEXT,area TEXT,subjects TEXT,junta TEXT,roles TEXT,department TEXT,locality TEXT,shifts TEXT,
      characters TEXT,circuits TEXT,personal_match_threshold INTEGER,training_interests TEXT);
    CREATE TABLE saved_publications(user_id TEXT,publication_id TEXT,in_agenda INTEGER DEFAULT 0,
      agenda_reminder_at TEXT,agenda_reminder_notified INTEGER DEFAULT 0);
    CREATE TABLE notifications(id INTEGER PRIMARY KEY,user_id TEXT,publication_id TEXT,type TEXT,
      dedupe_key TEXT,scheduled_at TEXT,UNIQUE(user_id,dedupe_key));
    CREATE TABLE training_reminders(id TEXT,user_id TEXT,publication_id TEXT,opens_at TEXT,
      advance_minutes INTEGER,remind_at TEXT,notified INTEGER DEFAULT 0,updated_at TEXT);
    CREATE TABLE designation_tracking(id TEXT,user_id TEXT,publication_id TEXT,reminder_at TEXT,
      reminder_notified INTEGER DEFAULT 0,updated_at TEXT);
    CREATE TABLE manual_events(id TEXT,user_id TEXT,title TEXT,starts_at TEXT,reminder_at TEXT,
      reminder_notified INTEGER DEFAULT 0,recurrence TEXT,reminder_minutes INTEGER,updated_at TEXT);
    CREATE TABLE manual_event_push_queue(id INTEGER PRIMARY KEY,user_id TEXT,event_id TEXT,title TEXT,
      occurrence_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(event_id,occurrence_at));`);
  sqlite.exec(readFileSync(new URL("../migrations/0025_external_publication_events.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0028_external_notice_cycle.sql", import.meta.url), "utf8"));
  const add = sqlite.prepare("INSERT INTO profiles(user_id,notify_new_trainings,training_notify_scope) VALUES(?,1,'all')");
  for (let index = 0; index < profiles; index++) add.run(`user-${String(index).padStart(4, "0")}`);
  const metrics = { calls: 0, rowsRead: 0, rowsWritten: 0 };
  const db = { prepare: (sql: string) => ({ bind: (...params: unknown[]) => ({
    first: async () => { metrics.calls++; const row = sqlite.prepare(sql).get(...params as []);
      metrics.rowsRead += row ? 1 : 0; return row ?? null; },
    all: async () => { metrics.calls++; const results = sqlite.prepare(sql).all(...params as []);
      metrics.rowsRead += results.length; return { results }; },
    run: async () => { metrics.calls++; const changes = Number(sqlite.prepare(sql).run(...params as []).changes);
      metrics.rowsWritten += changes; return { meta: { changes, rows_written: changes } }; },
  }) }) };
  const addTraining = (id = "training", overrides = {}) => sqlite.prepare(`INSERT INTO publications
    (id,source,kind,title,normalized_status,metadata,content_hash) VALUES(?,'Capacitación Docente','capacitacion','Curso confirmado','UPCOMING',?,?)`)
    .run(id, JSON.stringify({ dateStatus: "confirmed", registrationOpensAt: "2026-10-27T12:00:00Z",
      registrationClosesAt: "2026-11-03T12:00:00Z", ...overrides }), "a".repeat(64));
  return { sqlite, db, metrics, addTraining };
}

test("ciclos externos con 0, 100, 500 y 1001 perfiles; reintento y avisos sin duplicados", async () => {
  for (const count of [0, 100, 500, 1001]) {
    const { sqlite, db, metrics, addTraining } = fixture(count);
    addTraining();
    const first = await runExternalMaterialization(db, { now });
    assert.equal(first.scheduledComplete, true);
    assert.equal(first.eventsDrained, true);
    assert.equal(first.remindersDrained, true);
    assert.equal(first.scheduledNotices, count * 2);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notifications").get()?.n, count * 2);
    const before = { ...metrics };
    const repeat = await runExternalMaterialization(db, { now });
    assert.equal(repeat.scheduledNotices, 0);
    assert.equal(metrics.rowsWritten, before.rowsWritten);
    assert.equal(sqlite.prepare("SELECT status FROM external_notice_cycle WHERE id=1").get()?.status, "done");
    sqlite.close();
  }
});

test("un paso conserva cursor tras interrupción; lease evita concurrencia y permite reanudar", async () => {
  const { sqlite, db, addTraining } = fixture(30);
  addTraining();
  const trainings = await loadScheduledTrainings(db, now);
  let failed = false;
  const interrupted = { prepare: (sql: string) => {
    const statement = db.prepare(sql);
    if (!sql.startsWith("UPDATE external_notice_cycle SET profile_cursor=?")) return statement;
    return { bind: (...params: unknown[]) => ({ run: async () => {
      if (!failed) { failed = true; throw new Error("D1_INTERRUPTED"); }
      return statement.bind(...params).run();
    } }) };
  } };
  await assert.rejects(materializeScheduledNoticePage(interrupted, { now, trainings }), /D1_INTERRUPTED/);
  assert.equal(sqlite.prepare("SELECT profile_cursor FROM external_notice_cycle").get()?.profile_cursor, "");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notifications").get()?.n, 50);
  const busy = await materializeScheduledNoticePage(db, { now, trainings });
  assert.equal(busy.busy, true);
  const resumedAt = new Date(now.getTime() + 601_000);
  const resumed = await Promise.all([
    materializeScheduledNoticePage(db, { now: resumedAt, trainings }),
    materializeScheduledNoticePage(db, { now: resumedAt, trainings }),
  ]);
  assert.equal(resumed.filter((step) => !step.busy).length, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notifications").get()?.n, 50);
  await materializeScheduledNoticePage(db, { now: resumedAt, trainings });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notifications").get()?.n, 60);
  assert.equal(sqlite.prepare("SELECT status FROM external_notice_cycle").get()?.status, "done");
  sqlite.close();
});

test("fechas no confirmadas, cupo cero y cierre vencido no generan oportunidades", async () => {
  const { sqlite, db, addTraining } = fixture(2);
  addTraining("tentative", { dateStatus: "tentative" });
  addTraining("no-capacity", { entity: "commission", availablePreCapacity: 0 });
  addTraining("expired", { registrationClosesAt: "2026-10-25T12:00:00Z" });
  assert.deepEqual(await loadScheduledTrainings(db, now), []);
  assert.equal((await runExternalMaterialization(db, { now })).scheduledNotices, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notifications").get()?.n, 0);
  sqlite.close();
});

test("un ciclo combina evento de publicación, recordatorio y alertas por fecha sin repetirlos", async () => {
  const { sqlite, db, addTraining } = fixture(2);
  sqlite.prepare("INSERT INTO external_event_sources(source) VALUES('Capacitación Docente')").run();
  addTraining("course", { registrationHasTime: true });
  sqlite.prepare(`INSERT INTO training_reminders
    (id,user_id,publication_id,opens_at,advance_minutes,remind_at,notified)
    VALUES('reminder','user-0000','course','2026-10-27T12:00:00Z',1440,'2026-10-26T11:00:00Z',0)`).run();
  const first = await runExternalMaterialization(db, { now });
  assert.equal(first.eventNotices, 2);
  assert.equal(first.reminders, 1);
  assert.equal(first.scheduledNotices, 4);
  assert.equal(first.eventsDrained && first.remindersDrained && first.scheduledComplete, true);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notifications").get()?.n, 7);
  const repeat = await runExternalMaterialization(db, { now });
  assert.equal(repeat.eventNotices + repeat.reminders + repeat.scheduledNotices, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notifications").get()?.n, 7);
  sqlite.close();
});

test("el Worker despacha push sin invocar materialización ni leer perfiles", () => {
  const route = readFileSync(new URL("../app/api/push/dispatch/route.ts", import.meta.url), "utf8");
  assert.match(route, /dispatchPushNotifications\(getD1\(\), env\)/);
  assert.doesNotMatch(route, /NotificationService|materializeScheduledNotifications|profiles/);
});

test("el workflow de materialización es manual, fijado por SHA y apunta a canary", () => {
  const workflow = readFileSync(new URL("../.github/workflows/materialize-notifications.yml", import.meta.url), "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s*schedule:/m);
  assert.match(workflow, /github\.ref == 'refs\/heads\/feat\/1\.2-sync-integration'/);
  assert.match(workflow, /ref: \$\{\{ vars\.FDCI_IMPORT_REF \}\}/);
  assert.match(workflow, /permissions:\s+contents: read/);
  assert.doesNotMatch(workflow, /DIRECT_D1_TARGET:|DIRECT_D1_PRODUCTION_ENABLED:/);
});
