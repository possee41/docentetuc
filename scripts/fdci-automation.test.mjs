import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import gateway from "../workers/source-import-gateway.mjs";
import { fdciLocalFixture } from "./fdci-local-fixture.mjs";
import { runFdciAutomation, fdciOutcome } from "./fdci-automation.mjs";
import { prepareFdciImports } from "../lib/fdci-import.ts";

const sha = "a".repeat(40), secret = "synthetic_automation_secret_1234567890";
const base = { SYNC_SOURCE: "fdci", IMPORT_GATEWAY_ENABLED: "true", FDCI_AUTOMATION_ENABLED: "true",
  IMPORT_GATEWAY_ORIGIN: "http://127.0.0.1:9191", IMPORT_GATEWAY_DATABASE_NAME: "docentetuc-web-canary-1-2-local",
  IMPORT_GATEWAY_DATABASE_ID: "00000000-0000-4000-8000-000000000012", IMPORT_GATEWAY_APPROVED_SHA: sha,
  FDCI_AUTOMATION_SECRET: secret, IMPORT_GATE_RUN_ID: "100-1", FDCI_MAX_PUBLICATIONS: "2",
  FDCI_MAX_REQUESTS: "6", FDCI_PAUSE_MS: "400", FDCI_SCOPE: "active", IMPORT_GATE_TTL_SECONDS: "600" };
const cpu = async ({ calls }) => ({ complete: true, samples: Array.from({ length: calls }, () => ({ cpuTimeMs: 1, outcome: "ok" })) });

function fixture(t) {
  const { sqlite, db } = fdciLocalFixture();t.after(() => sqlite.close());
  sqlite.exec(readFileSync("migrations/0033_fdci_automation_control.sql", "utf8"));
  sqlite.prepare("INSERT INTO import_gateway_identity VALUES(1,?,?)").run(base.IMPORT_GATEWAY_DATABASE_NAME, base.IMPORT_GATEWAY_DATABASE_ID);
  const from = Math.floor(Date.now() / 7_200_000) * 7_200_000;
  sqlite.prepare("UPDATE fdci_automation_control SET status='IDLE',approved_sha=?,not_before=?,not_after=?")
    .run(sha, new Date(from).toISOString(), new Date(from + 86_400_000).toISOString());
  let lock = Promise.resolve(), crossings = 0;
  const measured = {
    prepare(sql) { const s = db.prepare(sql);s.batchRun = s.run;for (const op of ["first", "all", "run"]) { const fn = s[op];s[op] = (...args) => {crossings++;return fn(...args);}; }return s; },
    batch(statements) { crossings++;const job = lock.then(() => db.batch(statements.map(s => ({ run: s.batchRun }))));lock = job.catch(() => {});return job; },
  };
  const env = { DB: measured, IMPORT_DATABASE_NAME: base.IMPORT_GATEWAY_DATABASE_NAME,
    IMPORT_DATABASE_ID: base.IMPORT_GATEWAY_DATABASE_ID, IMPORT_GATE_ALLOWED_SOURCE: "fdci",
    IMPORT_GATE_ENABLED: "false", IMPORT_GATE_LEASE_REQUIRED: "false", FDCI_EXTERNAL_ENABLED: "false",
    FDCI_IMPORT_SECRET: "synthetic_pilot_secret_1234567890123456", FDCI_AUTOMATION_SECRET: secret, FDCI_AUTOMATION_ENABLED: "true" };
  const fetcher = (url, init) => gateway.fetch(new Request(url, init), env);
  const post = (op, body, owner = "100-1", token = secret, revision = sha) => fetcher(base.IMPORT_GATEWAY_ORIGIN + "/api/internal/fdci-automation/" + op, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-import-gate-owner": owner, "x-fdci-automation-sha": revision }, body: JSON.stringify(body),
  });
  const start = (owner = "100-1", ttlSeconds = 600) => post("start", { source: "fdci", action: "open", owner, ttlSeconds }, owner);
  const state = () => sqlite.prepare("SELECT * FROM fdci_automation_control WHERE id=1").get();
  const expire = () => sqlite.exec("UPDATE fdci_automation_control SET lease_until='2000-01-01'; UPDATE import_gate_lease SET expires_at='2000-01-01'");
  const source = async url => {
    if (String(url).endsWith("getRestoCapas")) return Response.json([{ capacitacion_id: 42, nombre: "Curso sintético", token: "ficticio", slug: "ficticio" }]);
    const items = [9001, 9002].map(id => ({ id, capacitacion_id: 42, fecha_apertura_preinscripcion: "2026-10-17 23:00:00", fecha_cierre_preinscripcion: "2099-10-19 08:00:00" }));
    return Response.json(String(url).endsWith("getCapaActivas") ? items : { comisiones: items });
  };
  return { sqlite, db, env, fetcher, post, start, state, expire, source, crossings: () => crossings };
}

