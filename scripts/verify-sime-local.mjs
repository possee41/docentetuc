// SIME synthetic source -> Node runner -> independent receiver -> ephemeral Miniflare D1 -> app public query.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { runSimeImport } from "./import-sime.mjs";
import receiver from "../workers/sime-receiver.mjs";
import { APP_PUBLICATIONS_QUERY } from "../lib/app-publications-query.ts";

const require = createRequire(import.meta.url);
const { Miniflare } = require("../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare");
const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('local'); } }", d1Databases: ["DB"] });
try {
  const db = await mf.getD1Database("DB");
  await db.prepare(`CREATE TABLE publications (
    id TEXT PRIMARY KEY,source TEXT NOT NULL,external_id TEXT NOT NULL,kind TEXT NOT NULL,category TEXT NOT NULL,
    title TEXT NOT NULL,summary TEXT NOT NULL DEFAULT '',level TEXT NOT NULL DEFAULT '',area TEXT NOT NULL DEFAULT '',
    junta TEXT NOT NULL DEFAULT '',location TEXT NOT NULL DEFAULT '',shift TEXT NOT NULL DEFAULT '',character TEXT NOT NULL DEFAULT '',
    starts_at TEXT,ends_at TEXT,status TEXT NOT NULL,official_url TEXT NOT NULL,metadata TEXT NOT NULL,content_hash TEXT NOT NULL,
    source_updated_at TEXT,source_published_at TEXT,registration_open_at TEXT,registration_close_at TEXT,expires_at TEXT,
    source_status TEXT NOT NULL DEFAULT 'UNKNOWN',normalized_status TEXT NOT NULL DEFAULT 'UNKNOWN',removed_at TEXT,
    last_seen_at TEXT NOT NULL DEFAULT '',last_changed_at TEXT NOT NULL DEFAULT '',first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
  await db.prepare(`CREATE TABLE sync_state(source TEXT PRIMARY KEY,synced_at TEXT NOT NULL,item_count INTEGER NOT NULL DEFAULT 0,error TEXT,
    last_attempt_at TEXT,last_successful_sync_at TEXT,sync_status TEXT NOT NULL DEFAULT 'UNKNOWN',error_code TEXT,error_message TEXT)`).run();
  await db.prepare("INSERT INTO publications(id,source,external_id,kind,category,title,status,official_url,metadata,content_hash) VALUES('sime:9000','SIME','9000','vacante','Histórica','Pedido histórico','cerrada','https://sime.educaciontuc.gov.ar/','{}','old')").run();
  const secret = randomBytes(32).toString("hex"), endpoint = "https://sime-receiver.local/api/internal/sime-import";
  const sourceFetch = async (input) => {
    const url = String(input);
    if (url.includes("ObtenerPeriodos")) return Response.json({ periodos: [{ text: "10/2026" }] });
    if (url.includes("ObtenerVacantes/1")) return Response.json({ vacantes: [{ id: 9401, codigo: "PDVC-20261022-9401", caracter: "SUPLENTE",
      fechaPublicacionInicio: "22/10/2026 08:00", fechaPublicacionFin: "23/10/2026 18:00",
      cargos: "[9000306/00] ESC. 172 - MAESTRO DE JARDIN", abierto: true }] });
    if (url.includes("ObtenerVacantes")) return Response.json({ vacantes: [] });
    if (url.includes("ObtenerVacante/9401")) return Response.json({ vacante: { descripcion: "Inscripción online por SIME", fechaDesignacion: "24/10/2026" } });
    throw new Error("URL inesperada");
  };
  const receiverFetch = (input, init) => receiver.fetch(new Request(input, init), { DB: db, SIME_IMPORT_SECRET: secret });
  const options = { endpoint, token: secret, sourceFetch, receiverFetch, now: new Date("2026-10-22T15:00:00Z") };
  const first = await runSimeImport(options), repeat = await runSimeImport(options);
  const publicRows = await db.prepare(APP_PUBLICATIONS_QUERY).all();
  const row = publicRows.results.find((item) => item.id === "sime:9401");
  assert.ok(row);
  assert.equal(row.ends_at, "2026-10-23T18:00:00-03:00");
  assert.equal(first.created, 1);
  assert.equal(repeat.unchanged, 1);
  assert.equal(repeat.rowsWritten, 0);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM publications").first()).n, 2);
  console.log(JSON.stringify({ database: "Miniflare D1 efímera", source: "SIME sintética", first, repeat,
    visibleInPublicAppQuery: Boolean(row), registrationOpenAt: row.registration_open_at,
    registrationCloseAt: row.registration_close_at,
    sync: await db.prepare("SELECT sync_status,last_attempt_at,last_successful_sync_at FROM sync_state WHERE source='SIME'").first() }, null, 2));
} finally { await mf.dispose(); }
