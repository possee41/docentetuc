// D1 efímera: ninguna credencial, fuente oficial ni base persistente.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { Miniflare } = require("../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare");
const query = readFileSync(new URL("../lib/app-publications-query.ts", import.meta.url), "utf8")
  .match(/export const APP_PUBLICATIONS_QUERY = `([\s\S]*?)`;/)?.[1];
if (!query) throw new Error("Falta la consulta pública");

const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('local'); } }", d1Databases: ["DB"] });
try {
  const db = await mf.getD1Database("DB");
  await db.prepare(`CREATE TABLE publications (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, source TEXT, title TEXT, summary TEXT, official_url TEXT,
    metadata TEXT, starts_at TEXT, ends_at TEXT, updated_at TEXT, source_published_at TEXT,
    registration_open_at TEXT, registration_close_at TEXT, normalized_status TEXT, removed_at TEXT)`).run();
  await db.prepare("CREATE TABLE sync_state (source TEXT PRIMARY KEY, synced_at TEXT, last_attempt_at TEXT, last_successful_sync_at TEXT, sync_status TEXT)").run();
  for (let start = 0; start < 7200; start += 900) {
    await db.prepare(`WITH RECURSIVE n(i) AS (SELECT ? UNION ALL SELECT i+1 FROM n WHERE i<?)
      INSERT INTO publications
      SELECT 'synthetic:' || i,
        CASE WHEN i<3000 THEN 'capacitacion' WHEN i<4800 THEN 'informacion' WHEN i<6200 THEN 'vacante' ELSE 'junta' END,
        CASE WHEN i<3000 THEN 'FDCI' WHEN i<4800 THEN 'Ministerio' WHEN i<6200 THEN 'SIME' ELSE 'Juntas' END,
        'Publicación educativa de prueba ' || i, printf('%0160d',i), 'https://example.invalid/publicacion/' || i,
        CASE WHEN i>=6200 THEN '{"official":{"entity":"document"}}' ELSE '{}' END,
        NULL, CASE WHEN i%25=0 THEN datetime('now','+30 days') ELSE datetime('now','-' || (i%720) || ' days') END,
        datetime('now','-' || (i%720) || ' days'), NULL, NULL, NULL, 'UNKNOWN', NULL FROM n`).bind(start, start + 899).run();
  }
  await db.prepare("INSERT INTO sync_state (source,sync_status) VALUES ('FDCI','OK'),('SIME','OK'),('CeNET','OK'),('INFoD','OK'),('Juntas','PARTIAL'),('Actos','OK'),('Llamados','OK')").run();
  const publications = await db.prepare(query).all();
  const sync = await db.prepare("SELECT source, synced_at, last_attempt_at, last_successful_sync_at, sync_status FROM sync_state ORDER BY source").all();
  const response = { profile: null, publicProfile: null, publications: publications.results, saved: [], notifications: [], reminders: [], designations: [], manualEvents: [], sync: sync.results };
  console.log(JSON.stringify({ database: "D1 efímera", syntheticPublications: 7200,
    returnedPublications: publications.results.length,
    responseBytes: Buffer.byteLength(JSON.stringify(response)),
    queries: 2, rowsRead: Number(publications.meta.rows_read || 0) + Number(sync.meta.rows_read || 0),
    rowsWritten: Number(publications.meta.rows_written || 0) + Number(sync.meta.rows_written || 0) }, null, 2));
} finally { await mf.dispose(); }