test("successful automatic run reuses real importer, two publications, checkpoint and server-owned close", async t => {
  const f = fixture(t);
  const r = await runFdciAutomation(base, sha, f.source, f.fetcher, undefined, cpu);
  assert.equal(r.status, "OK");assert.equal(r.outcome, "CHANGES");assert.equal(r.created, 2);assert.equal(r.closed, true);
  assert.equal(f.state().status, "IDLE");assert.equal(f.state().publication_attempts, 2);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM publications").get().n, 2);
  t.diagnostic(`Job SQLite adapter RPC crossings (not CPU or physical D1 rows): ${f.crossings()}`);
  assert.equal((await f.start("101-1")).status, 409, "same slot cannot be reopened even after clean close");
  assert.ok(r.sourceRequests <= 6);
});

test("empty active catalogue leaves publications/cursor intact and reports NO_ACTIVE_DATA", async t => {
  const f = fixture(t), before = f.sqlite.prepare("SELECT * FROM fdci_import_checkpoint").get();
  const r = await runFdciAutomation(base, sha, async () => Response.json([]), f.fetcher, undefined, cpu);
  assert.equal(r.status, "OK");assert.equal(r.outcome, "NO_ACTIVE_DATA");assert.equal(r.sourceRequests, 2);
  assert.deepEqual(f.sqlite.prepare("SELECT * FROM fdci_import_checkpoint").get(), before);
  assert.equal(f.state().publication_attempts, 0);assert.equal(f.state().status, "IDLE");
  t.diagnostic(`Empty-run SQLite adapter RPC crossings, includes lease controls: ${f.crossings()}`);
});

test("three pending commissions stay bounded at two and resume in the next authorized slot", async t => {
  const f = fixture(t);
  const source = async url => {
    const data = await (await f.source(url)).json();
    const items = Array.isArray(data) ? data : data.comisiones;
    if (items[0]?.id) items.push({ ...items[0], id: 9003 });
    return Response.json(data);
  };
  const first = await runFdciAutomation(base, sha, source, f.fetcher, undefined, cpu);
  assert.equal(first.outcome, "PARTIAL_PROGRESS");assert.equal(first.examined, 2);assert.equal(first.created, 2);
  assert.equal(f.state().status, "IDLE");
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 7_200_000 });t.after(() => t.mock.timers.reset());
  const next = await runFdciAutomation({ ...base, IMPORT_GATE_RUN_ID: "101-1" }, sha, source, f.fetcher, undefined, cpu);
  assert.equal(next.examined, 1);assert.equal(next.created, 1);assert.equal(next.cycleComplete, true);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM publications").get().n, 3);
});

