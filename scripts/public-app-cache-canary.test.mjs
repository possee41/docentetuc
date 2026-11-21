import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { Miniflare } = require("../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare");
const root = resolve(import.meta.dirname, "..");

test("preparación canary: cerrado sin tablas, métricas por petición y vencimiento", async () => {
  execFileSync(process.execPath, ["scripts/prepare-public-app-cache-canary.mjs"], { cwd: root });
  const config = JSON.parse(readFileSync(resolve(root, ".wrangler/public-app-cache-canary/wrangler.jsonc"), "utf8"));
  assert.equal(config.name, "docentetuc-web-canary-1-2");
  assert.equal(config.d1_databases[0].database_id, "853e2f5d-89b1-46a3-9c1c-5cbd46784756");
  assert.deepEqual(config.triggers.crons, []);
  assert.equal(config.routes, undefined);
  assert.equal(config.vars.PUBLIC_CACHE_TEST_ENABLED, "false");
  const options = { modules: true, script: readFileSync(resolve(root, ".wrangler/public-app-cache-canary/worker.mjs"), "utf8"),
    compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
    versionMetadata: "VERSION_METADATA", bindings: config.vars, d1Databases: ["DB"], d1Persist: false, cachePersist: false };
  const mf = new Miniflare(options);
  const url = "https://cache-preparation.test/api/public-app";
  try {
    // No tables exist: 503 must happen before any SQL or identity query.
    assert.equal((await mf.dispatchFetch(url)).status, 503);
    const enabled = { ...config.vars, PUBLIC_CACHE_TEST_ENABLED: "true", PUBLIC_APP_CACHE_ENABLED: "1",
      PUBLIC_CACHE_TEST_UNTIL: new Date(Date.now() + 120_000).toISOString(),
      PUBLIC_CACHE_TEST_RUN_ID: "cache-local-only", PUBLIC_APP_CACHE_VERSION: "cache-local-only" };
    await mf.setOptions({ ...options, bindings: enabled });
    const db = await mf.getD1Database("DB");
    await db.prepare("CREATE TABLE publications(id TEXT PRIMARY KEY,kind TEXT,metadata TEXT,ends_at TEXT,starts_at TEXT,updated_at TEXT)").run();
    await db.prepare("INSERT INTO publications VALUES('synthetic:1','informacion','{}',NULL,NULL,'2026-10-30')").run();
    await db.prepare("CREATE TABLE sync_state(source TEXT,synced_at TEXT,last_attempt_at TEXT,last_successful_sync_at TEXT,sync_status TEXT)").run();
    const headers = { "x-public-cache-test-run": "cache-local-only", "x-public-cache-test-step": "miss" };
    const first = await mf.dispatchFetch(url, { headers });
    assert.equal(first.status, 200); assert.equal(first.headers.get("X-Public-App-Cache"), "MISS");
    assert.equal(first.headers.get("X-Public-Cache-Test-Queries"), "2");
    assert.equal(first.headers.get("X-Public-Cache-Test-Rows-Written"), "0");
    assert.ok(first.headers.get("X-Public-Cache-Test-Version"));
    const body = await first.json();
    const hit = await mf.dispatchFetch(url, { headers: { ...headers, "x-public-cache-test-step": "hit" } });
    assert.equal(hit.headers.get("X-Public-App-Cache"), "HIT");
    assert.equal(hit.headers.get("X-Public-Cache-Test-Queries"), "0");
    assert.equal(hit.headers.get("X-Public-Cache-Test-Rows-Read"), "0");
    assert.deepEqual(await hit.json(), body);
    assert.equal((await mf.dispatchFetch(url)).status, 404);
    assert.equal((await mf.dispatchFetch(url, { method: "POST", headers })).status, 404);
    await mf.setOptions({ ...options, bindings: { ...enabled, PUBLIC_CACHE_TEST_UNTIL: "2000-01-01T00:00:00Z" } });
    assert.equal((await mf.dispatchFetch(url, { headers })).status, 503);
    await mf.setOptions(options);
    assert.equal((await mf.dispatchFetch(url)).status, 503);
  } finally { await mf.dispose(); }
});
