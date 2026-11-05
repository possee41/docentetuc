import test from "node:test";
import assert from "node:assert/strict";
import { oauthEnvironment, freshOAuth, closeCanary, closePendingCanary } from "./fdci-canary-closure.mjs";
import { readFileSync } from "node:fs";
import { fdciLocalFixture } from "./fdci-local-fixture.mjs";

test("OAuth children cannot inherit a cached API token; session refresh precedes token read", () => {
  const env = { CLOUDFLARE_API_TOKEN: "old", CF_API_TOKEN: "old", CF_API_KEY: "old", CLOUDFLARE_ACCOUNT_ID: "fixed" };
  assert.deepEqual(oauthEnvironment(env), { CLOUDFLARE_ACCOUNT_ID: "fixed" });
  assert.equal(env.CF_API_TOKEN, "old");
  const calls = [];
  const token = freshOAuth(args => {
    calls.push(args);
    return { status: 0, stdout: JSON.stringify({ type: "oauth", token: "synthetic-fresh" }) };
  });
  assert.equal(token, "synthetic-fresh");
  assert.deepEqual(calls, [["whoami", "--json"], ["auth", "token", "--json"]]);
});

test("unavailable refresh, malformed output and API-token auth fail without leaking output", () => {
  assert.throws(() => freshOAuth(() => ({ status: 1, stdout: "sensitive" })), /^Error: OAUTH_REFRESH_UNAVAILABLE$/);
  for (const stdout of ["sensitive", JSON.stringify({ type: "api_token", token: "sensitive" }), "{}"])
    assert.throws(() => freshOAuth(args => ({ status: 0, stdout: args[0] === "whoami" ? "{}" : stdout })), /^Error: OAUTH_UNAVAILABLE$/);
});

const names = ["disableExposure", "haltAndExpire", "deployClosed", "removeSecret", "verifyClosed"];
test("failed/ambiguous closure step never skips other barriers or retries a mutation", async () => {
  for (const failed of names) {
    const calls = [];
    const result = await closeCanary(Object.fromEntries(names.map(name => [name, async () => {
      calls.push(name); if (name === failed) throw Error("synthetic invalid token or ambiguous write");
    }])));
    assert.deepEqual(calls, names);
    assert.deepEqual(result.failures, [failed]);
    assert.equal(result.verified, failed !== "verifyClosed");
  }
});

test("repeated closure of an already closed synthetic resource is idempotent", async () => {
  const resource = { exposed: true, halted: false, lease: true, enabled: true, secret: true };
  const steps = {
    async disableExposure() { resource.exposed = false; },
    async haltAndExpire() { resource.halted = true; resource.lease = false; },
    async deployClosed() { resource.enabled = false; },
    async removeSecret() { resource.secret = false; },
    async verifyClosed() { assert.deepEqual(resource, { exposed: false, halted: true, lease: false, enabled: false, secret: false }); },
  };
  assert.deepEqual(await closeCanary(steps), { verified: true, failures: [] });
  assert.deepEqual(await closeCanary(steps), { verified: true, failures: [] });
});

test("fixed canary closure recovers from initial auth failure; real local SQL preserves pending data", async t => {
  const f = fdciLocalFixture(); t.after(() => f.sqlite.close());
  for (const file of ["migrations/0033_fdci_automation_control.sql", "migrations/0034_fdci_delta_queue.sql"])
    f.sqlite.exec(readFileSync(file, "utf8"));
  f.sqlite.exec("UPDATE fdci_automation_control SET status='RUNNING'; INSERT INTO import_gate_lease VALUES(1,'fdci','2099-01-01','2026-01-01','owner');");
  const state = f.sqlite.prepare("SELECT * FROM fdci_delta_state").all();
  const config = JSON.parse(readFileSync("wrangler.1.2-fdci-functional-canary.jsonc", "utf8"));
  let authCalls = 0, secret = true, exposed = true;
  const commands = [];
  const admin = {
    async auth() { if (++authCalls === 1) throw Error("synthetic invalid token"); },
    async api() { exposed = false; },
    async sql(sql) { f.sqlite.exec(sql); },
    run(args) { commands.push(args); if (args[0] === "deploy") exposed = false; else secret = false; return { status: 0 }; },
    async metadata() { return { settings: { bindings: secret ? [{ name: "FDCI_AUTOMATION_SECRET" }] : [] } }; },
    async verifyClosed() {
      assert.equal(exposed, false); assert.equal(secret, false);
      assert.equal(f.sqlite.prepare("SELECT status FROM fdci_automation_control").get().status, "HALTED");
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM import_gate_lease WHERE julianday(expires_at)>julianday('now')").get().n, 0);
      assert.deepEqual(f.sqlite.prepare("SELECT * FROM fdci_delta_state").all(), state);
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM publications").get().n, 0);
    },
  };
  assert.deepEqual(await closePendingCanary(admin, config), { verified: true, failures: ["disableExposure"] });
  assert.deepEqual(await closePendingCanary(admin, config), { verified: true, failures: [] });
  assert.equal(commands.filter(x => x[0] === "secret").length, 1);
  assert(commands.every(x => x.at(-1) === "wrangler.1.2-fdci-functional-canary.jsonc"));
  for (const bad of [{ ...config, name: "docentetuc" }, { ...config, workers_dev: true },
    { ...config, vars: { ...config.vars, FDCI_AUTOMATION_ENABLED: "true" } },
    { ...config, d1_databases: [{ ...config.d1_databases[0], database_id: "wrong" }] }]) {
    const before = authCalls;
    await assert.rejects(closePendingCanary(admin, bad), /CLOSE_CONFIG_INVALID/);
    assert.equal(authCalls, before);
  }
});
