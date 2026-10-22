import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import receiver from "../workers/sime-receiver.mjs";
import { runSimeImport } from "../scripts/import-sime.mjs";
import { APP_PUBLICATIONS_QUERY } from "./app-publications-query.ts";
import { officialMetadata } from "./official-publication.ts";

const endpoint = "https://sime-receiver.example/api/internal/sime-import";
const secret = "synthetic_sime_receiver_secret_123456";
const vacancy = { id: 9401, codigo: "PDVC-20261022-9401", caracter: "SUPLENTE", fechaPublicacionInicio: "22/10/2026 08:00",
  fechaPublicacionFin: "23/10/2026 18:00", cargos: "[9000306/00] ESC. 172 - MAESTRO DE JARDIN", abierto: true };
const now = new Date("2026-10-22T15:00:00Z");

function localD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE publications (
    id TEXT PRIMARY KEY, source TEXT NOT NULL, external_id TEXT NOT NULL, kind TEXT NOT NULL,
    category TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', level TEXT NOT NULL DEFAULT '',
    area TEXT NOT NULL DEFAULT '', junta TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '',
    shift TEXT NOT NULL DEFAULT '', character TEXT NOT NULL DEFAULT '', circuit TEXT NOT NULL DEFAULT 'UNKNOWN',
    source_circuit_raw TEXT NOT NULL DEFAULT '', circuit_inference_source TEXT NOT NULL DEFAULT 'unknown',
    circuit_confidence INTEGER NOT NULL DEFAULT 0, starts_at TEXT, ends_at TEXT, status TEXT NOT NULL,
    official_url TEXT NOT NULL, metadata TEXT NOT NULL, content_hash TEXT NOT NULL, source_updated_at TEXT,
    source_published_at TEXT, registration_open_at TEXT, registration_close_at TEXT, expires_at TEXT,
    source_status TEXT NOT NULL DEFAULT 'UNKNOWN', normalized_status TEXT NOT NULL DEFAULT 'UNKNOWN',
    removed_at TEXT, last_seen_at TEXT NOT NULL DEFAULT '', last_changed_at TEXT NOT NULL DEFAULT '',
    first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE sync_state(source TEXT PRIMARY KEY,synced_at TEXT NOT NULL,item_count INTEGER NOT NULL DEFAULT 0,
      error TEXT,last_attempt_at TEXT,last_successful_sync_at TEXT,last_content_change_at TEXT,
      records_created INTEGER NOT NULL DEFAULT 0,records_updated INTEGER NOT NULL DEFAULT 0,records_removed INTEGER NOT NULL DEFAULT 0,
      records_expired INTEGER NOT NULL DEFAULT 0,sync_status TEXT NOT NULL DEFAULT 'UNKNOWN',error_code TEXT,error_message TEXT,
      parser_version TEXT NOT NULL DEFAULT '1');`);
  const prepare = (sql: string) => ({ bind: (...values: unknown[]) => ({
    all: async () => { const results = sqlite.prepare(sql).all(...values as []) as Record<string, unknown>[]; return { results, meta: { rows_read: results.length } }; },
    run: async () => { const result = sqlite.prepare(sql).run(...values as []); return { meta: { rows_written: Number(result.changes), rows_read: 0 } }; },
  }) });
  const db = { prepare, batch: async (statements: { run: () => Promise<unknown> }[]) => {
    sqlite.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec("COMMIT"); return results; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } } as unknown as D1Database;
  return { sqlite, db };
}

function harness() {
  const { sqlite, db } = localD1();
  const env = { DB: db, SIME_IMPORT_SECRET: secret };
  let sourceFailure = false;
  let failedJunta = false;
  let detailsFail = false;
  let current = { ...vacancy };
  const sourceFetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (sourceFailure) return new Response("", { status: 503 });
    if (failedJunta && url.includes("ObtenerPeriodos/2")) return new Response("", { status: 503 });
    if (url.includes("ObtenerPeriodos")) return Response.json({ periodos: [{ text: "10/2026" }] });
    if (url.includes("ObtenerVacantes/1")) return Response.json({ vacantes: [current] });
    if (url.includes("ObtenerVacantes")) return Response.json({ vacantes: [] });
    if (url.includes("ObtenerVacante/9401")) return detailsFail ? new Response("", { status: 503 }) :
      Response.json({ vacante: { descripcion: "Inscripción online por SIME", fechaDesignacion: "24/10/2026", designado: "dato privado" } });
    throw new Error("URL inesperada");
  }) as typeof fetch;
  const receiverFetch = (async (input: RequestInfo | URL, init?: RequestInit) => receiver.fetch(new Request(input, init), env)) as typeof fetch;
  const run = () => runSimeImport({ endpoint, token: secret, sourceFetch, receiverFetch, now });
  return { sqlite, env, run, setSourceFailure: (value: boolean) => { sourceFailure = value; },
    setFailedJunta: (value: boolean) => { failedJunta = value; },
    setDetailsFail: (value: boolean) => { detailsFail = value; }, setVacancy: (value: typeof vacancy) => { current = value; } };
}

test("SIME → Node → D1 aislada → consulta pública; repetición no escribe ni duplica", async () => {
  const h = harness();
  h.sqlite.prepare(`INSERT INTO publications(id,source,external_id,kind,category,title,status,official_url,metadata,content_hash)
    VALUES('sime:9000','SIME','9000','vacante','Vacante','Histórica','cerrada','https://sime.educaciontuc.gov.ar/','{}','old')`).run();
  const first = await h.run(), repeat = await h.run();
  assert.deepEqual([first.created, first.updated, repeat.unchanged, repeat.rowsWritten], [1, 0, 1, 0]);
  const visible = h.sqlite.prepare(APP_PUBLICATIONS_QUERY).all() as { id: string; metadata: string; starts_at: string; ends_at: string }[];
  const row = visible.find((item) => item.id === "sime:9401");
  assert.ok(row, "El pedido debe figurar en la consulta pública usada por la aplicación");
  assert.equal(row.starts_at, "2026-10-22T08:00:00-03:00");
  assert.equal(row.ends_at, "2026-10-23T18:00:00-03:00");
  assert.deepEqual(officialMetadata({ metadata: row.metadata })?.topics, ["INSCRIPCION_SIME"]);
  assert.equal(JSON.stringify(row).includes("dato privado"), false);
  assert.equal(h.sqlite.prepare("SELECT count(*) AS n FROM publications").get()?.n, 2);
  assert.equal(h.sqlite.prepare("SELECT sync_status FROM sync_state WHERE source='SIME'").get()?.sync_status, "OK");
});

test("SIME actualiza fechas; fallo parcial o de fuente preserva éxito y publicaciones", async () => {
  const h = harness();
  await h.run();
  h.setVacancy({ ...vacancy, fechaPublicacionFin: "24/10/2026 18:00" });
  assert.equal((await h.run()).updated, 1);
  const lastSuccess = h.sqlite.prepare("SELECT last_successful_sync_at FROM sync_state WHERE source='SIME'").get()?.last_successful_sync_at;
  assert.equal(h.sqlite.prepare("SELECT ends_at FROM publications WHERE id='sime:9401'").get()?.ends_at, "2026-10-24T18:00:00-03:00");
  h.setDetailsFail(true);
  await assert.rejects(h.run(), /SIME_PARTIAL_SOURCE/);
  assert.equal(h.sqlite.prepare("SELECT count(*) AS n FROM publications").get()?.n, 1);
  h.setSourceFailure(true);
  await assert.rejects(h.run());
  assert.equal(h.sqlite.prepare("SELECT last_successful_sync_at FROM sync_state WHERE source='SIME'").get()?.last_successful_sync_at, lastSuccess);
  assert.notEqual(h.sqlite.prepare("SELECT sync_status FROM sync_state WHERE source='SIME'").get()?.sync_status, "OK");
});

test("receptor SIME rechaza acceso sin autorización y lotes inválidos", async () => {
  const h = harness();
  const request = new Request(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "start" }) });
  assert.equal((await receiver.fetch(request, h.env)).status, 401);
  assert.equal(h.sqlite.prepare("SELECT count(*) AS n FROM sync_state").get()?.n, 0);
  const bad = new Request(endpoint, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` }, body: JSON.stringify({ mode: "batch", items: [{}] }) });
  assert.equal((await receiver.fetch(bad, h.env)).status, 400);
});

