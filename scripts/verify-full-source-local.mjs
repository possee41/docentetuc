// Full external collector into ephemeral Miniflare D1. No remote D1 or private data.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runDirectD1Import } from "./import-direct-d1.mjs";
import { APP_PUBLICATIONS_QUERY } from "../lib/app-publications-query.ts";
import { boardItems } from "../lib/board-view.ts";
import { hasOfficialTopic } from "../lib/official-publication.ts";

const source = process.argv[2];
if (!["fdci", "sime", "juntas", "cenet", "infd"].includes(source)) throw new Error("SOURCE_REQUIRED");
const fdciScope = process.argv.includes("--fdci-active") ? "active" : "full";
const require = createRequire(import.meta.url);
const { Miniflare } = require("../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare");
const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('isolated'); } }", d1Databases: ["DB"] });
const storageSource = { fdci: "Capacitación Docente", sime: "SIME", juntas: "Padrones y Comunicados",
  cenet: "CeNET / INET", infd: "INFoD / AulaS-TIC" }[source];

function meter(db) {
  const metrics = { queries: 0, rowsRead: 0, rowsWritten: 0, errors: 0 };
  const record = (result) => {
    metrics.queries++;
    metrics.rowsRead += Number(result.meta?.rows_read || 0);
    metrics.rowsWritten += Number(result.meta?.rows_written || 0);
    return result;
  };
  const measure = async (promise) => { try { return record(await promise); } catch (error) { metrics.errors++; throw error; } };
  return { metrics: () => ({ ...metrics }), prepare(sql) { return { bind(...values) {
    const raw = db.prepare(sql).bind(...values);
    return { raw, all: () => measure(raw.all()), run: () => measure(raw.run()),
      first: async () => (await measure(raw.all())).results[0] || null };
  } }; }, async batch(statements) {
    try { return (await db.batch(statements.map((entry) => entry.raw))).map(record); }
    catch (error) { metrics.errors++; throw error; }
  } };
}

const captured = new Map();
let sourceRequests = 0;
let lastFdciDetailAt = 0;
async function sourceFetch(input, init) {
  const key = `${String(input)}|${init?.method || "GET"}|${init?.body || ""}`;
  if (captured.has(key)) {
    const row = captured.get(key);
    return new Response(row.body, { status: row.status, headers: row.headers });
  }
  if (source === "fdci" && String(input).endsWith("/capa/getCupo")) {
    if (sourceRequests >= 275) throw new Error("FDCI_PROBE_REQUEST_LIMIT");
    const pauseMs = Math.max(0, 400 - (Date.now() - lastFdciDetailAt));
    if (pauseMs) await new Promise((resolve) => setTimeout(resolve, pauseMs));
    lastFdciDetailAt = Date.now();
  }
  sourceRequests++;
  const response = await fetch(input, { ...init, signal: AbortSignal.timeout(20_000) });
  const body = await response.arrayBuffer();
  if (body.byteLength > 2_000_000) throw new Error("SOURCE_RESPONSE_TOO_LARGE");
  captured.set(key, { body, status: response.status, headers: response.headers });
  return new Response(body, { status: response.status, headers: response.headers });
}

