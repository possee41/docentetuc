// Ephemeral local D1 only. Measures the two public queries removed from /api/app.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { Miniflare } = require("../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare");
const query = readFileSync(new URL("../lib/app-publications-query.ts", import.meta.url), "utf8")
  .match(/export const APP_PUBLICATIONS_QUERY = `([\s\S]*?)`;/)?.[1];
if (!query) throw new Error("No se pudo leer la consulta pública");

const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('local'); } }", d1Databases: ["DB"] });
try {
  const db = await mf.getD1Database("DB");
  await db.exec("CREATE TABLE publications (id TEXT PRIMARY KEY, kind TEXT NOT NULL, metadata TEXT, starts_at TEXT, ends_at TEXT, updated_at TEXT); CREATE TABLE sync_state (source TEXT PRIMARY KEY, synced_at TEXT, last_attempt_at TEXT, last_successful_sync_at TEXT, sync_status TEXT);");
  for (let start = 0; start < 7200; start += 900) {
    await db.prepare(`WITH RECURSIVE n(i) AS (SELECT CAST(? AS INTEGER) UNION ALL SELECT i+1 FROM n WHERE i<CAST(? AS INTEGER))
      INSERT INTO publications (id, kind, metadata, updated_at)
      SELECT 'synthetic:' || i, 'capacitacion', '{}', '2026-10-20' FROM n`).bind(start, start + 899).run();
  }
  await db.prepare("INSERT INTO sync_state (source, sync_status) VALUES ('FDCI','OK'),('SIME','OK'),('CeNET','OK'),('INFoD','OK'),('Juntas','OK'),('Actos','OK'),('Llamados','OK')").run();
  const publications = await db.prepare(query).all();
  const sync = await db.prepare("SELECT source, synced_at, last_attempt_at, last_successful_sync_at, sync_status FROM sync_state ORDER BY source").all();
  const rowsRead = Number(publications.meta.rows_read || 0) + Number(sync.meta.rows_read || 0);
  console.log(JSON.stringify({ database: "Miniflare D1 efímera", syntheticPublications: 7200,
    removedFromPrivateRequest: { queries: 2, rowsRead, returnedPublications: publications.results.length, rowsWritten: 0 },
    publicRequestUnchanged: { queries: 2, rowsRead, rowsWritten: 0 } }, null, 2));
} finally { await mf.dispose(); }