test("concurrent starts have one winner; wrong owner, secret, SHA, source and oversized TTL cannot widen access", async t => {
  const f = fixture(t);
  assert.equal((await f.start("100-1", 601)).status, 400);
  assert.equal((await f.post("start", { source: "sime", action: "open", owner: "100-1", ttlSeconds: 600 })).status, 400);
  assert.equal((await f.post("start", {}, "100-1", "wrong_secret_12345678901234567890123456")).status, 401);
  assert.equal((await f.post("start", {}, "100-1", secret, "b".repeat(40))).status, 503);
  const results = await Promise.all([f.start(), f.start("101-1")]);assert.deepEqual(results.map(x => x.status).sort(), [200, 409]);
  const winner = f.state().owner, loser = winner === "100-1" ? "101-1" : "100-1";
  assert.equal((await f.post("checkpoint", { op: "get" }, loser)).status, 409);
  assert.equal((await f.post("close", { source: "fdci", action: "open", owner: winner, ttlSeconds: 600 }, winner)).status, 400);
  assert.equal((await f.post("close", { source: "fdci", action: "close", owner: loser }, loser)).status, 409);
  const until = f.state().lease_until;assert.equal((await f.start(winner)).status, 200);assert.equal(f.state().lease_until, until);
  const legacy = await f.fetcher(base.IMPORT_GATEWAY_ORIGIN + "/api/internal/sime-import", { method: "POST", headers: { authorization: `Bearer ${secret}` } });assert.equal(legacy.status, 503);
  f.env.IMPORT_GATE_LEASE_REQUIRED = "true";
  assert.equal((await f.fetcher(base.IMPORT_GATEWAY_ORIGIN + "/api/internal/fdci-import", {
    method: "POST", headers: { authorization: `Bearer ${secret}` },
  })).status, 401, "automatic credential cannot bypass quota through the manual route");
});

test("expired/abandoned execution latches halt; automatic credential cannot recover; authorized local recovery retains slot", async t => {
  const f = fixture(t);await f.start();f.expire();
  assert.equal((await f.post("checkpoint", { op: "get" })).status, 503);assert.equal(f.state().status, "HALTED");
  assert.equal((await f.start("101-1")).status, 503);assert.equal((await f.post("resume", {})).status, 404);
  const slot = f.state().last_slot;
  // Simulate separate operator authorization in this ephemeral DB, never a public API.
  f.sqlite.exec("UPDATE fdci_automation_control SET status='IDLE',halt_reason=NULL WHERE id=1 AND status='HALTED'");
  assert.equal(f.state().last_slot, slot);assert.equal((await f.start("101-1")).status, 409);
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 7_200_000 });t.after(() => t.mock.timers.reset());
  assert.equal((await f.start("101-1")).status, 200, "authorized recovery permits only a later slot");
});

test("1102/ambiguous mutation and subsequent runs suspend without retrying a publication", async t => {
  const f = fixture(t);let mutations = 0;
  const broken = async (url, init) => {
    if (String(url).endsWith("/import")) { mutations++;return new Response("Worker exceeded resource limits (1102)", { status: 500 }); }
    return f.fetcher(url, init);
  };
  const r = await runFdciAutomation(base, sha, f.source, broken, undefined, cpu);
  assert.equal(r.status, "ERROR");assert.equal(mutations, 1);assert.equal(f.state().status, "HALTED");
  assert.equal((await f.start("101-1")).status, 503);
});

test("D1 failure cannot silently resume after recovery, and an invalid token cannot halt another owner", async t => {
  const f = fixture(t);await f.start();
  assert.equal((await f.post("finish", { success: false }, "100-1", "wrong_secret_12345678901234567890123456")).status, 401);
  assert.equal(f.state().status, "RUNNING");
  const db = f.env.DB;f.env.DB = { prepare() {throw new Error("synthetic outage");} };
  assert.equal((await f.post("checkpoint", { op: "get" })).status, 503);
  f.env.DB = db;f.expire();assert.equal((await f.start("101-1")).status, 503);assert.equal(f.state().status, "HALTED");
});

