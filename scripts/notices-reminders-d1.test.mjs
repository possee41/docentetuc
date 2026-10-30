import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { privateNotifications, readPrivateNotification } from "../lib/private-notifications.ts";

const require = createRequire(import.meta.url);
const { Miniflare } = require("../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare");
const { build } = require("../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild");
const migrations = [
  "drizzle/0000_docentetuc.sql", "drizzle/0001_training_metadata.sql",
  "drizzle/0002_reminders_ai.sql", "drizzle/0003_web_push.sql",
  "migrations/0002_designations.sql", "migrations/0003_information_agenda.sql",
  "migrations/0004_agenda_reminders.sql", "migrations/0006_manual_events.sql",
  "migrations/0007_manual_event_recurrence.sql", "migrations/0008_personal_matching_circuits.sql",
  "migrations/0009_reliability_lifecycle.sql", "migrations/0029_import_gateway_identity.sql", "migrations/0030_manual_internal_notices.sql",
];

test("avisos manuales privados: elegibilidad, dueño, ACK, dedupe y rollback D1 real", async () => {
  const source = `import worker from './workers/notices-receiver.mjs';
    export default {async fetch(request,env){
      const metrics={rpc:0,queries:0,rowsRead:0,rowsWritten:0};
      const record=r=>{metrics.rowsRead+=r.meta.rows_read;metrics.rowsWritten+=r.meta.rows_written;return r;};
      const wrap=stmt=>({raw:stmt,bind(...args){return wrap(stmt.bind(...args));},
        async all(){metrics.rpc++;metrics.queries++;return record(await stmt.all());},
        async first(){return (await this.all()).results[0]||null;}});
      const db={prepare:sql=>wrap(env.DB.prepare(sql)),async batch(statements){
        metrics.rpc++;metrics.queries+=statements.length;
        const raw=statements.map(s=>s.raw);
        if(request.headers.get('x-test-write-failure'))raw[Number(request.headers.get('x-test-write-failure'))-1]=env.DB.prepare('UPDATE missing_manual_test_table SET flag=1');
        return (await env.DB.batch(raw)).map(record);
      }};
      const response=await worker.fetch(request,{...env,DB:db});
      return Response.json({http:response.status,ack:await response.json(),metrics});
    }};`;
  const bundle = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: "ts" }, bundle: true,
    write: false, format: "esm", platform: "browser", target: "es2022" });
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, d1Databases: ["DB"],
    bindings: { NOTICES_ENABLED: "true", NOTICES_IMPORT_SECRET: "synthetic_local_manual_notice_1234567890",
      NOTICES_DATABASE_NAME: "local-manual-notices", NOTICES_DATABASE_ID: "11111111-1111-4111-8111-111111111111" },
    outboundService: () => { throw Error("REMOTE_REQUEST_FORBIDDEN"); },
  });
  try {
    const db = await mf.getD1Database("DB");
    for (const file of migrations) {
      if (file.endsWith("0030_manual_internal_notices.sql")) {
        await db.prepare("INSERT INTO manual_events(id,user_id,title,starts_at,reminder_at,reminder_notified) VALUES('completed','owner-a','Histórico','2030-01-01T12:00:00Z','2000-01-01T00:00:00Z',1)").run();
        await db.prepare("INSERT INTO manual_event_push_queue(user_id,event_id,title,occurrence_at) VALUES('owner-a','completed','Histórico sin backfill','2030-01-01T12:00:00Z')").run();
      }
      for (const sql of readFileSync(new URL(`../${file}`, import.meta.url), "utf8")
        .replace(/^--.*$/gm, "").split(";").map(s => s.trim()).filter(Boolean)) await db.prepare(sql).run();
    }
    await db.prepare("INSERT INTO import_gateway_identity(id,database_name,database_id) VALUES(1,'local-manual-notices','11111111-1111-4111-8111-111111111111')").run();
    const add = async (id, owner, at, notified = 0) => db.prepare(`INSERT INTO manual_events(id,user_id,title,starts_at,reminder_at,reminder_notified)
      VALUES(?,?,?,'2030-01-01T12:00:00Z',?,?)`).bind(id, owner, `Evento privado sintético ${id}`, at, notified).run();
    const invoke = async failure => {
      const started = performance.now();
      const r = await mf.dispatchFetch("http://local/api/internal/notices/reminders", { method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer synthetic_local_manual_notice_1234567890", ...(failure ? { "x-test-write-failure": String(failure) } : {}) },
        body: JSON.stringify({ mode: "reminders", limit: 2 }) });
      return { ...await r.json(), elapsedMs: performance.now() - started };
    };
    await add("future", "owner-a", "2099-01-01T00:00:00Z");
    await add("none", "owner-a", null);
    assert.deepEqual((await invoke()).ack, { ok: true, considered: 0, inserted: 0, processed: 0 });
    assert.equal((await privateNotifications(db, "owner-a")).results.length, 0);
    await add("due-a", "owner-a", "2000-01-01T00:00:00Z");
    for (const failure of [1, 2]) {
      assert.equal((await invoke(failure)).http, 503);
      assert.equal((await db.prepare("SELECT reminder_notified AS n FROM manual_events WHERE id='due-a'").first()).n, 0);
      assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM manual_event_push_queue WHERE event_id='due-a'").first()).n, 0);
    }
    const first = await invoke();
    assert.deepEqual(first.ack, { ok: true, considered: 1, inserted: 1, processed: 1 });
    let owned = (await privateNotifications(db, "owner-a")).results;
    assert.equal(owned.length, 1); assert.equal(owned[0].manual_event_id, "due-a"); assert.ok(owned[0].id < 0);
    assert.equal((await privateNotifications(db, "owner-b")).results.length, 0);
    await readPrivateNotification(db, "owner-b", owned[0].id);
    assert.equal((await privateNotifications(db, "owner-a")).results[0].read, 0);
    if (process.env.MANUAL_NOTICE_UI === "1") await checkManualNoticeUI(db, "owner-a");
    await readPrivateNotification(db, "owner-a", owned[0].id);
    assert.equal((await privateNotifications(db, "owner-a")).results[0].read, 1);
    assert.deepEqual((await invoke()).ack, { ok: true, considered: 0, inserted: 0, processed: 0 });
    // Replay a confirmed notice with its flag interrupted: only the flag advances.
    await db.prepare("UPDATE manual_events SET reminder_notified=0 WHERE id='due-a'").run();
    assert.deepEqual((await invoke()).ack, { ok: true, considered: 1, inserted: 0, processed: 1 });
    await add("due-b", "owner-b", "2000-01-01T00:00:00Z"); await add("due-c", "owner-a", "2000-01-01T00:00:00Z"); await add("due-d", "owner-a", "2000-01-01T00:00:00Z");
    const two = await invoke(); assert.deepEqual(two.ack, { ok: true, considered: 2, inserted: 2, processed: 2 });
    assert.equal(two.metrics.rpc, 6); assert.equal(two.metrics.queries, 9);
    assert.equal((await db.prepare("SELECT reminder_notified AS n FROM manual_events WHERE id='due-d'").first()).n, 0);
    assert.equal((await privateNotifications(db, "owner-a")).results.length, 2);
    assert.equal((await privateNotifications(db, "owner-b")).results.length, 1);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM publications").first()).n, 0, "no private data in public catalog");
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM notifications").first()).n, 0, "manual notices reuse queue storage");
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM manual_event_push_queue WHERE internal_notice=1").first()).n, 3);
    // An interrupted legacy queue row is promoted only while its event is still pending.
    await db.prepare("UPDATE manual_events SET reminder_notified=1 WHERE id='due-d'").run();
    await db.prepare("UPDATE manual_events SET reminder_notified=0 WHERE id='completed'").run();
    assert.deepEqual((await invoke()).ack, { ok: true, considered: 1, inserted: 1, processed: 1 });
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM manual_event_push_queue WHERE event_id='completed'").first()).n, 1);
    const manual = (await privateNotifications(db, "owner-a")).results.find(n => n.manual_event_id === "completed");
    await db.prepare("INSERT INTO publications(id,source,external_id,kind,category,title,status,official_url,content_hash) VALUES('public-test','synthetic','public-test','informacion','Prueba','Publicación sintética','sin verificar','','test-hash')").run();
    await db.prepare("INSERT INTO notifications(id,user_id,publication_id,type,dedupe_key) VALUES(?,'owner-a','public-test','AGENDA_RECORDATORIO','public-test')").bind(-manual.id).run();
    await readPrivateNotification(db, "owner-a", manual.id);
    assert.equal((await db.prepare("SELECT read FROM notifications WHERE id=?").bind(-manual.id).first()).read, 0, "negative IDs must not mark the native notification with the same absolute ID");
    await readPrivateNotification(db, "owner-b", -manual.id);
    assert.equal((await db.prepare("SELECT read FROM notifications WHERE id=?").bind(-manual.id).first()).read, 0);
    await readPrivateNotification(db, "owner-a", -manual.id);
    assert.equal((await db.prepare("SELECT read FROM notifications WHERE id=?").bind(-manual.id).first()).read, 1);
    assert.ok((await privateNotifications(db, "owner-a")).results.some(n => n.publication_id === "public-test"));
    console.log(JSON.stringify({ localD1: true, one: first, two, cpuTimeMs: null, note: "elapsedMs is wall time, not CPU; one row backs notice and push queue" }));
  } finally { await mf.dispose(); }
});

