// D1 efímera; 7.200 oportunidades sintéticas, sin credenciales ni fuentes oficiales.
import { createRequire } from "node:module";
import { personalizedCatalogPage, PERSONAL_SCAN_SIZE } from "../lib/personalized-catalog.ts";

const require = createRequire(import.meta.url);
const { Miniflare } = require("../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare");
const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('local'); } }", d1Databases: ["DB"] });
const profile = { user_id: "test", levels: ["Secundario"], areas: ["Matemática"], subjects: ["Matemática"], boards: ["Secundario"],
  roles: ["Profesor de Matemática"], department: "", locality: "", shifts: [], characters: [], circuits: [], training_interests: ["Matemática"], personal_match_threshold: 85 };
const official = JSON.stringify({ official: { version: 1, entity: "opportunity", topics: ["INSCRIPCION_SIME"], sources: [], scope: {},
  facts: { publicationStart: { value: "2026-10-20T09:00:00-03:00", precision: "datetime" }, publicationEnd: { value: "2026-11-05T18:00:00-03:00", precision: "datetime" } }, abierto: true } });
const training = JSON.stringify({ entity: "commission", trainingId: "test", registrationOpensAt: "2026-10-20T09:00:00-03:00",
  registrationClosesAt: "2026-11-05T18:00:00-03:00", dateStatus: "confirmed", registrationHasTime: true });
try {
  const db = await mf.getD1Database("DB");
  await db.prepare(`CREATE TABLE publications(id TEXT PRIMARY KEY,kind TEXT,source TEXT,title TEXT,summary TEXT,level TEXT,area TEXT,junta TEXT,location TEXT,shift TEXT,character TEXT,metadata TEXT,status TEXT,normalized_status TEXT,starts_at TEXT,ends_at TEXT,official_url TEXT,updated_at TEXT)`).run();
  await db.prepare("CREATE TABLE profiles(user_id TEXT PRIMARY KEY)").run();
  await db.prepare("INSERT INTO profiles VALUES ('test')").run();
  await db.prepare("CREATE INDEX idx_publications_kind_id ON publications(kind,id)").run();
  for (let start = 0; start < 7200; start += 900) {
    await db.prepare(`WITH RECURSIVE n(i) AS (SELECT ? UNION ALL SELECT i+1 FROM n WHERE i<?)
      INSERT INTO publications SELECT 'p:' || printf('%04d',i), CASE WHEN i<3600 THEN 'vacante' ELSE 'capacitacion' END,
        CASE WHEN i<3600 THEN 'SIME' ELSE 'FDCI' END,
        CASE WHEN i<3600 THEN 'Escuela X - Profesor de Matemática' ELSE 'Matemática docente' END,
        'Prueba aislada', 'Secundario', 'Historia', 'Secundario', '', '', '', '{}', 'inscripción abierta', 'ACTIVE',
        '2026-10-20T09:00:00-03:00', '2026-11-05T18:00:00-03:00', 'https://example.invalid/test', '2026-10-26' FROM n`).bind(start, start + 899).run();
  }
  for (const index of [500, 3500, 4000, 7199]) await db.prepare("UPDATE publications SET area='Matemática',metadata=? WHERE id=?")
    .bind(index < 3600 ? official : training, `p:${String(index).padStart(4, "0")}`).run();
  const metrics = { database: "D1 efímera", syntheticPublications: 7200, scanSize: PERSONAL_SCAN_SIZE,
    calls: 0, queries: 0, scanned: 0, matchedIds: [], rowsRead: 0, rowsWritten: 0, responseBytes: 0, maxRowsReadPerCall: 0 };
  for (const kind of ["vacante", "capacitacion"]) {
    let cursor = "";
    do {
      const profileLookup = await db.prepare("SELECT user_id FROM profiles WHERE user_id=?").bind("test").all();
      const page = await personalizedCatalogPage(db, profile, kind, cursor, new Date("2026-10-26T12:00:00-03:00"));
      metrics.calls++;
      metrics.queries += 2;
      metrics.scanned += page.scanned;
      const rowsRead = (page.rowsRead || 0) + (profileLookup.meta.rows_read || 0);
      metrics.rowsRead += rowsRead;
      metrics.maxRowsReadPerCall = Math.max(metrics.maxRowsReadPerCall, rowsRead);
      metrics.matchedIds.push(...page.items.map(item => item.id));
      metrics.responseBytes += Buffer.byteLength(JSON.stringify({ items: page.items, nextCursor: page.nextCursor, scanned: page.scanned }));
      cursor = page.nextCursor || "";
    } while (cursor);
  }
  console.log(JSON.stringify(metrics, null, 2));
} finally { await mf.dispose(); }
