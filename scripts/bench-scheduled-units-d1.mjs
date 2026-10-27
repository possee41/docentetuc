// Isolated D1 accounting for the functions invoked by scheduled routes.
// Wall time includes Node and Workerd IPC; it is not Worker CPU time.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { purgeExpiredCommunityContent } from "../lib/community.ts";
import { dispatchPushNotifications, materializeScheduledNotifications } from "../lib/push.ts";
import { runExternalMaterialization } from "./materialize-external.mjs";
import { connectWorkerdCpuProfiler } from "./workerd-cpu-profiler.mjs";

const require = createRequire(import.meta.url);
const { Miniflare } = require("../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare");
const profile = process.argv.includes("--profile");
const workerdScript = profile ? (await require("../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild").build({
  stdin: { contents: `
    import { purgeExpiredCommunityContent } from './lib/community.ts';
    import { materializeScheduledNotifications, dispatchPushNotifications } from './lib/push.ts';
    export default { async fetch(request, env) {
      const now = new Date('2026-10-26T12:00:00Z');
      const path = new URL(request.url).pathname;
      const started = performance.now();
      const provider = { send: async () => ({ ok: true, status: 201 }) };
      const vapid = { VAPID_PUBLIC_KEY: 'synthetic', VAPID_PRIVATE_KEY: 'synthetic', VAPID_SUBJECT: 'mailto:test@example.invalid' };
      const result = path === '/retention' ? await purgeExpiredCommunityContent(env.DB, now.getTime()) :
        path === '/materialize' ? await materializeScheduledNotifications(env.DB, now) :
        await dispatchPushNotifications(env.DB, vapid, now, provider);
      return Response.json({ result, wallMs: Math.round(performance.now() - started) });
    } };`, resolveDir: process.cwd(), sourcefile: "scheduled-bench-worker.ts", loader: "ts" },
  bundle: true, write: false, format: "esm", platform: "browser", target: "es2022",
})).outputFiles[0].text : "export default { fetch() { return new Response('isolated'); } }";
const mf = new Miniflare({ modules: true, script: workerdScript, d1Databases: ["DB"],
  ...(profile ? { inspectorHost: "127.0.0.1", inspectorPort: 9241 } : {}) });

function measured(raw) {
  const metrics = { calls: 0, statements: 0, rowsRead: 0, rowsWritten: 0 };
  const record = (result) => {
    metrics.statements++;
    metrics.rowsRead += Number(result.meta?.rows_read || 0);
    metrics.rowsWritten += Number(result.meta?.rows_written || 0);
    return result;
  };
  return { metrics, db: {
    prepare: (sql) => {
      const bound = (...params) => {
      const statement = raw.prepare(sql).bind(...params);
      return { raw: statement,
        run: async () => { metrics.calls++; return record(await statement.run()); },
        all: async () => { metrics.calls++; return record(await statement.all()); },
        first: async () => { metrics.calls++; return record(await statement.all()).results[0] || null; },
      };
      };
      return { ...bound(), bind: bound };
    },
    batch: async (statements) => {
      metrics.calls++;
      return (await raw.batch(statements.map((statement) => statement.raw))).map(record);
    },
  } };
}

async function timed(work) {
  const started = performance.now();
  const result = await work();
  return { result, wallMs: Math.round(performance.now() - started) };
}