async function checkManualNoticeUI(db, owner) {
  let playwright;
  try { playwright = require("playwright"); }
  catch { playwright = require(join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright")); }
  const browser = await playwright.chromium.launch({ channel: "msedge", headless: true, args: ["--disable-background-networking"] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    await context.addInitScript(() => localStorage.setItem("docentetuc-device-id", "11111111-1111-4111-8111-111111111111"));
    const blank = { profile: null, publications: [], personalPublications: [], saved: [], notifications: [], reminders: [], designations: [], manualEvents: [], sync: [] };
    await context.route("**/*", async route => {
      const r = route.request(), u = new URL(r.url());
      if (u.origin !== "http://localhost:5173") return route.abort();
      if (!u.pathname.startsWith("/api/")) return route.continue();
      let body;
      if (u.pathname === "/api/installations/credential") body = { status: "ready", deviceId: "11111111-1111-4111-8111-111111111111" };
      else if (u.pathname === "/api/app" && r.method() === "POST") {
        const payload = r.postDataJSON(); assert.equal(payload.action, "read_notification");
        await readPrivateNotification(db, owner, payload.id); body = { ok: true };
      } else {
        assert.equal(r.method(), "GET");
        if (u.pathname === "/api/app") body = { ...blank, notifications: (await privateNotifications(db, owner)).results,
          manualEvents: (await db.prepare("SELECT * FROM manual_events WHERE user_id=?").bind(owner).all()).results };
        else if (u.pathname === "/api/public-app") body = blank;
        else if (u.pathname === "/api/auth/status") body = { authenticated: true, image: null };
        else if (u.pathname === "/api/auth/link") body = { linked: false };
        else if (u.pathname === "/api/push") body = { supported: false, subscribed: false };
        else if (["/api/news", "/api/notices"].includes(u.pathname)) body = { items: [] };
        else if (u.pathname === "/api/ai") body = { configured: false };
        else throw Error("UNEXPECTED_LOCAL_API");
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto("http://localhost:5173/?section=alertas");
    const card = page.getByRole("button").filter({ hasText: "Evento privado sintético due-a" });
    await card.waitFor(); assert.equal(await card.count(), 1);
    await card.scrollIntoViewIfNeeded(); await page.screenshot({ path: ".wrangler/manual-notice-alerts.png" });
    const readResponse = page.waitForResponse(r => r.url().endsWith("/api/app") && r.request().method() === "POST");
    await card.click(); await readResponse;
    await page.getByRole("heading", { name: "Detalle del evento", exact: true }).waitFor();
    assert.equal((await privateNotifications(db, owner)).results[0].read, 1);
    await page.waitForTimeout(300); // Capture the settled existing dialog, not its enter transition.
    await page.screenshot({ path: ".wrangler/manual-notice-detail.png" }); assert.deepEqual(errors, []);
    console.log(JSON.stringify({ localUI: true, notificationVisibleWithoutProfile: true, opensExistingDetail: true, ownerReadConfirmed: true, remoteAccess: false }));
  } finally { await browser.close(); }
}

test("ACK cuenta registros, no escrituras de índices, con D1 real efímera", async () => {
  const source = `
    import worker from "./workers/notices-receiver.mjs";
    export default { async fetch(request, env) {
      const trace = [];
      let batchCalls = 0;
      const record = (r, sql) => { trace.push({
        operation: sql.trim().split(/\\s+/).slice(0, 3).join(" "),
        changes: r.meta.changes, rowsWritten: r.meta.rows_written,
      }); return r; };
      const db = { prepare(sql) {
        const wrap = stmt => ({ raw: stmt, sql, bind(...args) { return wrap(stmt.bind(...args)); },
          async all() { const r = await stmt.all(); return r; },
          async first() { return stmt.first(); },
          async run() { return record(await stmt.run(), sql); }
        });
        return wrap(env.DB.prepare(sql));
      }, async batch(statements) {
        batchCalls++;
        const raw = statements.map(s => s.raw);
        if (request.headers.get("x-test-batch-failure")) raw[1] = env.DB.prepare("UPDATE missing_notices_table SET flag=1");
        return (await env.DB.batch(raw)).map((r, i) => record(r, statements[i].sql));
      } };
      const response = await worker.fetch(request, { ...env, DB: db });
      return Response.json({ http: response.status, ack: await response.json(), trace, batchCalls });
    } };`;
  const bundle = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: "ts" },
    bundle: true, write: false, format: "esm", platform: "browser", target: "es2022" });
  const databaseId = "11111111-1111-4111-8111-111111111111";
  const secret = "synthetic_local_notices_secret_1234567890";
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text,
    d1Databases: ["DB"], bindings: { NOTICES_ENABLED: "true", NOTICES_IMPORT_SECRET: secret,
      NOTICES_DATABASE_NAME: "docentetuc-notices-canary-1-2", NOTICES_DATABASE_ID: databaseId },
    // This test must never call external services, including Cloudflare APIs.
    outboundService: () => { throw new Error("REMOTE_REQUEST_FORBIDDEN"); },
  });
  try {
    const db = await mf.getD1Database("DB");
    const seed = readFileSync(new URL("./notices-canary-seed.sql", import.meta.url), "utf8")
      .replaceAll("bee24175-2591-4fe3-a4ed-deb7f680f615", databaseId);
    for (const text of [...migrations.map(file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8")), seed]) {
      for (const sql of text.replace(/^--.*$/gm, "").split(";").map(part => part.trim()).filter(Boolean))
        await db.prepare(sql).run();
    }
    const invoke = async (headers = {}, limit = 10) => (await mf.dispatchFetch("http://local/api/internal/notices/reminders", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}`, ...headers },
      body: JSON.stringify({ mode: "reminders", limit }),
    })).json();
    // Native D1 must roll back the whole write batch if any statement fails.
    assert.equal((await invoke({ "x-test-batch-failure": "1" })).http, 503);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM notifications").first()).n, 0);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM manual_event_push_queue").first()).n, 0);
    assert.equal((await db.prepare("SELECT notified FROM training_reminders").first()).notified, 0);
    const first = await invoke();
    const logical = first.trace.reduce((n, row) => n + row.changes, 0);
    const physical = first.trace.reduce((n, row) => n + row.rowsWritten, 0);
    console.log(JSON.stringify({ localD1: true, ack: first.ack, trace: first.trace, logical, physical }));
    assert.equal(first.http, 200);
    assert.equal(first.batchCalls, 1);
    assert.deepEqual(first.trace.map(row => row.changes), Array(8).fill(1));
    assert.deepEqual(first.trace.map(row => row.rowsWritten), [5, 2, 5, 2, 5, 1, 4, 2]);
    assert.deepEqual(first.ack, { ok: true, considered: 4, inserted: 4, processed: 4 });
    assert.equal((await db.prepare("SELECT count(*) AS n FROM notifications").first()).n, 3);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM manual_event_push_queue").first()).n, 1);

    const reset = async () => {
      for (const sql of ["DELETE FROM notifications", "DELETE FROM manual_event_push_queue",
        "UPDATE training_reminders SET notified=0", "UPDATE designation_tracking SET reminder_notified=0",
        "UPDATE saved_publications SET agenda_reminder_notified=0", "UPDATE manual_events SET reminder_notified=0"])
        await db.prepare(sql).run();
    };
    await reset();
    const concurrent = await Promise.all([invoke(), invoke()]);
    assert.ok(concurrent.every(r => r.http === 200));
    assert.equal(concurrent.reduce((n,r)=>n+r.ack.inserted,0), 4);
    assert.equal(concurrent.reduce((n,r)=>n+r.ack.processed,0), 4);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM notifications").first()).n, 3);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM manual_event_push_queue").first()).n, 1);

    await reset();
    for (let i = 0; i < 7; i++) await db.prepare(`INSERT INTO training_reminders
      (id,user_id,training_id,publication_id,opens_at,precision,advance_minutes,remind_at)
      SELECT ?,user_id,training_id,publication_id,opens_at,precision,advance_minutes,remind_at
      FROM training_reminders WHERE id='canary-t1'`).bind(`extra-${i}`).run();
    const bounded = await invoke({}, 10);
    assert.deepEqual(bounded.ack, { ok: true, considered: 10, inserted: 10, processed: 10 });
    assert.equal(bounded.trace.length, 20);
    assert.equal(bounded.batchCalls, 1);
    assert.equal((await db.prepare("SELECT reminder_notified FROM manual_events").first()).reminder_notified, 0);
    assert.deepEqual((await invoke()).ack, { ok: true, considered: 1, inserted: 1, processed: 1 });
    for (const [table, flag] of [["training_reminders", "notified"], ["designation_tracking", "reminder_notified"],
      ["saved_publications", "agenda_reminder_notified"], ["manual_events", "reminder_notified"]])
      assert.equal((await db.prepare(`SELECT ${flag} AS flag FROM ${table}`).first()).flag, 1);
    assert.deepEqual((await invoke()).ack, { ok: true, considered: 0, inserted: 0, processed: 0 });
    // Reproduce an interrupted row confirmation without removing its notice.
    await db.prepare("UPDATE training_reminders SET notified=0 WHERE id='canary-t1'").run();
    const resumed = await invoke();
    assert.deepEqual(resumed.ack, { ok: true, considered: 1, inserted: 0, processed: 1 });
    assert.equal(resumed.trace[0].changes, 0);
    assert.ok(resumed.trace[0].rowsWritten > 0, "INSERT OR IGNORE puede escribir sin insertar un aviso");
    assert.equal((await db.prepare("SELECT count(*) AS n FROM notifications").first()).n, 10);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM manual_event_push_queue").first()).n, 1);
  } finally { await mf.dispose(); }
});

test("automatización: lotes de dos y concurrencia en Workerd/D1 local, sin red", async () => {
  const bundle = await build({ entryPoints: ["workers/notices-receiver.mjs"], bundle: true,
    write: false, format: "esm", platform: "browser", target: "es2022" });
  const databaseId = "11111111-1111-4111-8111-111111111111";
  const secret = "synthetic_local_notices_secret_1234567890";
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, d1Databases: ["DB"],
    bindings: { NOTICES_ENABLED: "true", NOTICES_IMPORT_SECRET: secret,
      NOTICES_DATABASE_NAME: "docentetuc-notices-canary-1-2", NOTICES_DATABASE_ID: databaseId },
    outboundService: () => { throw new Error("REMOTE_REQUEST_FORBIDDEN"); },
  });
  try {
    const db = await mf.getD1Database("DB");
    const seed = readFileSync(new URL("./notices-canary-seed.sql", import.meta.url), "utf8")
      .replaceAll("bee24175-2591-4fe3-a4ed-deb7f680f615", databaseId);
    for (const text of [...migrations.map(file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8")), seed])
      for (const sql of text.replace(/^--.*$/gm, "").split(";").map(s => s.trim()).filter(Boolean)) await db.prepare(sql).run();
    const invoke = async () => {
      const response = await mf.dispatchFetch("http://local/api/internal/notices/reminders", { method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
        body: JSON.stringify({ mode: "reminders", limit: 2 }),
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    const concurrent = await Promise.all([invoke(), invoke()]);
    assert.ok(concurrent.every(r => r.considered <= 2));
    const inserted = concurrent.reduce((n, r) => n + r.inserted, 0);
    assert.ok(inserted >= 2 && inserted <= 4);
    assert.equal(concurrent.reduce((n, r) => n + r.processed, 0), inserted);
    // D1 can serialize the calls so they select different pending rows.
    const remaining = 4 - inserted;
    assert.deepEqual(await invoke(), { ok: true, considered: remaining, inserted: remaining, processed: remaining });
    assert.deepEqual(await invoke(), { ok: true, considered: 0, inserted: 0, processed: 0 });
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM notifications").first()).n, 3);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM manual_event_push_queue").first()).n, 1);
    // One pending reminder whose notice already exists: recover flag, no duplicate.
    await db.prepare("UPDATE designation_tracking SET reminder_notified=0").run();
    assert.deepEqual(await invoke(), { ok: true, considered: 1, inserted: 0, processed: 1 });
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM notifications").first()).n, 3);
  } finally { await mf.dispose(); }
});