test("una Junta inaccesible no descarta el pedido válido de otra ni declara éxito global", async () => {
  const h = harness();
  h.setFailedJunta(true);
  await assert.rejects(h.run(), /SIME_PARTIAL_SOURCE/);
  assert.equal(h.sqlite.prepare("SELECT count(*) AS n FROM publications WHERE id='sime:9401'").get()?.n, 1);
  assert.equal(h.sqlite.prepare("SELECT sync_status FROM sync_state WHERE source='SIME'").get()?.sync_status, "PARTIAL");
  assert.equal(h.sqlite.prepare("SELECT last_successful_sync_at FROM sync_state WHERE source='SIME'").get()?.last_successful_sync_at, null);
});

test("un error D1 no confirma un lote ni elimina una publicación existente", async () => {
  const h = harness();
  await h.run();
  const initial = h.sqlite.prepare("SELECT content_hash FROM publications WHERE id='sime:9401'").get()?.content_hash;
  const failing = { ...h.env, DB: { prepare: () => { throw new Error("D1 sintética falló"); } } };
  const response = await receiver.fetch(new Request(endpoint, { method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "batch", items: [{}] }) }), failing);
  assert.equal(response.status, 400);
  const start = await receiver.fetch(new Request(endpoint, { method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "start" }) }), failing);
  assert.equal(start.status, 503);
  assert.equal(h.sqlite.prepare("SELECT content_hash FROM publications WHERE id='sime:9401'").get()?.content_hash, initial);
  assert.equal(h.sqlite.prepare("SELECT count(*) AS n FROM publications").get()?.n, 1);
});