let profiler;
try {
  const raw = await mf.getD1Database("DB");
  for (const sql of [
    "CREATE TABLE community_posts(id TEXT PRIMARY KEY,moderation_status TEXT,moderated_at TEXT)",
    "CREATE TABLE community_comments(id TEXT PRIMARY KEY,post_id TEXT,moderation_status TEXT,moderated_at TEXT)",
    "CREATE TABLE community_moderation_events(id TEXT PRIMARY KEY,post_id TEXT,comment_id TEXT)",
    "CREATE TABLE training_reminders(id TEXT,user_id TEXT,publication_id TEXT,opens_at TEXT,advance_minutes INTEGER,notified INTEGER,remind_at TEXT,updated_at TEXT)",
    "CREATE TABLE designation_tracking(id TEXT,user_id TEXT,publication_id TEXT,reminder_notified INTEGER,reminder_at TEXT,updated_at TEXT)",
    "CREATE TABLE saved_publications(user_id TEXT,publication_id TEXT,in_agenda INTEGER,agenda_reminder_notified INTEGER,agenda_reminder_at TEXT)",
    "CREATE TABLE manual_events(id TEXT,user_id TEXT,title TEXT,starts_at TEXT,recurrence TEXT,reminder_minutes INTEGER,reminder_at TEXT,reminder_notified INTEGER,updated_at TEXT)",
    "CREATE TABLE manual_event_push_queue(id INTEGER PRIMARY KEY,user_id TEXT,event_id TEXT,title TEXT,occurrence_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE profiles(user_id TEXT PRIMARY KEY,notify_new_trainings INTEGER,training_notify_scope TEXT,level TEXT,area TEXT,training_interests TEXT)",
    "CREATE TABLE publications(id TEXT PRIMARY KEY,kind TEXT,title TEXT,summary TEXT,level TEXT,area TEXT,junta TEXT,location TEXT,shift TEXT,character TEXT,circuit TEXT,source_circuit_raw TEXT,starts_at TEXT,ends_at TEXT,status TEXT,metadata TEXT,normalized_status TEXT,removed_at TEXT)",
    "CREATE TABLE notifications(id INTEGER PRIMARY KEY,user_id TEXT,publication_id TEXT,type TEXT,dedupe_key TEXT,scheduled_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,attempted_at TEXT,accepted_at TEXT,failure_reason TEXT,read INTEGER DEFAULT 0,UNIQUE(user_id,dedupe_key))",
    "CREATE INDEX idx_notifications_scheduled ON notifications(scheduled_at, read)",
    "CREATE INDEX idx_notifications_user_read ON notifications(user_id, read)",
    "CREATE TABLE external_publication_events(id INTEGER PRIMARY KEY,publication_id TEXT,content_hash TEXT,change TEXT,profile_cursor TEXT,status TEXT,lease_until TEXT,lease_owner TEXT,updated_at TEXT)",
    "CREATE TABLE external_notice_cycle(id INTEGER PRIMARY KEY,cycle_at TEXT,profile_cursor TEXT,status TEXT,lease_owner TEXT,lease_until TEXT,completed_at TEXT)",
    "CREATE TABLE push_subscriptions(endpoint TEXT PRIMARY KEY,user_id TEXT,p256dh TEXT,auth TEXT,expiration_time INTEGER,active INTEGER,created_at TEXT,updated_at TEXT)",
    "CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id,active)",
    "CREATE TABLE push_preferences(user_id TEXT PRIMARY KEY,enabled INTEGER,vacancies INTEGER,trainings INTEGER,commissions INTEGER,reminders INTEGER,date_changes INTEGER,closing_soon INTEGER,boards INTEGER,designation_exact INTEGER,designation_partial INTEGER,designation_roles INTEGER,quiet_start TEXT,quiet_end TEXT,timezone TEXT)",
    "CREATE TABLE push_deliveries(id INTEGER PRIMARY KEY,endpoint TEXT,notification_id INTEGER,event_key TEXT,status TEXT,attempts INTEGER,scheduled_at TEXT,attempted_at TEXT,accepted_at TEXT,sent_at TEXT,failure_reason TEXT,last_error TEXT,next_attempt_at TEXT,UNIQUE(endpoint,event_key))",
  ]) await raw.prepare(sql).run();
  await raw.prepare("INSERT INTO external_notice_cycle(id,cycle_at,profile_cursor,status) VALUES(1,'','','done')").run();

  const now = new Date("2026-10-26T12:00:00Z");
  for (let index = 0; index < 100; index++) {
    await raw.prepare("INSERT INTO community_posts(id,moderation_status,moderated_at) VALUES(?,'hidden','2026-07-01T12:00:00Z')").bind(`p${index}`).run();
    await raw.prepare("INSERT INTO community_comments(id,post_id,moderation_status) VALUES(?,?,'visible')").bind(`c${index}`, `p${index}`).run();
  }
  const retention = [];
  for (let index = 0; index < 5; index++) {
    const { db, metrics } = measured(raw);
    const outcome = await timed(() => purgeExpiredCommunityContent(db, now.getTime()));
    retention.push({ ...outcome.result, ...metrics, wallMs: outcome.wallMs });
  }
  assert.equal((await raw.prepare("SELECT COUNT(*) AS n FROM community_posts").first()).n, 0);

  const push = [];
  for (const count of [25, 100, 500]) {
    await raw.prepare("DELETE FROM profiles").run();
    for (let index = 0; index < count; index++)
      await raw.prepare("INSERT INTO profiles(user_id,notify_new_trainings,training_notify_scope) VALUES(?,1,'all')").bind(`user-${index}`).run();
    const { db, metrics } = measured(raw);
    const outcome = await timed(() => materializeScheduledNotifications(db, now));
    assert.ok(metrics.calls < 50, "sin capacitaciones en ventana no debe recorrer cada perfil");
    push.push({ profiles: count, state: "no-due-notices", ...outcome.result, ...metrics, wallMs: outcome.wallMs });
  }
  await raw.prepare(`INSERT INTO publications(id,kind,title,normalized_status,metadata)
    VALUES('training','capacitacion','Curso sintético','UPCOMING',?)`)
    .bind(JSON.stringify({ dateStatus: "confirmed", registrationOpensAt: "2026-10-27T12:00:00Z",
      registrationClosesAt: "2026-11-03T12:00:00Z" })).run();
  const activePush = [];
  for (const count of [25, 100, 500]) {
    await raw.prepare("DELETE FROM notifications").run();
    await raw.prepare("DELETE FROM profiles").run();
    for (let index = 0; index < count; index++)
      await raw.prepare("INSERT INTO profiles(user_id,notify_new_trainings,training_notify_scope) VALUES(?,1,'all')").bind(`user-${index}`).run();
    const initial = measured(raw);
    const first = await timed(() => materializeScheduledNotifications(initial.db, now));
    const retry = measured(raw);
    const repeated = await timed(() => materializeScheduledNotifications(retry.db, now));
    assert.equal(retry.metrics.rowsWritten, 0, "repetir avisos no escribe duplicados");
    activePush.push({ profiles: count, first: { ...first.result, ...initial.metrics, wallMs: first.wallMs },
      repeated: { ...repeated.result, ...retry.metrics, wallMs: repeated.wallMs } });
  }
  await raw.prepare("DELETE FROM notifications").run();
  const externalDb = measured(raw);
  const external = await timed(() => runExternalMaterialization(externalDb.db, { now }));
  assert.equal(external.result.scheduledNotices, 1000);
  const externalRetryDb = measured(raw);
  const externalRetry = await timed(() => runExternalMaterialization(externalRetryDb.db, { now }));
  assert.equal(externalRetryDb.metrics.rowsWritten, 0);
  await raw.prepare("INSERT INTO publications(id,kind,title,normalized_status) VALUES('p1','capacitacion','Sintética','ACTIVE')").run();
  await raw.prepare("INSERT INTO notifications(user_id,publication_id,type,dedupe_key,scheduled_at) VALUES('dispatch-user','p1','CAPACITACION_NUEVA','synthetic',?)").bind(now.toISOString()).run();
  await raw.prepare("INSERT INTO push_subscriptions(endpoint,user_id,p256dh,auth,active,created_at) VALUES('https://fcm.googleapis.com/synthetic','dispatch-user','synthetic','synthetic',1,'2026-10-20T00:00:00Z')").run();
  const provider = { send: async () => ({ ok: true, status: 201 }) };
  const env = { VAPID_PUBLIC_KEY: "synthetic", VAPID_PRIVATE_KEY: "synthetic", VAPID_SUBJECT: "mailto:test@example.invalid" };
  const firstDispatch = measured(raw);
  const first = await timed(() => dispatchPushNotifications(firstDispatch.db, env, now, provider));
  const retryDispatch = measured(raw);
  const repeat = await timed(() => dispatchPushNotifications(retryDispatch.db, env, now, provider));
  assert.equal(first.result.sent, 1);
  assert.equal(repeat.result.sent, 0);
  // A backlog exercises the actual bounded Worker dispatcher without invoking
  // the legacy profile materializer. Setup writes are excluded from metrics.
  for (let offset = 0; offset < 500; offset += 25) {
    const ids = Array.from({ length: 25 }, (_, index) => `push-${offset + index}`);
    await raw.prepare(`INSERT INTO notifications(user_id,publication_id,type,dedupe_key,scheduled_at)
      VALUES ${ids.map(() => "(?,'p1','CAPACITACION_NUEVA',?,?)").join(",")}`)
      .bind(...ids.flatMap((id) => [id, id, now.toISOString()])).run();
    await raw.prepare(`INSERT INTO push_subscriptions(endpoint,user_id,p256dh,auth,active,created_at)
      VALUES ${ids.map(() => "(?,?, 'synthetic','synthetic',1,'2026-10-20T00:00:00Z')").join(",")}`)
      .bind(...ids.flatMap((id) => [`https://fcm.googleapis.com/${id}`, id])).run();
  }
  const queuedDispatch = measured(raw);
  const queued = await timed(() => dispatchPushNotifications(queuedDispatch.db, env, now, provider));
  assert.equal(queued.result.sent, 2);
  assert.ok(queuedDispatch.metrics.calls <= 50);
  const sampledCpu = {};
  if (profile) {
    for (let index = 0; index < 25; index++) {
      await raw.prepare("INSERT INTO community_posts(id,moderation_status,moderated_at) VALUES(?,'hidden','2026-07-01T12:00:00Z')").bind(`profile-p${index}`).run();
      await raw.prepare("INSERT INTO community_comments(id,post_id,moderation_status) VALUES(?,?,'visible')").bind(`profile-c${index}`, `profile-p${index}`).run();
    }
    profiler = await connectWorkerdCpuProfiler(await mf.getInspectorURL());
    for (const task of ["retention", "retention", "dispatch", "dispatch", "dispatch"]) {
      const measurement = await profiler.measure(() => mf.dispatchFetch(`http://local/${task}`));
      const key = task === "retention" ? sampledCpu.retentionActive ? "retentionIdle" : "retentionActive" : "dispatchQueued";
      if (key === "dispatchQueued") (sampledCpu.dispatchQueued ||= []).push({ ...(await measurement.value.json()), cpu: measurement.cpu });
      else sampledCpu[key] = { ...(await measurement.value.json()), cpu: measurement.cpu };
    }
  }
  console.log(JSON.stringify({ database: "D1 efímera Workerd", retention, push, activePush,
    externalMaterialization: { first: { ...external.result, ...externalDb.metrics, wallMs: external.wallMs },
      repeated: { ...externalRetry.result, ...externalRetryDb.metrics, wallMs: externalRetry.wallMs } },
    dispatch: { first: { ...first.result, ...firstDispatch.metrics, wallMs: first.wallMs },
      repeated: { ...repeat.result, ...retryDispatch.metrics, wallMs: repeat.wallMs },
      queued500: { ...queued.result, ...queuedDispatch.metrics, wallMs: queued.wallMs } },
    sampledCpu: profile ? sampledCpu : null, note: "CPU de CDP es muestreada; wallMs no representa CPU facturada" }));
} finally { profiler?.close(); await mf.dispose(); }
