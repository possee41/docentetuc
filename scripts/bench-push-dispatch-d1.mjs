// Isolated Miniflare D1 benchmark. No real push or remote database.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dispatchPushNotifications } from "../lib/push.ts";
import { connectWorkerdCpuProfiler } from "./workerd-cpu-profiler.mjs";

const require = createRequire(import.meta.url);
const { Miniflare } = require("../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare");
const profile = process.argv.includes("--profile");
const workerScript = profile ? (await require("../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild").build({
  stdin: { contents: `
    import { dispatchPushNotifications, isQuietTime } from './lib/push.ts';
    export default { async fetch(request, env) {
      const now = new Date('2026-10-26T12:00:00Z');
      const started = performance.now();
      if (new URL(request.url).pathname === '/quiet') {
        const cached = new URL(request.url).searchParams.has('cached');
        const minuteByTimezone = cached ? new Map() : undefined;
        let matches = 0;
        for (let index = 0; index < 500; index++)
          if (isQuietTime(now, '22:00', '07:00', 'America/Argentina/Buenos_Aires', minuteByTimezone)) matches++;
        return Response.json({ matches, wallMs: performance.now() - started });
      }
      const result = await dispatchPushNotifications(env.DB,
        { VAPID_PUBLIC_KEY: 'synthetic', VAPID_PRIVATE_KEY: 'synthetic', VAPID_SUBJECT: 'mailto:test@example.invalid' },
        now, { send: async () => new Response(null, { status: 201 }) });
      return Response.json({ result, wallMs: performance.now() - started });
    } };`, resolveDir: process.cwd(), sourcefile: "push-dispatch-bench-worker.ts", loader: "ts" },
  bundle: true, write: false, format: "esm", platform: "browser", target: "es2022",
})).outputFiles[0].text : "export default { fetch() { return new Response('isolated'); } }";
const mf = new Miniflare({ modules: true, script: workerScript, d1Databases: ["DB"],
  ...(profile ? { inspectorHost: "127.0.0.1", inspectorPort: 9242 } : {}) });
const withoutIndex = process.argv.includes("--without-existing-index");
const sparseSubscriptions = process.argv.includes("--sparse-subscriptions");
const queryVariant = process.argv.find((arg) => arg.startsWith("--query-variant="))?.split("=")[1] || "current";
assert.ok(["current", "subscription-before-publication", "correlated-title", "subscriber-first", "active-in"].includes(queryVariant));
assert.ok(!profile || queryVariant === "current", "Workerd perfila exclusivamente la consulta real");
const noticeJoin = "FROM notifications n JOIN publications p ON p.id=n.publication_id JOIN push_subscriptions s ON s.user_id=n.user_id AND s.active=1";
function queryForVariant(sql) {
  if (!sql.includes(noticeJoin)) return sql;
  if (queryVariant === "subscription-before-publication") return sql.replace(noticeJoin,
    "FROM notifications n CROSS JOIN push_subscriptions s CROSS JOIN publications p")
    .replace("WHERE n.scheduled_at IS NOT NULL",
      "WHERE s.user_id=n.user_id AND s.active=1 AND p.id=n.publication_id AND n.scheduled_at IS NOT NULL");
  if (queryVariant === "correlated-title") return sql.replace("p.title", "(SELECT title FROM publications p WHERE p.id=n.publication_id) title")
    .replace(noticeJoin, "FROM notifications n CROSS JOIN push_subscriptions s")
    .replace("WHERE n.scheduled_at IS NOT NULL", "WHERE s.user_id=n.user_id AND s.active=1 AND n.scheduled_at IS NOT NULL");
  if (queryVariant === "subscriber-first") return sql.replace(noticeJoin,
    "FROM push_subscriptions s CROSS JOIN notifications n INDEXED BY idx_notifications_user_read JOIN publications p ON p.id=n.publication_id")
    .replace("WHERE n.scheduled_at IS NOT NULL", "WHERE s.active=1 AND n.user_id=s.user_id AND n.scheduled_at IS NOT NULL");
  if (queryVariant === "active-in") return sql.replace("WHERE n.scheduled_at IS NOT NULL",
    "WHERE n.user_id IN (SELECT user_id FROM push_subscriptions WHERE active=1) AND n.scheduled_at IS NOT NULL");
  return sql;
}
const now = new Date("2026-10-26T12:00:00Z");
const env = { VAPID_PUBLIC_KEY: "synthetic", VAPID_PRIVATE_KEY: "synthetic", VAPID_SUBJECT: "mailto:test@example.invalid" };
const provider = { send: async () => new Response(null, { status: 201 }) };