try {
  const db = await mf.getD1Database("DB");
  const schema = `CREATE TABLE publications (
    id TEXT PRIMARY KEY,source TEXT NOT NULL,external_id TEXT NOT NULL,kind TEXT NOT NULL,category TEXT NOT NULL,
    title TEXT NOT NULL,summary TEXT NOT NULL DEFAULT '',level TEXT NOT NULL DEFAULT '',area TEXT NOT NULL DEFAULT '',
    junta TEXT NOT NULL DEFAULT '',location TEXT NOT NULL DEFAULT '',shift TEXT NOT NULL DEFAULT '',character TEXT NOT NULL DEFAULT '',
    circuit TEXT NOT NULL DEFAULT 'UNKNOWN',source_circuit_raw TEXT NOT NULL DEFAULT '',
    circuit_inference_source TEXT NOT NULL DEFAULT 'unknown',circuit_confidence INTEGER NOT NULL DEFAULT 0,
    starts_at TEXT,ends_at TEXT,status TEXT NOT NULL,official_url TEXT NOT NULL,metadata TEXT NOT NULL,content_hash TEXT NOT NULL,
    source_updated_at TEXT,source_published_at TEXT,registration_open_at TEXT,registration_close_at TEXT,expires_at TEXT,
    source_status TEXT NOT NULL DEFAULT 'UNKNOWN',normalized_status TEXT NOT NULL DEFAULT 'UNKNOWN',removed_at TEXT,
    last_seen_at TEXT NOT NULL DEFAULT '',last_changed_at TEXT NOT NULL DEFAULT '',first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE sync_state(source TEXT PRIMARY KEY,synced_at TEXT NOT NULL DEFAULT '',item_count INTEGER NOT NULL DEFAULT 0,
      error TEXT,last_attempt_at TEXT,last_successful_sync_at TEXT,sync_status TEXT NOT NULL DEFAULT 'UNKNOWN',
      error_code TEXT,error_message TEXT);`;
  for (const statement of schema.split(";").map((part) => part.replace(/\s+/g, " ").trim()).filter(Boolean))
    await db.prepare(statement).run();
  const started = new Date().toISOString(), firstDb = meter(db), requestsBefore = sourceRequests;
  let first, error = null, partial = null;
  try { first = await runDirectD1Import({ source, db: firstDb, sourceFetch, scope: source === "fdci" ? fdciScope : "single",
    driveKey: process.env.GOOGLE_DRIVE_API_KEY }); }
  catch (failure) {
    error = failure instanceof Error ? failure.message.replace(/https?:\/\/\S+/g, "[url]") : "UNKNOWN";
    if (error === "FDCI_PARTIAL_SOURCE") partial = { failures: failure.failures,
      diagnostics: failure.diagnostics, ...failure.result };
  }
  const firstMetrics = firstDb.metrics(), requests = sourceRequests - requestsBefore;
  let repeat = null, repeatMetrics = null, repeatError = null;
  if (!error || partial) {
    const secondDb = meter(db);
    try {
      repeat = await runDirectD1Import({ source, db: secondDb, sourceFetch, scope: source === "fdci" ? fdciScope : "single",
        driveKey: process.env.GOOGLE_DRIVE_API_KEY });
    } catch (failure) {
      repeatError = failure instanceof Error ? failure.message : "UNKNOWN";
      if (partial) {
        assert.equal(repeatError, "FDCI_PARTIAL_SOURCE");
        repeat = failure.result;
      } else throw failure;
    }
    repeatMetrics = secondDb.metrics();
    assert.equal(repeat.created, 0, "Repeated official capture must not create duplicates");
    if (source !== "sime") assert.equal(repeat.updated, 0, "Unchanged official capture must not rewrite publications");
  }
  const rows = (await db.prepare(`SELECT id,kind,category,title,status,official_url,registration_open_at,registration_close_at,
    normalized_status,metadata FROM publications WHERE source=? ORDER BY id`).bind(storageSource).all()).results;
  const visible = (await db.prepare(APP_PUBLICATIONS_QUERY).all()).results;
  const now = Date.now();
  const openConfirmed = rows.filter((row) => row.normalized_status === "ACTIVE" && row.registration_open_at && row.registration_close_at &&
    Date.parse(row.registration_open_at) <= now && Date.parse(row.registration_close_at) > now).length;
  const count = (status) => rows.filter((row) => row.normalized_status === status).length;
  const categories = Object.fromEntries([...new Set(rows.map((row) => row.category))].sort().map((category) =>
    [category, rows.filter((row) => row.category === category).length]));
  const health = await db.prepare("SELECT sync_status,last_attempt_at,last_successful_sync_at,error_code FROM sync_state WHERE source=?")
    .bind(storageSource).first();
  const sectionVisible = source === "juntas" ? { comunicados: boardItems(visible, "comunicados").length,
    actos: boardItems(visible, "actos").length, llamados: boardItems(visible, "llamados").length }
    : source === "sime" ? { designaciones: visible.filter((row) => row.source === "SIME" &&
      (hasOfficialTopic(row, "INSCRIPCION_SIME") || hasOfficialTopic(row, "CLASIFICACION_PENDIENTE"))).length }
    : { capacitaciones: visible.filter((row) => row.kind === "capacitacion" && row.source === storageSource).length };
  console.log(JSON.stringify({ source, database: "ephemeral Workerd D1", started, finished: new Date().toISOString(),
    sourceRequests: requests, records: rows.length, visible: rows.filter((row) => visible.some((entry) => entry.id === row.id)).length,
    sectionVisible,
    openConfirmed, active: count("ACTIVE"), upcoming: count("UPCOMING"), closed: count("CLOSED") + count("EXPIRED"),
    unknown: count("UNKNOWN"), categories, first: first ? { discovered: first.discovered, created: first.created,
      updated: first.updated, unchanged: first.unchanged } : null, firstMetrics,
    repeat: repeat ? { discovered: repeat.discovered, created: repeat.created,
      updated: repeat.updated, unchanged: repeat.unchanged } : null, repeatMetrics, repeatError, partial, health, error,
    sample: rows.slice(0, 2).map((row) => ({ title: row.title, url: row.official_url,
      open: row.registration_open_at, close: row.registration_close_at, status: row.normalized_status })) }));
  if (error) process.exitCode = 1;
} finally { await mf.dispose(); }
