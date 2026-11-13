import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import receiver from "../workers/sime-receiver.mjs";
import { runSimeImport } from "../scripts/import-sime.mjs";
import { APP_PUBLICATIONS_QUERY } from "./app-publications-query.ts";
import { officialMetadata } from "./official-publication.ts";
import { normalizeSimeVacancy, applySimeDetail } from "./sime-publications.ts";
import { prepareSimeImport } from "./sime-import.ts";

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
  await h.run(); // Preserve a confirmed row; a failed collection must not write a partial batch.
  const lastSuccess = h.sqlite.prepare("SELECT last_successful_sync_at FROM sync_state WHERE source='SIME'").get()?.last_successful_sync_at;
  h.setFailedJunta(true);
  await assert.rejects(h.run(), /SIME_PARTIAL_SOURCE/);
  assert.equal(h.sqlite.prepare("SELECT count(*) AS n FROM publications WHERE id='sime:9401'").get()?.n, 1);
  assert.equal(h.sqlite.prepare("SELECT sync_status FROM sync_state WHERE source='SIME'").get()?.sync_status, "PARTIAL");
  assert.equal(h.sqlite.prepare("SELECT last_successful_sync_at FROM sync_state WHERE source='SIME'").get()?.last_successful_sync_at, lastSuccess);
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

const publicFixture = JSON.parse(readFileSync(new URL("../scripts/fixtures/sime-secundaria-144389.json", import.meta.url), "utf8"));
const fixtureNow = new Date(publicFixture.provenance.observedAt);
async function secundariaRow() {
  let item = normalizeSimeVacancy(publicFixture.vacancy, "Secundaria", 2, undefined, fixtureNow);
  applySimeDetail(item, publicFixture.detail, fixtureNow.toISOString());
  item = normalizeSimeVacancy(publicFixture.vacancy, "Secundaria", 2, item.metadata, fixtureNow);
  return prepareSimeImport(item, fixtureNow);
}
const batchRequest = (items: unknown[]) => new Request(endpoint, { method: "POST",
  headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify({ mode: "batch", items }) });

test("Secundaria 144389: reproduce HTTP 400 de metadata 16K; conserva íntegro el registro con 32K", async () => {
  const row = await secundariaRow(), { sqlite, db } = localD1(), env = { DB: db, SIME_IMPORT_SECRET: secret };
  assert.equal(row.id, "sime:144389");
  assert.equal(normalizeSimeVacancy(publicFixture.vacancy, "Secundaria", 2, undefined, fixtureNow).metadata?.length, 14312);
  assert.equal(row.metadata.length, 22837);
  assert.equal(row.summary.length, 4169);
  assert.ok(Buffer.byteLength(JSON.stringify({ mode: "batch", items: [row] })) < 100_000);
  // Controlled counterfactual: same handler and payload, only the old field ceiling.
  const source = readFileSync(new URL("../workers/sime-receiver.mjs", import.meta.url), "utf8");
  assert.ok(source.includes("metadata: 32000"));
  const legacy = (await import("data:text/javascript;base64," + Buffer.from(source.replace("metadata: 32000", "metadata: 16000")).toString("base64"))).default;
  assert.equal((await legacy.fetch(batchRequest([row]), env)).status, 400);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM publications").get()?.n, 0);
  const response = await receiver.fetch(batchRequest([row]), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).created, 1);
  const replay = await receiver.fetch(batchRequest([row]), env);
  const ack = await replay.json();
  assert.deepEqual([ack.created, ack.updated, ack.unchanged, ack.rowsWritten], [0, 0, 1, 0]);
  const saved = sqlite.prepare("SELECT metadata,summary,content_hash,official_url,junta,registration_open_at,registration_close_at FROM publications WHERE id=?").get(row.id);
  assert.deepEqual(saved && { ...saved }, { metadata: row.metadata, summary: row.summary, content_hash: row.contentHash,
    official_url: row.officialUrl, junta: row.junta, registration_open_at: row.registrationOpenAt, registration_close_at: row.registrationCloseAt });
});