let profiler;
try {
  const raw = await mf.getD1Database("DB");
  for (const sql of [
    "CREATE TABLE publications(id TEXT PRIMARY KEY,title TEXT)",
    "CREATE TABLE notifications(id INTEGER PRIMARY KEY,user_id TEXT,publication_id TEXT,type TEXT,scheduled_at TEXT,created_at TEXT,attempted_at TEXT,accepted_at TEXT,failure_reason TEXT,read INTEGER DEFAULT 0)",
    "CREATE INDEX idx_notifications_scheduled ON notifications(scheduled_at, read)",
    "CREATE INDEX idx_notifications_user_read ON notifications(user_id, read)",
    "CREATE TABLE push_subscriptions(endpoint TEXT PRIMARY KEY,user_id TEXT,p256dh TEXT,auth TEXT,expiration_time INTEGER,active INTEGER,created_at TEXT)",
    "CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id,active)",
    "CREATE TABLE push_preferences(user_id TEXT PRIMARY KEY,enabled INTEGER,vacancies INTEGER,trainings INTEGER,commissions INTEGER,reminders INTEGER,date_changes INTEGER,closing_soon INTEGER,boards INTEGER,designation_exact INTEGER,designation_partial INTEGER,designation_roles INTEGER,quiet_start TEXT,quiet_end TEXT,timezone TEXT)",
    "CREATE TABLE push_deliveries(id INTEGER PRIMARY KEY,endpoint TEXT,notification_id INTEGER,event_key TEXT,status TEXT,attempts INTEGER,next_attempt_at TEXT,attempted_at TEXT,scheduled_at TEXT,sent_at TEXT,accepted_at TEXT,failure_reason TEXT,last_error TEXT,UNIQUE(endpoint,event_key))",
    "CREATE INDEX idx_push_deliveries_retry ON push_deliveries(status,next_attempt_at)",
    "CREATE TABLE manual_event_push_queue(id INTEGER PRIMARY KEY,user_id TEXT,event_id TEXT,title TEXT,created_at TEXT)",
    "CREATE INDEX idx_manual_event_push_due ON manual_event_push_queue(created_at,user_id)",
  ]) if (!withoutIndex || !sql.includes("idx_notifications_scheduled")) await raw.prepare(sql).run();
  await raw.prepare("INSERT INTO publications(id,title) VALUES('p1','Curso sintético')").run();
  const cases = [];
  let plan;
  for (const count of [0, 100, 500, 1000]) {
    await raw.prepare("DELETE FROM notifications").run();
    await raw.prepare("DELETE FROM push_subscriptions").run();
    await raw.prepare("DELETE FROM push_deliveries").run();
    for (let offset = 0; offset < count; offset += 25) {
      const ids = Array.from({ length: Math.min(25, count - offset) }, (_, index) => `u${offset + index}`);
      await raw.prepare(`INSERT INTO notifications(user_id,publication_id,type,scheduled_at,created_at)
        VALUES ${ids.map(() => "(?,'p1','CAPACITACION_NUEVA','2026-10-26T11:00:00Z','2026-10-26T10:00:00Z')").join(",")}`)
        .bind(...ids).run();
      const subscribed = sparseSubscriptions ? ids.filter((id) => Number(id.slice(1)) >= count - 2) : ids;
      if (subscribed.length) await raw.prepare(`INSERT INTO push_subscriptions(endpoint,user_id,p256dh,auth,active,created_at)
        VALUES ${subscribed.map(() => "(?,?,'synthetic','synthetic',1,'2026-10-20T00:00:00Z')").join(",")}`)
        .bind(...subscribed.flatMap((id) => [`https://fcm.googleapis.com/${id}`, id])).run();
    }
    const metrics = { queries: 0, rowsRead: 0, rowsWritten: 0 };
    const db = { prepare(statement) { const sql = queryForVariant(statement); return { bind(...params) { return {
      all: async () => {
        if (count === 500 && statement.includes("FROM notifications n"))
          plan = (await raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...params).all()).results.map((row) => row.detail);
        const result = await raw.prepare(sql).bind(...params).all();
        metrics.queries++; metrics.rowsRead += Number(result.meta?.rows_read || 0);
        return result;
      },
      run: async () => {
        const result = await raw.prepare(sql).bind(...params).run();
        metrics.queries++; metrics.rowsRead += Number(result.meta?.rows_read || 0);
        metrics.rowsWritten += Number(result.meta?.rows_written || 0);
        return result;
      },
    }; } }; } };
    const started = performance.now();
    const result = await dispatchPushNotifications(db, env, now, provider);
    const wallMs = Math.round((performance.now() - started) * 100) / 100;
    assert.equal(result.sent, Math.min(count, 2));
    cases.push({ pending: count, ...result, ...metrics, wallMs });
  }
  let sampledCpu = null;
  if (profile) {
    await raw.prepare("DELETE FROM push_deliveries").run();
    await raw.prepare("UPDATE notifications SET attempted_at=NULL,accepted_at=NULL").run();
    profiler = await connectWorkerdCpuProfiler(await mf.getInspectorURL());
    const single = [];
    for (let index = 0; index < 3; index++) {
      const measurement = await profiler.measure(() => mf.dispatchFetch("http://local/dispatch"));
      single.push({ ...(await measurement.value.json()), cpu: measurement.cpu });
    }
    const aggregate = await profiler.measure(async () => {
      const results = [];
      for (let index = 0; index < 10; index++)
        results.push((await (await mf.dispatchFetch("http://local/dispatch")).json()).result);
      return results;
    });
    const quiet = {};
    for (const mode of ["uncached", "cached"]) {
      const measurement = await profiler.measure(() => mf.dispatchFetch(`http://local/quiet?${mode === "cached" ? "cached" : ""}`));
      quiet[mode] = { ...(await measurement.value.json()), cpu: measurement.cpu };
    }
    sampledCpu = { single, aggregate: { results: aggregate.value, cpu: aggregate.cpu }, quiet };
  }
  console.log(JSON.stringify({ database: "D1 efímera Miniflare", existingDueIndex: !withoutIndex,
    sparseSubscriptions, queryVariant, cases, plan, sampledCpu,
    note: "wallMs incluye IPC de Node; no es CPU facturada" }));
} finally { profiler?.close(); await mf.dispose(); }
