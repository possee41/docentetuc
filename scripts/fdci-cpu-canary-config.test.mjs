import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import gateway from "../workers/source-import-gateway.mjs";

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const config = read("../wrangler.1.2-fdci-cpu-canary.jsonc");

test("CPU capture requests all invocation logs using installed Wrangler schema fields", () => {
  const schema = read("../node_modules/wrangler/config-schema.json").definitions.Observability;
  const obs = config.observability;
  assert.equal(obs.enabled, true);
  assert.equal(obs.head_sampling_rate, 1);
  assert.deepEqual(obs.logs, { enabled: true, invocation_logs: true, head_sampling_rate: 1, persist: true });
  for (const [key, value] of Object.entries(obs)) {
    assert.ok(Object.hasOwn(schema.properties, key), key);
    assert.equal(typeof value, schema.properties[key].type);
  }
  for (const [key, value] of Object.entries(obs.logs)) {
    assert.ok(Object.hasOwn(schema.properties.logs.properties, key), key);
    assert.equal(typeof value, schema.properties.logs.properties[key].type);
  }
});

test("logging-only target has no D1, secrets, custom routes, Cron or production bindings", () => {
  assert.equal(config.name, "docentetuc-fdci-cpu-canary-1-2");
  assert.equal(config.main, "workers/source-import-gateway.mjs");
  assert.equal(config.workers_dev, true);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.routes, []);
  assert.deepEqual(config.triggers, { crons: [] });
  assert.deepEqual(config.vars, {
    IMPORT_GATE_ENABLED: "false", IMPORT_GATE_LEASE_REQUIRED: "false", IMPORT_GATE_ALLOWED_SOURCE: "fdci",
    FDCI_EXTERNAL_ENABLED: "false", FDCI_AUTOMATION_ENABLED: "false",
  });
  // Allow-list also excludes env overrides, services and inherited resource bindings.
  assert.deepEqual(Object.keys(config).sort(), ["name", "main", "compatibility_date", "workers_dev",
    "preview_urls", "routes", "triggers", "vars", "observability"].sort());
});

test("real gateway remains closed before touching D1, with capture enabled or disabled", async () => {
  const paths = [
    ["GET", "/api/internal/import-identity?source=fdci"],
    ["POST", "/api/internal/import-gate"],
    ["POST", "/api/internal/fdci-import"],
    ["POST", "/api/internal/fdci-checkpoint"],
    ["POST", "/api/internal/fdci-automation/start"],
    ["POST", "/api/internal/fdci-automation/import"],
  ];
  for (const captureEnabled of [true, false]) {
    const candidate = { ...config, observability: { ...config.observability, enabled: captureEnabled } };
    let dbAccesses = 0;
    const env = { ...candidate.vars, DB: new Proxy({}, {
      get() { dbAccesses++; throw new Error("UNEXPECTED_D1_OPERATION"); },
    }) };
    for (const [method, path] of paths) {
      const response = await gateway.fetch(new Request(`https://synthetic.invalid${path}`, { method }), env);
      assert.equal(response.status, 503, `${captureEnabled}: ${path}`);
      assert.equal((await gateway.fetch(new Request(`https://synthetic.invalid${path}`, { method }), candidate.vars)).status, 503);
    }
    assert.equal(dbAccesses, 0);
  }
});
