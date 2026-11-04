// No network: real gateway/router and runner preflight, ephemeral SQLite only.
import assert from "node:assert/strict";
import test from "node:test";
import gateway from "../workers/source-import-gateway.mjs";
import { callGate, preflightFdciJob } from "./import-gate.mjs";
import { fdciLocalFixture } from "./fdci-local-fixture.mjs";

const config = {
  SYNC_SOURCE: "fdci", IMPORT_GATEWAY_ENABLED: "true",
  IMPORT_GATEWAY_ORIGIN: "http://127.0.0.1:9191",
  IMPORT_GATEWAY_DATABASE_NAME: "docentetuc-web-canary-1-2-local",
  IMPORT_GATEWAY_DATABASE_ID: "00000000-0000-4000-8000-000000000012",
  FDCI_IMPORT_SECRET: "synthetic_approval_secret_1234567890",
  IMPORT_GATE_RUN_ID: "approval-local", IMPORT_GATE_TTL_SECONDS: "600",
  FDCI_SCOPE: "active", FDCI_MAX_PUBLICATIONS: "2",
  FDCI_MAX_REQUESTS: "6", FDCI_PAUSE_MS: "400",
};

function fixture(t) {
  const { sqlite, db } = fdciLocalFixture();
  t.after(() => sqlite.close());
  sqlite.prepare("INSERT INTO import_gateway_identity(id,database_name,database_id) VALUES(1,?,?)")
    .run(config.IMPORT_GATEWAY_DATABASE_NAME, config.IMPORT_GATEWAY_DATABASE_ID);
  let queries = 0;
  const env = {
    DB: { prepare(sql) { queries++; return db.prepare(sql); }, batch: db.batch },
    IMPORT_DATABASE_NAME: config.IMPORT_GATEWAY_DATABASE_NAME,
    IMPORT_DATABASE_ID: config.IMPORT_GATEWAY_DATABASE_ID,
    FDCI_IMPORT_SECRET: config.FDCI_IMPORT_SECRET,
    IMPORT_GATE_ALLOWED_SOURCE: "fdci",
  };
  const close = () => Object.assign(env, {
    IMPORT_GATE_ENABLED: "false", IMPORT_GATE_LEASE_REQUIRED: "false", FDCI_EXTERNAL_ENABLED: "false",
  });
  const arm = () => Object.assign(env, {
    IMPORT_GATE_ENABLED: "false", IMPORT_GATE_LEASE_REQUIRED: "true", FDCI_EXTERNAL_ENABLED: "true",
  });
  close();
  const fetcher = (url, init) => gateway.fetch(new Request(url, init), env);
  const request = (path, { authorized = true, owner = config.IMPORT_GATE_RUN_ID, body = {} } = {}) =>
    fetcher(config.IMPORT_GATEWAY_ORIGIN + path, {
      method: "POST", headers: { "content-type": "application/json", "x-import-gate-owner": owner,
        ...(authorized ? { authorization: `Bearer ${config.FDCI_IMPORT_SECRET}` } : {}) },
      body: JSON.stringify(body),
    });
  return { sqlite, env, close, arm, fetcher, request, queries: () => queries,
    lease: () => sqlite.prepare("SELECT * FROM import_gate_lease WHERE id=1").get() };
}

async function assertClosed(f) {
  const before = f.queries();
  for (const path of ["/api/internal/import-gate", "/api/internal/fdci-import", "/api/internal/fdci-checkpoint"])
    assert.equal((await f.request(path, { body: { source: "fdci", action: "open", owner: config.IMPORT_GATE_RUN_ID } })).status, 503);
  await assert.rejects(preflightFdciJob(config, "", f.fetcher), /GATEWAY_IDENTITY_HTTP_503/);
  assert.equal(f.queries(), before, "full shutdown rejects before accessing D1");
}

test("early approval reproduces the exact closed-gateway preflight failure without D1 access", async t => {
  const f = fixture(t);
  await assertClosed(f);
  assert.equal(f.lease(), undefined);
});