test("GitHub cancellation and incomplete/over-budget CPU evidence halt future grants", async t => {
  for (const mode of ["cancel", "missing-cpu", "cpu-limit"]) {
    const f = fixture(t), controller = new AbortController();
    const source = async url => { if (mode === "cancel") {controller.abort();throw new Error("cancelled");}return f.source(url); };
    const measure = mode === "missing-cpu" ? undefined : mode === "cpu-limit"
      ? async ({ calls }) => ({ complete: true, samples: Array.from({ length: calls }, () => ({ cpuTimeMs: 8, outcome: "ok" })) }) : cpu;
    const r = await runFdciAutomation(base, sha, source, f.fetcher, controller.signal, measure);
    assert.equal(r.status, "ERROR", mode);assert.equal(r.outcome, "FAILED", mode);assert.equal(f.state().status, "HALTED", mode);
    assert.equal((await f.start("101-1")).status, 503);
  }
});

test("absolute window and disabled flag are enforced before a grant", async t => {
  const f = fixture(t);f.env.FDCI_AUTOMATION_ENABLED = "false";const before = f.crossings();
  assert.equal((await f.start()).status, 503);assert.equal(f.crossings(), before);
  f.env.FDCI_AUTOMATION_ENABLED = "true";
  f.sqlite.exec("UPDATE fdci_automation_control SET not_after='2000-01-01'");assert.equal((await f.start()).status, 503);
  assert.equal(f.state().status, "IDLE");
});

test("compromised automatic credential cannot exceed two imports, renew the lease or escape its finite window", async t => {
  const f = fixture(t);await f.start();
  const [item] = await prepareFdciImports([{ capacitacion_id: 42, nombre: "Ficticio", token: "ficticio", slug: "ficticio" }],
    [{ id: 9001, capacitacion_id: 42, fecha_apertura_preinscripcion: "2026-10-17 23:00:00", fecha_cierre_preinscripcion: "2099-10-19 08:00:00" }]);
  const body = { mode: "batch", items: [item] };
  assert.equal((await f.post("import", body)).status, 200);
  const repeated = await f.post("import", body);assert.equal(repeated.status, 200);assert.equal((await repeated.json()).rowsWritten, 0);
  assert.equal((await f.post("import", body)).status, 409);assert.equal(f.state().status, "HALTED");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM publications").get().n, 1);
  assert.equal((await f.start("102-1")).status, 503);
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(f.state().not_after) + 1 });t.after(() => t.mock.timers.reset());
  assert.equal((await f.start("103-1")).status, 503, "credential cannot extend the absolute authorization window");
});

test("lost final report is not retried; missing CPU pauses and repeated cron attempts cannot restart", async t => {
  const f = fixture(t);let reports = 0;
  const lost = async (url, init) => {
    const response = await f.fetcher(url, init);
    if (String(url).endsWith("/finish")) { reports++;throw new Error("synthetic lost ACK"); }
    return response;
  };
  const r = await runFdciAutomation(base, sha, async () => Response.json([]), lost);
  assert.equal(reports, 1);assert.equal(r.status, "ERROR");assert.equal(f.state().status, "HALTED");
  for (const owner of ["101-1", "102-1"]) assert.equal((await f.start(owner)).status, 503);
});

test("FDCI legacy TTL above 600 is rejected without changing other source limits", async t => {
  const f = fixture(t);f.env.IMPORT_GATE_LEASE_REQUIRED = "true";
  const response = await f.fetcher(base.IMPORT_GATEWAY_ORIGIN + "/api/internal/import-gate", {
    method: "POST", headers: { authorization: `Bearer ${f.env.FDCI_IMPORT_SECRET}`, "content-type": "application/json" },
    body: JSON.stringify({ source: "fdci", action: "open", owner: "pilot-local", ttlSeconds: 601 }),
  });
  assert.equal(response.status, 400);assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM import_gate_lease").get().n, 0);
});

test("result labels preserve partial progress and do not mistake missing/failed ACK for empty data", () => {
  assert.equal(fdciOutcome({status: "OK", closed: true, created: 0, updated: 0, examined: 2}), "NO_CHANGES");
  assert.equal(fdciOutcome({status: "PARTIAL", closed: true, progressPending: true, failed: false}), "PARTIAL_PROGRESS");
  assert.equal(fdciOutcome({status: "ERROR", empty: true, examined: 0, closed: true}), "FAILED");
});
