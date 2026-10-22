import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createD1Rest } from "../scripts/d1-rest.mjs";
import { createDirectD1ReceiverFetch } from "../scripts/direct-d1-receiver.mjs";
import { runDirectD1Import } from "../scripts/import-direct-d1.mjs";
import { runFdciImport } from "../scripts/import-fdci.mjs";
import { prepareFdciImports } from "./fdci-import.ts";

function isolatedRest() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE publications (
    id TEXT PRIMARY KEY, source TEXT NOT NULL, external_id TEXT NOT NULL, kind TEXT NOT NULL,
    category TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', level TEXT NOT NULL DEFAULT '',
    area TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', character TEXT NOT NULL DEFAULT '',
    circuit TEXT NOT NULL DEFAULT 'UNKNOWN', source_circuit_raw TEXT NOT NULL DEFAULT '',
    circuit_inference_source TEXT NOT NULL DEFAULT 'unknown', circuit_confidence INTEGER NOT NULL DEFAULT 0,
    starts_at TEXT, ends_at TEXT, status TEXT NOT NULL, official_url TEXT NOT NULL, metadata TEXT NOT NULL,
    content_hash TEXT NOT NULL, source_updated_at TEXT, registration_open_at TEXT, registration_close_at TEXT,
    expires_at TEXT, source_status TEXT NOT NULL, normalized_status TEXT NOT NULL, removed_at TEXT,
    last_seen_at TEXT NOT NULL DEFAULT '', last_changed_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  `);
  let failed = false;
  const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
    const header = new Headers(init?.headers).get("authorization");
    assert.match(header || "", /^Bearer local_test_token_/);
    if (failed) return Response.json({ success: false, result: [] }, { status: 503 });
    const { sql, params } = JSON.parse(String(init?.body)) as { sql: string; params: string[] };
    assert.ok(params.every((value) => typeof value === "string"));
    const statement = sqlite.prepare(sql);
    const isRead = /^\s*SELECT\b/i.test(sql);
    const result = isRead ? { results: statement.all(...params), meta: { rows_read: 1, rows_written: 0 } } :
      (() => { const changes = statement.run(...params).changes; return { results: [], meta: { rows_read: 0, rows_written: Number(changes) } }; })();
    return Response.json({ success: true, result: [{ ...result, success: true }] });
  };
  const db = createD1Rest({ accountId: "a".repeat(32), databaseId: "b".repeat(8) + "-bbbb-bbbb-bbbb-" + "b".repeat(12),
    token: "local_test_token_12345678901234567890", fetcher });
  return { sqlite, db, fail: () => { failed = true; } };
}

test("Node → D1 REST aislada conserva históricos, actualiza y no duplica FDCI", async () => {
  const { sqlite, db } = isolatedRest();
  sqlite.prepare(`INSERT INTO publications(id,source,external_id,kind,category,title,status,official_url,metadata,content_hash,source_status,normalized_status)
    VALUES('historic:1','SIME','1','vacante','Vacante','Histórica','cerrada','https://sime.educaciontuc.gov.ar/','{}','old','cerrada','CLOSED')`).run();
  const receiver = createDirectD1ReceiverFetch(db);
  const selection = { token: "synthetic", slug: "curso", commissionId: "6397" };
  const course = { capacitacion_id: 42, nombre: "Curso sintético", token: selection.token, slug: selection.slug, niveles: "Primaria" };
  const commission = { id: 6397, capacitacion_id: 42, fecha_apertura_preinscripcion: "2026-10-24 23:00:00",
    fecha_cierre_preinscripcion: "2026-10-26 08:00:00", cupo: 0 };
  const [item] = await prepareFdciImports([course], [commission], new Date("2026-10-22T15:00:00Z"));
  const run = (row: typeof item) => runFdciImport({ endpoint: receiver.endpoint("/api/internal/fdci-import"),
    token: receiver.token, fetcher: receiver.receiverFetch, selection, scope: "single",
    collect: async () => ({ items: [row], failures: 0, coursesFetched: 1 }) });
  assert.equal((await run(item)).created, 1);
  assert.equal((await run(item)).unchanged, 1);
  const [updated] = await prepareFdciImports([course], [{ ...commission, fecha_cierre_preinscripcion: "2026-10-27 08:00:00" }], new Date("2026-10-22T15:00:00Z"));
  assert.equal((await run(updated)).updated, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM publications").get()?.n, 2);
  assert.equal(sqlite.prepare("SELECT title FROM publications WHERE id='historic:1'").get()?.title, "Histórica");
  assert.equal(sqlite.prepare("SELECT registration_close_at FROM publications WHERE id='fdci:commission:6397'").get()?.registration_close_at,
    "2026-10-27T08:00:00-03:00");
  assert.equal(db.metrics().rowsWritten, 2);
  sqlite.close();
});

test("D1 REST rechaza errores sin confirmar escritura ni filtrar el token", async () => {
  const { db, fail } = isolatedRest();
  fail();
  await assert.rejects(db.prepare("SELECT 1").bind().all(), /^Error: D1_HTTP_503$/);
  assert.equal(db.metrics().rowsWritten, 0);
  assert.throws(() => createD1Rest({ accountId: "bad", databaseId: "bad", token: "short" }), /D1_CONFIGURATION_INVALID/);
});

test("el ejecutor FDCI completo usa la fuente sintética y D1 REST sin Worker HTTP", async () => {
  const { sqlite, db } = isolatedRest();
  const course = { capacitacion_id: 42, nombre: "Curso sintético", token: "synthetic", slug: "curso", niveles: "Primaria" };
  const commission = { id: 6397, capacitacion_id: 42, fecha_apertura_preinscripcion: "2026-10-24 23:00:00",
    fecha_cierre_preinscripcion: "2026-10-26 08:00:00", cupo: 0 };
  const sourceFetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/getCapaActivas")) return Response.json([commission]);
    if (url.endsWith("/getRestoCapas")) return Response.json([course]);
    if (url.endsWith("/getCupo")) return Response.json({ comisiones: [commission] });
    throw new Error("UNEXPECTED_SOURCE_URL");
  };
  const options = { source: "fdci", db, sourceFetch,
    selection: { token: "synthetic", slug: "curso", commissionId: "6397" } };
  assert.equal((await runDirectD1Import(options)).created, 1);
  assert.equal((await runDirectD1Import(options)).unchanged, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM publications WHERE id='fdci:commission:6397'").get()?.n, 1);
  sqlite.close();
});