test("armed preflight reads identity without opening a lease; unauthorized writes remain blocked", async t => {
  const f = fixture(t);
  f.arm();
  const changes = f.sqlite.prepare("SELECT total_changes() AS n").get().n;
  await preflightFdciJob(config, "", f.fetcher);
  assert.equal(f.sqlite.prepare("SELECT total_changes() AS n").get().n, changes);
  assert.equal(f.lease(), undefined);
  assert.equal((await f.fetcher(config.IMPORT_GATEWAY_ORIGIN + "/api/internal/import-identity?source=fdci")).status, 401);
  for (const path of ["/api/internal/fdci-import", "/api/internal/fdci-checkpoint"]) {
    assert.equal((await f.request(path, { authorized: false })).status, 401);
    assert.equal((await f.request(path)).status, 503);
  }
  assert.equal((await f.request("/api/internal/import-gate", { authorized: false,
    body: { source: "fdci", action: "open", owner: config.IMPORT_GATE_RUN_ID } })).status, 401);
  assert.equal((await f.request("/api/internal/sime-import")).status, 503);
  f.close();
  await assertClosed(f);
});

test("after approval, owner opens once, foreign owners are rejected and normal cleanup closes", async t => {
  const f = fixture(t);
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  t.after(() => t.mock.timers.reset());
  f.arm();
  await preflightFdciJob(config, "", f.fetcher);
  await callGate("open", config, f.fetcher);
  const lease = f.lease();
  assert.equal(Date.parse(lease.expires_at) - Date.parse(lease.opened_at), 600_000);
  assert.equal((await f.request("/api/internal/fdci-checkpoint", { body: { op: "get" } })).status, 200);
  assert.equal((await f.request("/api/internal/fdci-checkpoint", { owner: "previous-run", body: { op: "get" } })).status, 409);
  await assert.rejects(callGate("close", { ...config, IMPORT_GATE_RUN_ID: "previous-run" }, f.fetcher), /GATE_HTTP_409/);
  await callGate("close", config, f.fetcher);
  assert.equal(f.lease(), undefined);
  // A closed lease is not a disarmed gateway; the operator must restore flags.
  f.close();
  await assertClosed(f);
});

test("cancellation or 120-second preapproval deadline: independent operator shutdown needs no GitHub", async t => {
  const f = fixture(t);
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  t.after(() => t.mock.timers.reset());
  for (const reason of ["cancelled", "approval-deadline"]) {
    f.arm();
    await preflightFdciJob(config, "", f.fetcher);
    // Simulated operator/watchdog signal; this test does not install a real timer.
    if (reason === "approval-deadline") t.mock.timers.tick(120_000);
    f.close();
    await assertClosed(f);
    assert.equal(f.lease(), undefined);
  }
});

test("D1 identity failure aborts preflight without a lease and emergency shutdown bypasses D1", async t => {
  const f = fixture(t);
  f.arm();
  f.env.DB = { prepare() { throw new Error("synthetic database unavailable"); } };
  await assert.rejects(preflightFdciJob(config, "", f.fetcher), /GATEWAY_IDENTITY_HTTP_503/);
  assert.equal(f.lease(), undefined);
  f.close();
  await assertClosed(f);
});

test("expired lease blocks imports/checkpoints; emergency flags close even if normal cleanup is lost", async t => {
  const f = fixture(t);
  f.arm();
  await callGate("open", config, f.fetcher);
  const expiry = Date.parse(f.lease().expires_at);
  t.mock.timers.enable({ apis: ["Date"], now: expiry + 1 });
  t.after(() => t.mock.timers.reset());
  for (const path of ["/api/internal/fdci-import", "/api/internal/fdci-checkpoint"])
    assert.equal((await f.request(path)).status, 503);
  // Simulate runner termination: no runner close; CF-only shutdown still blocks access.
  f.close();
  await assertClosed(f);
  assert.ok(Date.parse(f.lease().expires_at) < Date.now());
  // TTL invalidates access; it does not physically delete the expired lease row.
});
