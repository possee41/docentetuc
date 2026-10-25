// Reproducible Workerd/D1 benchmark; synthetic source, ephemeral database, no credentials.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runJuntasCheckpoint } from "./import-juntas-checkpoint.mjs";

const require = createRequire(import.meta.url);
const { Miniflare } = require("../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare");
const root = ["pad-bench", "Padrones", "Inicial y Primaria", "https://drive.google.com/drive/folders/123456789012345678901234567890"];
const now = new Date("2026-10-25T12:00:00Z");
const key = "synthetic_drive_key_1234567890";
const records = Number(process.argv.find((arg) => arg.startsWith("--records="))?.split("=")[1] || 4067);
if (!Number.isSafeInteger(records) || records < 1 || records > 5000) throw new Error("BENCH_RECORDS_INVALID");

function meter(raw) {
  const counts = { queries: 0, rowsRead: 0, rowsWritten: 0 };
  const record = (result) => { counts.queries++; counts.rowsRead += Number(result.meta?.rows_read || 0);
    counts.rowsWritten += Number(result.meta?.rows_written || 0); return result; };
  return { metrics: () => ({ ...counts }), prepare(sql) { return { bind(...values) {
    const statement = raw.prepare(sql).bind(...values);
    return { raw: statement, all: async () => record(await statement.all()),
      first: async () => (await record(await statement.all())).results[0] || null,
      run: async () => record(await statement.run()) };
  } }; }, batch: async (statements) => (await raw.batch(statements.map((item) => item.raw))).map(record) };
}

const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('isolated')}}",
  d1Databases: ["DB"] });
try {
  const raw = await mf.getD1Database("DB");
  const schema = `CREATE TABLE publications (
    id TEXT PRIMARY KEY,source TEXT NOT NULL,external_id TEXT NOT NULL,kind TEXT NOT NULL,category TEXT NOT NULL,
    title TEXT NOT NULL,summary TEXT NOT NULL DEFAULT '',level TEXT NOT NULL DEFAULT '',area TEXT NOT NULL DEFAULT '',
    junta TEXT NOT NULL DEFAULT '',location TEXT NOT NULL DEFAULT '',shift TEXT NOT NULL DEFAULT '',character TEXT NOT NULL DEFAULT '',
    starts_at TEXT,ends_at TEXT,status TEXT NOT NULL,official_url TEXT NOT NULL,metadata TEXT NOT NULL,
    content_hash TEXT NOT NULL,source_updated_at TEXT,source_published_at TEXT,registration_open_at TEXT,
    registration_close_at TEXT,expires_at TEXT,source_status TEXT NOT NULL DEFAULT 'UNKNOWN',
    normalized_status TEXT NOT NULL DEFAULT 'UNKNOWN',removed_at TEXT,last_seen_at TEXT NOT NULL DEFAULT '',
    last_changed_at TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`;
  await raw.prepare(schema).run();
  await raw.prepare(`CREATE TABLE sync_state (source TEXT PRIMARY KEY,synced_at TEXT NOT NULL DEFAULT '',
    item_count INTEGER NOT NULL DEFAULT 0,last_attempt_at TEXT,last_successful_sync_at TEXT,
    sync_status TEXT NOT NULL DEFAULT 'UNKNOWN',error_code TEXT)`).run();
  const migration = readFileSync(new URL("../migrations/0026_juntas_incremental.sql", import.meta.url), "utf8");
  for (const statement of migration.replace(/^--.*$/gm, "").split(";").map((part) => part.trim()).filter(Boolean))
    await raw.prepare(statement).run();
  const db = meter(raw);
  const sourceFetch = async (input) => {
    const url = new URL(String(input));
    const offset = Number(url.searchParams.get("pageToken") || 0);
    const files = Array.from({ length: Math.max(0, Math.min(25, records - offset)) }, (_, index) => {
      const id = offset + index;
      return { id: `file_${String(id).padStart(8, "0")}`, name: `Padrón ${id}`, mimeType: "application/pdf",
        modifiedTime: "2026-10-24T10:00:00Z" };
    });
    return Response.json({ files, ...(offset + 25 < records ? { nextPageToken: String(offset + 25) } : {}) });
  };
  async function cycle(at) {
    const total = { invocations: 0, sourceRequests: 0, queries: 0, rowsRead: 0, rowsWritten: 0,
      created: 0, updated: 0, skippedUnchanged: 0, maxQueries: 0, maxRowsWritten: 0 };
    for (let index = 0; index < 300; index++) {
      const result = await runJuntasCheckpoint({ db, driveKey: key, sourceFetch, sources: [root], now: at,
        maxRequests: 8, maxPublicationWrites: 20, maxSteps: 40 });
      total.invocations++; total.sourceRequests += result.sourceRequests;
      total.queries += result.d1.queries; total.rowsRead += result.d1.rowsRead; total.rowsWritten += result.d1.rowsWritten;
      total.created += result.created; total.updated += result.updated; total.skippedUnchanged += result.skippedUnchanged;
      total.maxQueries = Math.max(total.maxQueries, result.d1.queries);
      total.maxRowsWritten = Math.max(total.maxRowsWritten, result.d1.rowsWritten);
      if (result.completed) return total;
    }
    throw new Error("BENCH_INCOMPLETE");
  }
  const first = await cycle(now);
  const unchanged = await cycle(new Date(now.getTime() + 25 * 60 * 60 * 1000));
  console.log(JSON.stringify({ engine: "Workerd ephemeral D1", records, first, unchanged }));
} finally { await mf.dispose(); }
