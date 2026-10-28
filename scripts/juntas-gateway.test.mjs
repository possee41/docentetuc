import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import gateway from "../workers/source-import-gateway.mjs";
import { runGatewayImport, resolveGatewayConfig } from "./import-via-gateway.mjs";
import { createJuntasGatewayDb } from "./juntas-gateway-db.mjs";

const secret = "synthetic_juntas_gateway_secret_123456789";
const config = { SYNC_SOURCE: "juntas", IMPORT_GATEWAY_ORIGIN: "http://127.0.0.1:8798/",
  IMPORT_GATEWAY_DATABASE_ID: "00000000-0000-4000-8000-000000000012",
  IMPORT_GATEWAY_DATABASE_NAME: "docentetuc-web-canary-1-2-local", JUNTAS_IMPORT_SECRET: secret,
  JUNTA_ROOT_ID: "abiertos-primaria", GOOGLE_DRIVE_API_KEY: "synthetic_drive_key", JUNTAS_MAX_REQUESTS: "5",
  JUNTAS_MAX_PUBLICATION_WRITES: "10" };

function setup() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE import_gateway_identity(id INTEGER PRIMARY KEY,database_name TEXT,database_id TEXT);
    INSERT INTO import_gateway_identity VALUES(1,'${config.IMPORT_GATEWAY_DATABASE_NAME}','${config.IMPORT_GATEWAY_DATABASE_ID}');
    CREATE TABLE publications (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, external_id TEXT NOT NULL, kind TEXT NOT NULL,
      category TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', level TEXT NOT NULL DEFAULT '',
      area TEXT NOT NULL DEFAULT '', junta TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '',
      shift TEXT NOT NULL DEFAULT '', character TEXT NOT NULL DEFAULT '', starts_at TEXT, ends_at TEXT,
      status TEXT NOT NULL, official_url TEXT NOT NULL, metadata TEXT NOT NULL, content_hash TEXT NOT NULL,
      source_updated_at TEXT, source_published_at TEXT, registration_open_at TEXT, registration_close_at TEXT,
      expires_at TEXT, source_status TEXT NOT NULL DEFAULT 'UNKNOWN', normalized_status TEXT NOT NULL DEFAULT 'UNKNOWN',
      removed_at TEXT, last_seen_at TEXT NOT NULL DEFAULT '', last_changed_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE sync_state(source TEXT PRIMARY KEY,synced_at TEXT NOT NULL DEFAULT '',item_count INTEGER NOT NULL DEFAULT 0,
      sync_status TEXT NOT NULL DEFAULT 'UNKNOWN',last_attempt_at TEXT,last_successful_sync_at TEXT,error_code TEXT);`);
  sqlite.exec(readFileSync(new URL("../migrations/0026_juntas_incremental.sql", import.meta.url), "utf8"));
  const db = { prepare(sql) { return { bind: (...args) => ({
    first: async () => sqlite.prepare(sql).get(...args) || null,
    all: async () => { const results = sqlite.prepare(sql).all(...args); return { results, meta: { rows_read: results.length } }; },
    run: async () => { const result = sqlite.prepare(sql).run(...args); return { meta: { changes: result.changes, rows_written: result.changes } }; },
  }), first: async () => sqlite.prepare(sql).get() || null,
    all: async () => { const results = sqlite.prepare(sql).all(); return { results, meta: { rows_read: results.length } }; } }; },
    batch: async (statements) => Promise.all(statements.map((item) => item.run())) };
  const env = { DB: db, IMPORT_GATE_ENABLED: "true", IMPORT_DATABASE_NAME: config.IMPORT_GATEWAY_DATABASE_NAME,
    IMPORT_DATABASE_ID: config.IMPORT_GATEWAY_DATABASE_ID, JUNTAS_IMPORT_SECRET: secret };
  return { sqlite, env, receiverFetch: (url, init) => gateway.fetch(new Request(url, init), env) };
}

test("Juntas resumes a partial local checkpoint through the isolated gateway without omissions or duplicates", async () => {
  const h = setup();
  const target = resolveGatewayConfig(config);
  const step = { ...config, JUNTAS_MAX_REQUESTS: "1", JUNTAS_MAX_PUBLICATION_WRITES: "1" };
  let sourceCalls = 0;
  const sourceFetch = async (input) => {
    sourceCalls++;
    assert.equal(new URL(input).hostname, "www.googleapis.com");
    return Response.json({ files: ["synthetic-file-123456", "synthetic-file-654321"].map((id) => ({
      id, name: "Llamado histórico de referencia", mimeType: "application/pdf",
      modifiedTime: "2026-10-01T10:00:00Z" })) });
  };
  const unauth = await gateway.fetch(new Request(`${target.origin}/api/internal/juntas-checkpoint`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "health", args: [] }) }), h.env);
  assert.equal(unauth.status, 401);
  assert.equal((await gateway.fetch(new Request(target.endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "batch", items: [] }) }), h.env)).status, 401);
  const injection = await h.receiverFetch(`${target.origin}/api/internal/juntas-checkpoint`, { method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ op: "sql", args: ["DELETE FROM publications"] }) });
  assert.equal(injection.status, 400);
  assert.throws(() => createJuntasGatewayDb(target, h.receiverFetch).prepare("DELETE FROM publications"), /SQL_FORBIDDEN/);
  const first = await runGatewayImport(target, step, sourceFetch, h.receiverFetch);
  assert.equal(first.created, 1);
  assert.equal(first.completed, false); // Other official Junta roots have not completed.
  assert.equal(first.publicationAttempts, 1);
  const partial = h.sqlite.prepare("SELECT state_json,status FROM juntas_import_checkpoint WHERE root_id='abiertos-primaria'").get();
  assert.equal(partial.status, "PARTIAL");
  assert.equal(JSON.parse(partial.state_json).page.index, 1);
  assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS n FROM publications").get().n, 1);
  assert.equal(h.sqlite.prepare("SELECT normalized_status FROM publications").get().normalized_status, "UNKNOWN");
  const resume = await runGatewayImport(target, step, async () => { throw new Error("UNEXPECTED_SOURCE_REQUERY"); }, h.receiverFetch);
  assert.equal(resume.created, 1);
  assert.equal(resume.updated, 0);
  assert.equal(resume.publicationAttempts, 1);
  assert.equal(resume.sourceRequests, 0);
  assert.equal(sourceCalls, 1);
  assert.deepEqual(h.sqlite.prepare("SELECT id FROM publications ORDER BY id").all().map((row) => row.id),
    ["drive:abiertos-primaria:synthetic-file-123456", "drive:abiertos-primaria:synthetic-file-654321"]);
  assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS n FROM juntas_import_applied WHERE root_id='abiertos-primaria'").get().n, 2);
  const finished = h.sqlite.prepare("SELECT state_json,status FROM juntas_import_checkpoint WHERE root_id='abiertos-primaria'").get();
  assert.equal(finished.status, "OK");
  assert.equal(JSON.parse(finished.state_json).queue.length, 0);
});
