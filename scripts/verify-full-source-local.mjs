// Full external collector into ephemeral Miniflare D1. No remote D1 or private data.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runDirectD1Import } from "./import-direct-d1.mjs";
import { APP_PUBLICATIONS_QUERY } from "../lib/app-publications-query.ts";
import { boardItems } from "../lib/board-view.ts";
import { hasOfficialTopic } from "../lib/official-publication.ts";
import { safeJuntasFailures } from "./safe-juntas-failure.mjs";
import { JUNTA_EXTERNAL_SOURCES } from "../lib/junta-external-sources.ts";

const source = process.argv[2];
if (!["fdci", "sime", "juntas", "cenet", "infd"].includes(source)) throw new Error("SOURCE_REQUIRED");
const fdciScope = process.argv.includes("--fdci-active") ? "active" : "full";
const synthetic = process.argv.includes("--synthetic");
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
const syntheticNotice = "COMUNICADO\n26/10/2026\nACTO DE DESIGNACIÓN\nFECHA DE DESIGNACIÓN: 27/10/2026 09:00\nLUGAR: Escuela Central";
function syntheticSourceResponse(input) {
  const url = String(input);
  if (source === "fdci") {
    if (url.endsWith("getCapaActivas")) return Response.json([]);
    if (url.endsWith("getRestoCapas")) return Response.json([{ capacitacion_id: 42, nombre: "Capacitación de prueba",
      token: "synthetic", slug: "curso-prueba", niveles: "Primaria" }]);
    if (url.endsWith("getCupo")) return Response.json({ comisiones: [{ id: 6397, capacitacion_id: 42,
      fecha_apertura_preinscripcion: "2026-10-27 09:00:00", fecha_cierre_preinscripcion: "2026-10-29 18:00:00" }] });
  }
  if (source === "sime") {
    if (url.includes("ObtenerPeriodos")) return Response.json({ periodos: [{ text: "10/2026" }] });
    if (url.includes("ObtenerVacantes/1")) return Response.json({ vacantes: [{ id: 9401,
      codigo: "PDVC-20261026-9401", caracter: "SUPLENTE", fechaPublicacionInicio: "26/10/2026 08:00",
      fechaPublicacionFin: "27/10/2026 18:00", cargos: "[9000306/00] ESC. 172 - MAESTRO DE JARDIN", abierto: true }] });
    if (url.includes("ObtenerVacantes")) return Response.json({ vacantes: [] });
    if (url.includes("ObtenerVacante/9401")) return Response.json({ vacante: { descripcion: "Inscripción online por SIME" } });
  }
  if (source === "cenet") return new Response(readFileSync(new URL("../lib/fixtures/cenet-cohort-sample.html", import.meta.url), "utf8"));
  if (source === "infd") {
    if (url.endsWith("/cursos-nacionales-2/")) return new Response(`<h1>Cursos nacionales 2026</h1><p>Fecha de inscripción: 20 de octubre al 30 de octubre</p><a href="https://red.infd.edu.ar/curso-docente/">Curso</a>`);
    if (url.endsWith("/curso-docente/")) return new Response(`<h1>Cursos nacionales 2026</h1><p>Fecha de inscripción: 20 de octubre al 30 de octubre</p><p style="font-size:30px"><strong>Alfabetización temprana</strong></p><p>Destinatarios: Docentes. Modalidad: Virtual.</p>`);
  }
  if (source === "juntas") {
    if (url.includes("docs.google.com/document/") && url.includes("/export?format=txt")) return new Response(syntheticNotice);
    if (url.includes("googleapis.com/drive/v3/files")) {
      const folder = new URL(url).searchParams.get("q")?.match(/'([^']+)'/)?.[1];
      const root = JUNTA_EXTERNAL_SOURCES.find((entry) => entry[3].includes(`/folders/${folder}`));
      if (root) return Response.json({ files: [{ id: `synthetic_${root[0].replaceAll("-", "_")}`,
        name: `Documento de prueba ${root[0]}`, mimeType: root[0] === "pad-primaria"
          ? "application/vnd.google-apps.document" : "application/pdf", modifiedTime: "2026-10-26T09:00:00Z" }] });
    }
  }
  throw new Error("SYNTHETIC_SOURCE_URL_UNEXPECTED");
}
async function sourceFetch(input, init) {
  if (synthetic) { sourceRequests++; return syntheticSourceResponse(input); }
  const key = `${String(input)}|${init?.method || "GET"}|${init?.body || ""}`;
  if (captured.has(key)) {
    const row = captured.get(key);
    return new Response(row.body, { status: row.status, headers: row.headers });
  }
  if (source === "fdci" && sourceRequests >= 275) throw new Error("FDCI_PROBE_REQUEST_LIMIT");
  if (source === "fdci" && String(input).endsWith("/capa/getCupo")) {
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
  if (source === "juntas") {
    const migration = readFileSync(new URL("../migrations/0026_juntas_incremental.sql", import.meta.url), "utf8")
      .split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
    for (const statement of migration.split(";").map((part) => part.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
  const started = new Date().toISOString(), firstDb = meter(db), requestsBefore = sourceRequests;
  let first, error = null, partial = null;
  try { first = await runDirectD1Import({ source, db: firstDb, sourceFetch,
    scope: source === "fdci" ? fdciScope : source === "juntas" ? "checkpoint" : "single",
    driveKey: synthetic ? "synthetic_drive_key_1234567890" : process.env.GOOGLE_DRIVE_API_KEY,
    juntaMaxRequests: synthetic ? 25 : undefined, juntaMaxPublicationWrites: synthetic ? 20 : undefined }); }
  catch (failure) {
    error = failure instanceof Error ? failure.message.replace(/https?:\/\/\S+/g, "[url]") : "UNKNOWN";
    if (error === "FDCI_PARTIAL_SOURCE") partial = { failures: failure.failures,
      diagnostics: failure.diagnostics, ...failure.result };
    if (error === "JUNTAS_PARTIAL_SOURCE") partial = { failures: safeJuntasFailures(failure.failures) };
  }
  const firstMetrics = firstDb.metrics(), requests = sourceRequests - requestsBefore;
  let repeat = null, repeatMetrics = null, repeatError = null;
  // A partial Juntas checkpoint has more folders to discover; a second run is
  // continuation, not an idempotence check. Never trigger it implicitly online.
  if ((!error || error === "FDCI_PARTIAL_SOURCE") &&
      (source !== "juntas" || synthetic || first?.completed)) {
    const secondDb = meter(db);
    try {
      repeat = await runDirectD1Import({ source, db: secondDb, sourceFetch,
        scope: source === "fdci" ? fdciScope : source === "juntas" ? "checkpoint" : "single",
        driveKey: synthetic ? "synthetic_drive_key_1234567890" : process.env.GOOGLE_DRIVE_API_KEY,
        juntaMaxRequests: synthetic ? 25 : undefined, juntaMaxPublicationWrites: synthetic ? 20 : undefined });
    } catch (failure) {
      repeatError = failure instanceof Error ? failure.message : "UNKNOWN";
      if (partial) {
        assert.equal(repeatError, "FDCI_PARTIAL_SOURCE");
        repeat = failure.result;
      } else throw failure;
    }
    repeatMetrics = secondDb.metrics();
    assert.equal(repeat.created, 0, "Repeated complete capture must not create duplicates");
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
  const health = source === "juntas"
    ? (await db.prepare("SELECT source,sync_status,last_attempt_at,last_successful_sync_at,error_code FROM sync_state WHERE source IN ('Padrones','Comunicados','Llamados abiertos') ORDER BY source").all()).results
    : await db.prepare("SELECT sync_status,last_attempt_at,last_successful_sync_at,error_code FROM sync_state WHERE source=?")
      .bind(storageSource).first();
  const sectionVisible = source === "juntas" ? { comunicados: boardItems(visible, "comunicados").length,
    actos: boardItems(visible, "actos").length, llamados: boardItems(visible, "llamados").length }
    : source === "sime" ? { designaciones: visible.filter((row) => row.source === "SIME" &&
      (hasOfficialTopic(row, "INSCRIPCION_SIME") || hasOfficialTopic(row, "CLASIFICACION_PENDIENTE"))).length }
    : { capacitaciones: visible.filter((row) => row.kind === "capacitacion" && row.source === storageSource).length };
  console.log(JSON.stringify({ source, database: "ephemeral Workerd D1", synthetic, started, finished: new Date().toISOString(),
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
