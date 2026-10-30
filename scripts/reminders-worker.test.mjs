import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "../workers/notices-receiver.mjs";
import { checkReminderAutomation, resolveReminderTarget, runReminderStep } from "./reminders-worker.mjs";

const endpoint = "https://docentetuc-notices-1-2.example.workers.dev/api/internal/notices/reminders";
const secret = "synthetic_notices_secret_123456789012";
const dbName = "docentetuc-db", dbId = "baaf5886-0123-4948-96da-aa7106424549";

function isolated() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE import_gateway_identity(id INTEGER PRIMARY KEY,database_name TEXT,database_id TEXT);
    CREATE TABLE publications(id TEXT PRIMARY KEY,kind TEXT,normalized_status TEXT,metadata TEXT);
    CREATE TABLE training_reminders (id TEXT PRIMARY KEY,user_id TEXT,publication_id TEXT,opens_at TEXT,
      advance_minutes INTEGER,remind_at TEXT,notified INTEGER DEFAULT 0,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE designation_tracking (id TEXT PRIMARY KEY,user_id TEXT,publication_id TEXT,reminder_at TEXT,
      reminder_notified INTEGER DEFAULT 0,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE saved_publications (user_id TEXT,publication_id TEXT,agenda_reminder_at TEXT,in_agenda INTEGER,
      agenda_reminder_notified INTEGER DEFAULT 0);
    CREATE TABLE manual_events (id TEXT PRIMARY KEY,user_id TEXT,title TEXT,starts_at TEXT,reminder_at TEXT,
      reminder_notified INTEGER DEFAULT 0,recurrence TEXT DEFAULT 'none',reminder_minutes INTEGER,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE manual_event_push_queue (id INTEGER PRIMARY KEY,user_id TEXT,event_id TEXT,title TEXT,
      occurrence_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(event_id,occurrence_at));
    CREATE TABLE notifications (id INTEGER PRIMARY KEY,user_id TEXT,publication_id TEXT,type TEXT,
      dedupe_key TEXT,scheduled_at TEXT);
    CREATE UNIQUE INDEX idx_notice_dedupe ON notifications(user_id,dedupe_key);`);
  sqlite.prepare("INSERT INTO import_gateway_identity VALUES(1,?,?)").run(dbName, dbId);
  sqlite.prepare("INSERT INTO publications VALUES('p1','capacitacion','UPCOMING',?)").run(JSON.stringify({
    entity: "commission", trainingId: "p1", dateStatus: "confirmed", registrationHasTime: true,
    registrationOpensAt: "2030-01-01T12:00:00Z", registrationClosesAt: "2030-01-02T12:00:00Z" }));
  sqlite.prepare("INSERT INTO training_reminders(id,user_id,publication_id,opens_at,advance_minutes,remind_at) VALUES('t','a','p1','2030-01-01T12:00:00Z',60,'2020-01-01T00:00:00Z')").run();
  sqlite.prepare("INSERT INTO designation_tracking(id,user_id,publication_id,reminder_at) VALUES('d','b','p2','2020-01-01T00:00:00Z')").run();
  sqlite.prepare("INSERT INTO saved_publications(user_id,publication_id,agenda_reminder_at,in_agenda) VALUES('a','p3','2020-01-01T00:00:00Z',1)").run();
  sqlite.prepare("INSERT INTO manual_events(id,user_id,title,starts_at,reminder_at,recurrence) VALUES('m','c','Evento privado','2030-01-01T12:00:00Z','2020-01-01T00:00:00Z','none')").run();
  const statement = (sql, params = []) => ({
    all: async () => ({ results: sqlite.prepare(sql).all(...params) }),
    first: async () => sqlite.prepare(sql).get(...params) ?? null,
    run: async () => { const changes = Number(sqlite.prepare(sql).run(...params).changes);
      return { meta: { changes, rows_written: changes } }; },
    bind: (...bound) => statement(sql, bound),
  });
  const db = { prepare: (sql) => statement(sql) };
  return { sqlite, db, env: { DB: db, NOTICES_IMPORT_SECRET: secret, NOTICES_ENABLED: "true",
    NOTICES_DATABASE_NAME: dbName, NOTICES_DATABASE_ID: dbId } };
}

const request = (body, { token = secret, method = "POST", path = "/api/internal/notices/reminders", json = true } = {}) =>
  new Request(`https://notices.invalid${path}`, { method,
    headers: { ...(json ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(method === "GET" ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });

test("el Worker acepta solo una operación fija, autenticada y acotada", async () => {
  const { sqlite, env } = isolated();
  assert.equal((await worker.fetch(request({ mode: "reminders" }), { ...env, NOTICES_ENABLED: "false" })).status, 503);
  assert.equal((await worker.fetch(request({ mode: "reminders" }, { token: "" }), env)).status, 401);
  assert.equal((await worker.fetch(request({ mode: "reminders" }, { token: "x".repeat(32) }), env)).status, 401);
  assert.equal((await worker.fetch(request({ mode: "reminders" }, { path: "/api/internal/other" }), env)).status, 404);
  assert.equal((await worker.fetch(request({ mode: "reminders" }, { method: "GET" }), env)).status, 405);
  assert.equal((await worker.fetch(request({ mode: "reminders" }, { json: false }), env)).status, 415);
  assert.equal((await worker.fetch(request("{", { json: true }), env)).status, 400);
  assert.equal((await worker.fetch(request({ mode: "sql", sql: "DROP TABLE publications" }), env)).status, 400);
  assert.equal((await worker.fetch(request({ mode: "reminders", limit: 11 }), env)).status, 400);
  assert.equal((await worker.fetch(request({ mode: "reminders", limit: 0 }), env)).status, 400);
  const mismatched = { ...env, NOTICES_DATABASE_ID: "00000000-0000-4000-8000-000000000000" };
  assert.equal((await worker.fetch(request({ mode: "reminders" }), mismatched)).status, 503);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notifications").get()?.n, 0);
  sqlite.close();
});

test("un lote confirmado genera recordatorios internos y la repetición no duplica", async () => {
  const { sqlite, env } = isolated();
  const first = await worker.fetch(request({ mode: "reminders", limit: 10 }), env);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { ok: true, considered: 4, inserted: 4, processed: 4 });
  const types = sqlite.prepare("SELECT type FROM notifications ORDER BY type").all().map((row) => row.type);
  assert.deepEqual(types, ["AGENDA_RECORDATORIO", "CAPACITACION_ABRE", "DESIGNACION_RECORDATORIO"]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM manual_event_push_queue").get()?.n, 1);
  const repeat = await worker.fetch(request({ mode: "reminders", limit: 10 }), env);
  assert.deepEqual(await repeat.json(), { ok: true, considered: 0, inserted: 0, processed: 0 });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notifications").get()?.n, 3);
  sqlite.close();
});

test("los cursores por fila solo avanzan con el aviso confirmado", async () => {
  const { sqlite, env } = isolated();
  let failed = false;
  const interrupted = { ...env, DB: {
    prepare(sql) {
      const statement = env.DB.prepare(sql);
      return {
        ...statement,
        bind(...params) {
          const bound = statement.bind(...params);
          return { ...bound, run: async () => {
            if (!failed && sql.startsWith("UPDATE training_reminders")) { failed = true; throw new Error("D1_INTERRUPTED"); }
            return bound.run();
          } };
        },
      };
    },
  } };
  assert.equal((await worker.fetch(request({ mode: "reminders", limit: 1 }), interrupted)).status, 503);
  assert.equal(sqlite.prepare("SELECT notified FROM training_reminders WHERE id='t'").get()?.notified, 0);
  assert.deepEqual(await (await worker.fetch(request({ mode: "reminders", limit: 10 }), env)).json(),
    { ok: true, considered: 4, inserted: 3, processed: 4 });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notifications").get()?.n, 3);
  sqlite.close();
});

test("el runner valida destino, secreto, límite y ACK", async () => {
  const base = { NOTICES_IMPORT_URL: endpoint, NOTICES_IMPORT_SECRET: secret };
  assert.deepEqual(resolveReminderTarget(base), { endpoint, secret, limit: 2 });
  for (const config of [{ ...base, NOTICES_IMPORT_URL: "http://docentetuc-notices-1-2.example.workers.dev/api/internal/notices/reminders" },
    { ...base, NOTICES_IMPORT_URL: "https://docentetuc-import-1-2.example.workers.dev/api/internal/notices/reminders" },
    { ...base, NOTICES_IMPORT_URL: endpoint.replace("/reminders", "/other") },
    { ...base, NOTICES_IMPORT_URL: endpoint.replace(".dev/", ".dev:8443/") },
    { ...base, NOTICES_IMPORT_SECRET: "corto" }, { ...base, NOTICES_LIMIT: "0" }, { ...base, NOTICES_LIMIT: "3" }])
    assert.throws(() => resolveReminderTarget(config), /NOTICES_(?:URL|SECRET|LIMIT)_INVALID/);
  const target = resolveReminderTarget(base);
  assert.deepEqual(await runReminderStep(target, async () => Response.json({ ok: true, considered: 2, inserted: 2, processed: 2 })),
    { considered: 2, inserted: 2, processed: 2 });
  await assert.rejects(runReminderStep(target, async () => Response.json({ error: "x" }, { status: 503 })), /NOTICES_HTTP_503/);
  await assert.rejects(runReminderStep(target, async () => Response.json({ ok: true, considered: 2 })), /NOTICES_ACK_INVALID/);
  await assert.rejects(runReminderStep(target, async () => { throw new Error("offline"); }), /NOTICES_NETWORK_ERROR/);
});

test("runner limita a dos, no sigue redirecciones ni reintenta una respuesta ambigua", async () => {
  const target = resolveReminderTarget({ NOTICES_IMPORT_URL: endpoint, NOTICES_IMPORT_SECRET: secret });
  for (const ack of [
    { ok: true, considered: 3, inserted: 3, processed: 3 },
    { ok: true, considered: 2, inserted: -1, processed: 2 },
    { ok: true, considered: 2, inserted: 2, processed: 1 },
    { ok: true, considered: 2, inserted: 3, processed: 2 },
  ]) await assert.rejects(runReminderStep(target, async () => Response.json(ack)), /NOTICES_(ACK_INVALID|BATCH_UNCONFIRMED)/);
  for (const response of [() => { throw new Error("ACK_LOST_WITH_SECRET"); },
    () => new Response("{", { status: 200 }),
    () => Response.json({}, { status: 503 })]) {
    let calls = 0;
    await assert.rejects(runReminderStep(target, async (_url, options) => {
      calls++;
      assert.equal(options.redirect, "error");
      assert.deepEqual(JSON.parse(options.body), { mode: "reminders", limit: 2 });
      return response();
    }), /NOTICES_(NETWORK_ERROR|ACK_INVALID|HTTP_503)/);
    assert.equal(calls, 1);
  }
  // Even a harmless lost race requires review; never trigger an automatic retry.
  await assert.rejects(runReminderStep(target, async () => Response.json({ ok: true, considered: 2, inserted: 0, processed: 0 })),
    /NOTICES_BATCH_UNCONFIRMED/);
});

test("apagado y bloqueo tras fallo/ambigüedad antes de contactar al Worker", async () => {
  const config = { NOTICES_AUTOMATION_ENABLED: "true", GITHUB_REPOSITORY: "possee41/docentetuc",
    GITHUB_RUN_ID: "30", GITHUB_RUN_NUMBER: "3", GITHUB_RUN_ATTEMPT: "1", GH_TOKEN: "synthetic_read_only",
    GITHUB_EVENT_NAME: "schedule" };
  const history = (run) => async (_url, options) => {
    assert.equal(options.redirect, "error");
    return Response.json({ workflow_runs: [run] });
  };
  const success = { run_number: 2, status: "completed", conclusion: "success" };
  let calls = 0;
  await assert.rejects(checkReminderAutomation({ ...config, NOTICES_AUTOMATION_ENABLED: "false" }, async () => { calls++; }), /AUTOMATION_DISABLED/);
  assert.equal(calls, 0);
  await checkReminderAutomation(config, history(success));
  for (const conclusion of ["failure", "cancelled", "timed_out", null])
    await assert.rejects(checkReminderAutomation(config, history({ ...success, conclusion })), /PREVIOUS_RUN_REQUIRES_REVIEW/);
  await assert.rejects(checkReminderAutomation(config, history({ ...success, status: "in_progress", conclusion: null })), /PREVIOUS_RUN_ACTIVE/);
  await assert.rejects(checkReminderAutomation(config, async () => Response.json({}, { status: 403 })), /HISTORY_UNAVAILABLE/);
  await assert.rejects(checkReminderAutomation(config, async () => Response.json({})), /HISTORY_INVALID/);
  await assert.rejects(checkReminderAutomation(config, async () => { throw new Error("secret"); }), /HISTORY_UNAVAILABLE/);
  await assert.rejects(checkReminderAutomation({ ...config, GITHUB_RUN_ATTEMPT: "2" }, history(success)), /RETRY_REQUIRES_REVIEW/);
  await assert.rejects(checkReminderAutomation(config, async () => Response.json({ workflow_runs: [] })), /PREVIOUS_RUN_REQUIRES_REVIEW/);
  await checkReminderAutomation({ ...config, GITHUB_EVENT_NAME: "workflow_dispatch", NOTICES_ACKNOWLEDGE_FAILURE: "true" },
    history({ ...success, conclusion: "failure" }));
  // A scheduled execution cannot clear the latch, even with a stale reset variable.
  await assert.rejects(checkReminderAutomation({ ...config, NOTICES_ACKNOWLEDGE_FAILURE: "true" },
    history({ ...success, conclusion: "failure" })), /PREVIOUS_RUN_REQUIRES_REVIEW/);
});

test("lotes de 0, 1, 2 y más de dos; concurrencia y deduplicación con D1 sintética", async () => {
  for (const n of [0, 1, 2, 4]) {
    const { sqlite, env } = isolated();
    sqlite.exec("DELETE FROM training_reminders; DELETE FROM saved_publications; DELETE FROM manual_events; DELETE FROM designation_tracking;");
    for (let i = 0; i < n; i++) sqlite.prepare("INSERT INTO designation_tracking(id,user_id,publication_id,reminder_at) VALUES(?,?,?,'2020-01-01T00:00:00Z')").run(`d${i}`, "synthetic-user", `p${i}`);
    const fetcher = (url, options) => worker.fetch(new Request(url, options), env);
    const target = resolveReminderTarget({ NOTICES_IMPORT_URL: endpoint, NOTICES_IMPORT_SECRET: secret });
    const first = await runReminderStep(target, fetcher);
    assert.deepEqual(first, { considered: Math.min(n, 2), inserted: Math.min(n, 2), processed: Math.min(n, 2) });
    const subsequent = await Promise.allSettled([runReminderStep(target, fetcher), runReminderStep(target, fetcher)]);
    // A lost race can return an unconfirmed ACK; automation must stop, not retry.
    assert.ok(subsequent.every(r => r.status === "fulfilled" || /BATCH_UNCONFIRMED/.test(r.reason.message)));
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notifications").get().n, n);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM designation_tracking WHERE reminder_notified=1").get().n, n);
    assert.deepEqual(await runReminderStep(target, fetcher), { considered: 0, inserted: 0, processed: 0 });
    // Disabled Worker short-circuits before touching D1 (including identity).
    const disabled = { ...env, NOTICES_ENABLED: "false", DB: { prepare() { throw new Error("D1_MUST_NOT_BE_USED"); } } };
    assert.equal((await worker.fetch(request({ mode: "reminders", limit: 2 }), disabled)).status, 503);
    sqlite.close();
  }
});

test("workflow serializado, apagado por defecto, sin schedule ni credenciales Cloudflare", () => {
  const workflow = readFileSync(new URL("../.github/workflows/notices-reminders.yml", import.meta.url), "utf8");
  const active = workflow.replace(/^\s*#.*$/gm, "");
  assert.doesNotMatch(active, /^\s*schedule:/m);
  assert.match(active, /group: notices-reminders\s+cancel-in-progress: false/);
  assert.match(active, /vars.NOTICES_AUTOMATION_ENABLED == 'true'/);
  assert.match(active, /options: \['1', '2'\]/);
  assert.match(active, /NOTICES_LIMIT: \$\{\{ inputs.limit \|\| '2' \}\}/);
  assert.match(active, /actions: read/);
  assert.doesNotMatch(active, /actions: write|CLOUDFLARE|D1_EDIT|retry/i);
  for (const name of ["production", "canary"]) {
    const config = JSON.parse(readFileSync(new URL(`../wrangler.1.2-notices-${name}.jsonc`, import.meta.url), "utf8"));
    assert.equal(config.vars.NOTICES_ENABLED, "false");
    assert.deepEqual(config.triggers.crons, []);
    assert.deepEqual(config.routes, []);
  }
});
