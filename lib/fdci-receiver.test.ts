import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import worker from "../workers/fdci-receiver.mjs";
import { prepareFdciImports } from "./fdci-import.ts";

const secret = "synthetic_receiver_secret_1234567890";
const endpoint = "https://receiver.example/api/internal/fdci-import";
const course = { capacitacion_id: 42, nombre: "Capacitación sintética", token: "synthetic", slug: "curso", niveles: "Primaria" };
const commission = { id: 6379, capacitacion_id: 42, fecha_apertura_preinscripcion: "2026-10-17 23:00:00", fecha_cierre_preinscripcion: "2026-10-19 08:00:00" };

function localDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE publications (
    id TEXT PRIMARY KEY, source TEXT NOT NULL, external_id TEXT NOT NULL, kind TEXT NOT NULL,
    category TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', level TEXT NOT NULL DEFAULT '',
    area TEXT NOT NULL DEFAULT '', junta TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '',
    shift TEXT NOT NULL DEFAULT '', character TEXT NOT NULL DEFAULT '', circuit TEXT NOT NULL DEFAULT 'UNKNOWN',
    source_circuit_raw TEXT NOT NULL DEFAULT '', circuit_inference_source TEXT NOT NULL DEFAULT 'unknown',
    circuit_confidence INTEGER NOT NULL DEFAULT 0, starts_at TEXT, ends_at TEXT, status TEXT NOT NULL,
    official_url TEXT NOT NULL, metadata TEXT NOT NULL, content_hash TEXT NOT NULL, source_updated_at TEXT,
    registration_open_at TEXT, registration_close_at TEXT, expires_at TEXT, source_status TEXT NOT NULL,
    normalized_status TEXT NOT NULL, removed_at TEXT, last_seen_at TEXT NOT NULL DEFAULT '',
    last_changed_at TEXT NOT NULL DEFAULT '', first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE sync_state (source TEXT PRIMARY KEY, synced_at TEXT NOT NULL, item_count INTEGER NOT NULL DEFAULT 0);`);
  const prepare = (sql: string) => ({ bind: (...values: unknown[]) => ({
    all: async () => {
      const results = sqlite.prepare(sql).all(...values as []) as Record<string, unknown>[];
      return { results, meta: { rows_read: results.length } };
    },
    run: async () => {
      const result = sqlite.prepare(sql).run(...values as []);
      return { meta: { rows_written: Number(result.changes), rows_read: 0 } };
    },
  }) });
  const db = { prepare, batch: async (statements: { run: () => Promise<unknown> }[]) => {
    sqlite.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec("COMMIT"); return results; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } } as unknown as D1Database;
  return { sqlite, db };
}

function request(body: unknown, authorized = true) {
  return new Request(endpoint, { method: "POST", headers: { "Content-Type": "application/json", ...(authorized ? { Authorization: `Bearer ${secret}` } : {}) }, body: JSON.stringify(body) });
}

test("el Worker independiente exige autorización, limita a cinco e ignora duplicados", async () => {
  const { sqlite, db } = localDb();
  const env = { DB: db, FDCI_IMPORT_SECRET: secret };
  const items = await prepareFdciImports([course], Array.from({ length: 5 }, (_, index) => ({ ...commission, id: index + 6379 })), new Date("2026-10-18T12:00:00-03:00"));
  assert.equal((await worker.fetch(request({ mode: "batch", items: [items[0]] }, false), env)).status, 401);
  assert.equal((await worker.fetch(request({ mode: "batch", items: [...items, items[0]] }), env)).status, 400);
  sqlite.prepare(`INSERT INTO publications (id,source,external_id,kind,category,title,status,official_url,metadata,content_hash,source_status,normalized_status)
    VALUES ('legacy','Capacitación Docente','old','capacitacion','Capacitación','Histórica','finalizada','https://capacitaciondocente.educaciontuc.gov.ar/capacitaciones','{}','old','finalizada','CLOSED')`).run();
  const first = await worker.fetch(request({ mode: "batch", items: [items[0]] }), env);
  assert.equal(first.status, 200);
  assert.equal((await first.json() as { created: number }).created, 1);
  const five = await worker.fetch(request({ mode: "batch", items }), env);
  assert.equal(five.status, 200);
  assert.equal((await five.json() as { created: number }).created, 4);
  const repeat = await worker.fetch(request({ mode: "batch", items }), env);
  assert.equal((await repeat.json() as { rowsWritten: number }).rowsWritten, 0);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM publications").get()?.n, 6);
  assert.equal(sqlite.prepare("SELECT title FROM publications WHERE id='legacy'").get()?.title, "Histórica");
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM sync_state").get()?.n, 0);
});

test("el Worker actualiza una comisión y no altera históricos ante error D1", async () => {
  const { sqlite, db } = localDb();
  const env = { DB: db, FDCI_IMPORT_SECRET: secret };
  const [item] = await prepareFdciImports([course], [commission], new Date("2026-10-18T12:00:00-03:00"));
  await worker.fetch(request({ mode: "batch", items: [item] }), env);
  const [changed] = await prepareFdciImports([course], [{ ...commission, fecha_cierre_preinscripcion: "2026-10-20 08:00:00" }], new Date("2026-10-18T12:00:00-03:00"));
  const response = await worker.fetch(request({ mode: "batch", items: [changed] }), env);
  assert.equal((await response.json() as { updated: number }).updated, 1);
  assert.equal(sqlite.prepare("SELECT registration_close_at FROM publications WHERE id=?").get(item.id)?.registration_close_at, "2026-10-20T08:00:00-03:00");
  const failing = { ...env, DB: { prepare: () => { throw new Error("synthetic D1 error"); } } };
  assert.equal((await worker.fetch(request({ mode: "batch", items: [changed] }), failing)).status, 503);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM publications").get()?.n, 1);
});
