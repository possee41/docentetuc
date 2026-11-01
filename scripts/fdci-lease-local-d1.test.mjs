import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { prepareFdciImports } from "../lib/fdci-import.ts";

// Same installed runtime used by the existing isolated D1 checks; no downloads.
const require = createRequire(import.meta.url);
const { Miniflare } = require("../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare");
const { build } = require("../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild");

test("gateway real en Workerd y D1 efímera: propietario, escritura y repetición sin cambios", async () => {
  const bundle = await build({ entryPoints: ["workers/source-import-gateway.mjs"], bundle: true,
    write: false, format: "esm", platform: "browser", target: "es2022" });
  const secret = "synthetic_local_fdci_secret_1234567890";
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text,
    d1Databases: ["DB"], d1Persist: false, compatibilityDate: "2026-05-15", bindings: {
      IMPORT_DATABASE_NAME: "synthetic-canary", IMPORT_DATABASE_ID: "synthetic-id",
      IMPORT_GATE_ENABLED: "false", IMPORT_GATE_LEASE_REQUIRED: "true", IMPORT_GATE_ALLOWED_SOURCE: "fdci",
      FDCI_EXTERNAL_ENABLED: "true", FDCI_IMPORT_SECRET: secret,
    } });
  try {
    const db = await mf.getD1Database("DB");
    await db.exec(`CREATE TABLE publications (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, external_id TEXT NOT NULL, kind TEXT NOT NULL,
      category TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', level TEXT NOT NULL DEFAULT '',
      area TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', character TEXT NOT NULL DEFAULT '',
      circuit TEXT NOT NULL DEFAULT 'UNKNOWN', source_circuit_raw TEXT NOT NULL DEFAULT '',
      circuit_inference_source TEXT NOT NULL DEFAULT 'unknown', circuit_confidence INTEGER NOT NULL DEFAULT 0,
      starts_at TEXT, ends_at TEXT, status TEXT NOT NULL, official_url TEXT NOT NULL, metadata TEXT NOT NULL,
      content_hash TEXT NOT NULL, source_updated_at TEXT, registration_open_at TEXT, registration_close_at TEXT,
      expires_at TEXT, source_status TEXT NOT NULL, normalized_status TEXT NOT NULL, removed_at TEXT,
      last_seen_at TEXT NOT NULL DEFAULT '', last_changed_at TEXT NOT NULL DEFAULT '',
      first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ); CREATE TABLE import_gateway_identity(id INTEGER PRIMARY KEY,database_name TEXT,database_id TEXT);
    INSERT INTO import_gateway_identity VALUES(1,'synthetic-canary','synthetic-id');`.replace(/\s+/g, " "));
    await db.exec(readFileSync("migrations/0031_import_gate_lease.sql", "utf8").replace(/^--.*$/gm, "").replace(/\s+/g, " "));
    const post = (path, body, owner = "local-a") => mf.dispatchFetch(`https://local.test/api/internal/${path}`, {
      method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json", "x-import-gate-owner": owner },
      body: JSON.stringify(body) });
    const control = (action, owner = "local-a") => post("import-gate", { source: "fdci", action, owner, ttlSeconds: 600 });
    assert.equal((await post("import-gate", { source: "constructor", action: "open", owner: "local-a" })).status, 400);
    const openings = await Promise.all([control("open"), control("open", "local-b")]);
    assert.deepEqual(openings.map(r => r.status).sort(), [200, 409]);
    const owner = (await db.prepare("SELECT opened_by FROM import_gate_lease").first()).opened_by;
    const [item] = await prepareFdciImports([{ capacitacion_id: 42, nombre: "Ficticio", token: "ficticio", slug: "ficticio" }],
      [{ id: 9001, capacitacion_id: 42, fecha_apertura_preinscripcion: "2026-10-17 23:00:00", fecha_cierre_preinscripcion: "2026-10-19 08:00:00" }]);
    const body = { mode: "batch", items: [item] };
    assert.equal((await post("fdci-import", body, "loser")).status, 409);
    const first = await post("fdci-import", body, owner);
    assert.equal(first.status, 200);
    const created = await first.json();
    assert.equal(created.created, 1);
    const repeat = await post("fdci-import", body, owner);
    assert.equal(repeat.status, 200);
    const unchanged = await repeat.json();
    assert.equal(unchanged.unchanged, 1);
    assert.equal(unchanged.rowsWritten, 0);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM publications").first()).n, 1);
    assert.equal((await control("close", "loser")).status, 409);
    assert.equal((await control("close", owner)).status, 200);
    assert.equal((await post("fdci-import", body, owner)).status, 503);
    console.log(JSON.stringify({ runtime: "local-workerd", receiver: { first: created, repeat: unchanged }, cpuMs: null }));
  } finally { await mf.dispose(); }
});