test("metadata 32K sigue acotada; campos, URL, fechas y hash inválidos no escriben", async () => {
  const row = await secundariaRow(), { sqlite, db } = localD1(), env = { DB: db, SIME_IMPORT_SECRET: secret };
  const invalid = [
    { metadata: row.metadata.padEnd(32001, " ") }, { metadata: "{" }, { metadata: "{}" },
    { summary: "x".repeat(8001) }, { junta: "x".repeat(301) }, { title: "x".repeat(501) },
    { summary: "texto\u0000inválido" }, { registrationOpenAt: "invalid" }, { startsAt: undefined },
    { officialUrl: "https://example.com/" }, { officialUrl: "http://sime.educaciontuc.gov.ar/" },
    { contentHash: "a".repeat(63) }, { externalId: "otro" },
  ];
  for (const patch of invalid) assert.equal((await receiver.fetch(batchRequest([{ ...row, ...patch }]), env)).status, 400, JSON.stringify(Object.keys(patch)));
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM publications").get()?.n, 0);
  const padded = { ...row, metadata: row.metadata.padEnd(32000, " ") };
  assert.equal((await receiver.fetch(batchRequest([padded]), env)).status, 200);
  const large = [0, 1, 2, 3].map(n => ({ ...padded, id: `sime:${90000+n}`, externalId: String(90000+n) }));
  assert.ok(Buffer.byteLength(JSON.stringify({ mode: "batch", items: large })) > 100_000);
  assert.equal((await receiver.fetch(batchRequest(large), env)).status, 413);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM publications").get()?.n, 1);
});

test("doce altas previas se repiten sin duplicarse y Secundaria puede avanzar con un recorrido nuevo", async () => {
  const row = await secundariaRow(), { sqlite, db } = localD1(), env = { DB: db, SIME_IMPORT_SECRET: secret };
  const existing = Array.from({ length: 12 }, (_, n) => ({ ...vacancy, id: 144476+n }));
  const boards = [existing, [publicFixture.vacancy], [], []];
  const sourceFetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const board = Number(url.pathname.match(/Obtener(?:Periodos|Vacantes)\/(\d)/)?.[1]);
    if (url.pathname.includes("ObtenerPeriodos/")) return Response.json({ periodos: [{ text: "11/2026" }] });
    if (url.pathname.includes("ObtenerVacantes/")) return Response.json({ vacantes: boards[board-1] });
    if (url.pathname.includes("ObtenerVacante/")) return Response.json({ vacante: url.pathname.endsWith("/144389") ? publicFixture.detail : { descripcion: "Fixture local de idempotencia" } });
    throw Error("REMOTE_NETWORK_FORBIDDEN");
  }) as typeof fetch;
  const receiverFetch = (async (input: RequestInfo | URL, init?: RequestInit) => receiver.fetch(new Request(input, init), env)) as typeof fetch;
  const options = { endpoint, token: secret, sourceFetch, receiverFetch, now: fixtureNow, limit: 50 };
  const seed = await runSimeImport({ ...options, juntas: [1] });
  assert.equal(seed.created, 12);
  const next = await runSimeImport({ ...options, juntas: [1,2,3,4], resumeAfter: "" });
  assert.deepEqual(next.processedByJunta, { 1: 12, 2: 1, 3: 0, 4: 0 });
  assert.deepEqual([next.created, next.updated, next.unchanged], [1, 3, 9]);
  // Three previously pending details legitimately refresh; identities stay unchanged.
  assert.equal(JSON.parse(next.nextResumeAfter).after[2], row.id);
  const repeat = await runSimeImport({ ...options, juntas: [1,2,3,4], resumeAfter: "" });
  assert.equal(repeat.created, 0);
  assert.equal(repeat.updated + repeat.unchanged, 13);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM publications").get()?.n, 13);
  assert.equal(sqlite.prepare("SELECT count(DISTINCT external_id) AS n FROM publications").get()?.n, 13);
});
