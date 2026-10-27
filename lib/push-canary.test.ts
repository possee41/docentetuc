import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { checkPushCanaryConfig } from "../scripts/check-push-canary-config.mjs";
import { generatePushCanarySql } from "../scripts/generate-push-canary-sql.mjs";
import { handlePushCanary } from "../workers/push-canary.mjs";

const config = JSON.parse(readFileSync("wrangler.push-canary.json", "utf8"));
const schema = readFileSync("scripts/push-canary-schema.sql", "utf8");
const token = "synthetic_canary_token_12345678901234567890";
const now = new Date("2026-10-26T12:00:00Z");

function localD1(sqlite: DatabaseSync) {
  type Statement = { bind: (...values: unknown[]) => Statement; all: () => Promise<object>; run: () => Promise<object> };
  const statement = (sql: string, params: unknown[] = []): Statement => ({
    bind: (...values: unknown[]) => statement(sql, values),
    all: async () => ({ results: sqlite.prepare(sql).all(...params as []), meta: { rows_read: 1, rows_written: 0 } }),
    run: async () => ({ meta: { rows_read: 0, rows_written: Number(sqlite.prepare(sql).run(...params as []).changes) } }),
  });
  return { prepare: (sql: string) => statement(sql) };
}

test("config canary falla cerrada ante UUID pendiente, producción y bindings extra", () => {
  assert.throws(() => checkPushCanaryConfig(config), /PUSH_CANARY_CONFIG_UNSAFE/);
  const isolated = { ...config, d1_databases: [{ ...config.d1_databases[0], database_id: "11111111-1111-1111-1111-111111111111" }] };
  assert.equal(checkPushCanaryConfig(isolated), true);
  for (const unsafe of [
    { ...isolated, d1_databases: [{ ...isolated.d1_databases[0], database_id: "baaf5886-0123-4948-96da-aa7106424549" }] },
    { ...isolated, d1_databases: [{ ...isolated.d1_databases[0], database_name: "docentetuc-db" }] },
    { ...isolated, routes: ["docentetuc.com.ar/*"] },
    { ...isolated, triggers: { crons: ["* * * * *"] } },
    { ...isolated, vars: { CANARY_BUILD_ID: "initial", VAPID_PRIVATE_KEY: "unexpected" } },
  ]) assert.throws(() => checkPushCanaryConfig(unsafe), /PUSH_CANARY_CONFIG_UNSAFE/);
});

test("SQL canary prepara exactamente 0, 100, 500 y 1000 avisos sintéticos", () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(schema);
    for (const count of [0, 100, 500, 1000]) for (const density of ["dense", "sparse"] as const) {
      sqlite.exec(generatePushCanarySql({ count, density, now }));
      assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM notifications").get() as { n: number }).n, count);
      assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").get() as { n: number }).n,
        density === "dense" ? count : Math.min(count, 2));
    }
    sqlite.prepare("UPDATE push_canary_identity SET marker='wrong'").run();
    assert.throws(() => sqlite.exec(generatePushCanarySql({ count: 0, density: "dense", now })), /malformed JSON/);
    assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM notifications").get() as { n: number }).n, 1000);
  } finally { sqlite.close(); }
});

test("Worker canary autentica, valida D1 y usa el despacho real sin enviar push", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const logs: string[] = [];
  try {
    sqlite.exec(schema);
    sqlite.exec(generatePushCanarySql({ count: 100, density: "sparse", now }));
    globalThis.fetch = async () => { throw new Error("NETWORK_FORBIDDEN"); };
    console.log = (...values) => { logs.push(values.join(" ")); };
    const env = { DB: localD1(sqlite), CANARY_BEARER_TOKEN: token };
    const url = "https://push-canary.invalid/run/100-sparse/local-1";
    const denied = await handlePushCanary(new Request(url, { method: "POST" }), env, now);
    assert.equal(denied.status, 401);
    assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM push_deliveries").get() as { n: number }).n, 0);
    const authorized = () => new Request(url, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const first = await handlePushCanary(authorized(), env, now);
    assert.equal(first.status, 200);
    const report = await first.json() as { result: { sent: number }, d1: { queries: number, rowsWritten: number } };
    assert.equal(report.result.sent, 2);
    assert.ok(report.d1.queries <= 50);
    assert.ok(report.d1.rowsWritten > 0);
    const repeated = await handlePushCanary(authorized(), env, now);
    assert.equal((await repeated.json() as { result: { sent: number } }).result.sent, 0);
    assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM push_deliveries").get() as { n: number }).n, 2);
    assert.ok(logs.every((line) => !line.includes(token) && !line.includes("fcm.googleapis.com")));
    sqlite.prepare("UPDATE push_canary_identity SET marker='wrong'").run();
    assert.equal((await handlePushCanary(authorized(), env, now)).status, 503);
  } finally { globalThis.fetch = originalFetch; console.log = originalLog; sqlite.close(); }
});
