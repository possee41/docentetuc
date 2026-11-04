import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolveGatewayConfig } from "./import-via-gateway.mjs";
import { resolveGateConfig } from "./import-gate.mjs";

const name = "docentetuc-fdci-functional-canary-1-2";
const origin = `https://${name}.possee41.workers.dev`;
const base = { SYNC_SOURCE: "fdci", IMPORT_GATEWAY_TARGET: "canary", IMPORT_GATEWAY_ORIGIN: origin,
  IMPORT_GATEWAY_DATABASE_NAME: name, IMPORT_GATEWAY_DATABASE_ID: "00000000-0000-4000-8000-000000000012",
  FDCI_IMPORT_SECRET: "synthetic_fdci_isolated_secret_123456789", IMPORT_GATE_RUN_ID: "123-1" };

test("both runner guards admit only the exact exclusive FDCI hostname and target", () => {
  assert.equal(resolveGatewayConfig(base).origin, origin);
  assert.equal(resolveGateConfig(base).endpoint, `${origin}/api/internal/import-gate`);
  for (const patch of [
    { IMPORT_GATEWAY_TARGET: "production" }, { IMPORT_GATEWAY_DATABASE_NAME: "docentetuc-web-canary-1-2" },
    ...["sime", "juntas", "cenet", "infd"].map(SYNC_SOURCE => ({ SYNC_SOURCE, [`${SYNC_SOURCE.toUpperCase()}_IMPORT_SECRET`]: base.FDCI_IMPORT_SECRET })),
    ...[origin + "/x", origin + "?x=1", origin + "#x", origin + ":8443", origin.replace("https:", "http:"),
      origin.replace("possee41", "other-account"), origin + ".evil.invalid", origin.replace("https://", "https://user:pass@"),
      origin.replace(name, name + "-other"), "https://127.0.0.1", "http://169.254.169.254"].map(IMPORT_GATEWAY_ORIGIN => ({ IMPORT_GATEWAY_ORIGIN })),
  ]) {
    assert.throws(() => resolveGatewayConfig({ ...base, ...patch }), /GATEWAY_/);
    assert.throws(() => resolveGateConfig({ ...base, ...patch }), /GATE_/);
  }
  assert.throws(() => resolveGatewayConfig({ ...base, IMPORT_GATEWAY_DATABASE_ID: "baaf5886-0123-4948-96da-aa7106424549" }), /GATEWAY_TARGET_FORBIDDEN/);
});

test("exclusive canary template is closed, has one unresolved exclusive DB and no inherited bindings", () => {
  const config = JSON.parse(readFileSync(new URL("../wrangler.1.2-fdci-functional-canary.jsonc", import.meta.url), "utf8"));
  assert.equal(config.name, name);
  assert.equal(config.account_id, "6bbc3dae7e111660f0c835677ceffb69");
  assert.equal(config.main, "workers/source-import-gateway.mjs");
  assert.deepEqual(Object.keys(config).sort(), ["name", "account_id", "main", "compatibility_date", "workers_dev", "preview_urls", "routes", "triggers", "vars", "d1_databases", "observability"].sort());
  assert.equal(config.workers_dev, false); assert.equal(config.preview_urls, false);
  assert.deepEqual(config.routes, []); assert.deepEqual(config.triggers, { crons: [] });
  assert.deepEqual(config.vars, { IMPORT_DATABASE_NAME: name, IMPORT_DATABASE_ID: "REPLACE_WITH_NEW_EXCLUSIVE_CANARY_UUID",
    IMPORT_GATE_ENABLED: "false", IMPORT_GATE_LEASE_REQUIRED: "false", IMPORT_GATE_ALLOWED_SOURCE: "fdci",
    FDCI_EXTERNAL_ENABLED: "false", FDCI_AUTOMATION_ENABLED: "false", FDCI_DELTA_ENABLED: "false" });
  assert.deepEqual(config.d1_databases, [{ binding: "DB", database_name: name, database_id: config.vars.IMPORT_DATABASE_ID }]);
  assert.deepEqual(config.observability, { enabled: true, head_sampling_rate: 1,
    logs: { enabled: true, invocation_logs: true, head_sampling_rate: 1, persist: true } });
  assert.throws(() => resolveGatewayConfig({ ...base, IMPORT_GATEWAY_DATABASE_ID: config.vars.IMPORT_DATABASE_ID }), /GATEWAY_CONFIG_INVALID/);
});

test("ten required migrations create exclusive delta schema closed and empty without reminder/AI migration", t => {
  const sqlite = new DatabaseSync(":memory:"); t.after(() => sqlite.close());
  for (const file of ["drizzle/0000_docentetuc.sql", "drizzle/0001_training_metadata.sql", "drizzle/0003_web_push.sql",
    "migrations/0008_personal_matching_circuits.sql", "migrations/0009_reliability_lifecycle.sql",
    "migrations/0029_import_gateway_identity.sql", "migrations/0031_import_gate_lease.sql",
    "migrations/0032_fdci_import_checkpoint.sql", "migrations/0033_fdci_automation_control.sql", "migrations/0034_fdci_delta_queue.sql"])
    sqlite.exec(readFileSync(file, "utf8"));
  assert.equal(sqlite.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  for (const table of ["publications", "profiles", "import_gateway_identity", "import_gate_lease", "fdci_delta_queue"])
    assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
  assert.equal(sqlite.prepare("SELECT status FROM fdci_automation_control WHERE id=1").get().status, "HALTED");
  const state = sqlite.prepare("SELECT * FROM fdci_delta_state WHERE id=1").get();
  assert.equal(state.revision, 0); assert.equal(state.detail_after, ""); assert.equal(state.detail_cycle, 1);
  assert.ok(sqlite.prepare("PRAGMA table_info(fdci_delta_queue)").all().some(c => c.name === "version" && c.notnull === 1));
  assert.ok(sqlite.prepare("PRAGMA index_list(fdci_delta_queue)").all().some(i => i.unique === 1));
});
