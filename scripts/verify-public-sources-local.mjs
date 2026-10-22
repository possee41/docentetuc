// Synthetic Node -> independent receiver -> ephemeral Miniflare D1 -> public app query.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runPublicSourceImport } from "./import-public-sources.mjs";
import receiver from "../workers/public-source-receiver.mjs";
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
  const secret = randomBytes(32).toString("hex");
  const env = { DB: db, JUNTAS_IMPORT_SECRET: secret, CENET_IMPORT_SECRET: secret, INFD_IMPORT_SECRET: secret };
  const receiverFetch = (input, init) => receiver.fetch(new Request(input, init), env);
  const cenetHtml = readFileSync(new URL("../lib/fixtures/cenet-cohort-sample.html", import.meta.url), "utf8");
  const sourceFetch = async (input) => {
    const url = String(input);
    if (url.includes("/export?format=txt")) return new Response("COMUNICADO\n22/10/2026\nACTO DE DESIGNACIÓN\nFECHA DE DESIGNACIÓN: 26/10/2026 09:00\nLUGAR: Escuela Central");
    if (url.includes("cenet.inet.edu.ar")) return new Response(cenetHtml);
    if (url.endsWith("/cursos-nacionales-2/")) return new Response('<h1>Cursos nacionales 2026</h1><p>Fecha de inscripción: 20 de octubre al 30 de octubre</p><a href="https://red.infd.edu.ar/curso-docente/">Curso</a>');
    if (url.endsWith("/curso-docente/")) return new Response('<h1>Cursos nacionales 2026</h1><p>Fecha de inscripción: 20 de octubre al 30 de octubre</p><p style="font-size:30px"><strong>Alfabetización temprana</strong></p><p>Destinatarios: Docentes.</p>');
    throw new Error("UNEXPECTED_SOURCE_URL");
  };
  const summaries = {};
  for (const source of ["juntas", "cenet", "infd"]) {
    const options = { source, endpoint: `https://local.test/api/internal/public-source-import/${source}`, token: secret,
      sourceFetch, receiverFetch, now: new Date("2026-10-22T15:00:00Z"),
      ...(source === "juntas" ? { juntaSources: [["com-test", "Comunicados", "Inicial y Primaria", "https://docs.google.com/document/d/123456789012345678901234567890/edit"]] } : {}) };
    const first = await runPublicSourceImport(options), repeat = await runPublicSourceImport(options);
    assert.ok(first.created > 0);
    assert.equal(repeat.rowsWritten, 0);
    summaries[source] = { first, repeat };
  }
  const publicRows = await db.prepare(APP_PUBLICATIONS_QUERY).all();
  for (const prefix of ["notice:", "cenet:", "infd:"]) assert.ok(publicRows.results.some((row) => row.id.startsWith(prefix)));
  console.log(JSON.stringify({ database: "D1 efímera de Miniflare", sourceData: "sintéticos", ...summaries,
    visiblePublicIds: publicRows.results.map((row) => row.id), health: (await db.prepare("SELECT source,sync_status,last_successful_sync_at FROM sync_state ORDER BY source").all()).results }, null, 2));
} finally { await mf.dispose(); }
