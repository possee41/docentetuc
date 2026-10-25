// Manual, single-root Juntas probe. D1 stays under .wrangler; no Cloudflare token.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { runJuntasCheckpoint } from "./import-juntas-checkpoint.mjs";
import { JUNTA_EXTERNAL_SOURCES } from "../lib/junta-external-sources.ts";
import { boardItems } from "../lib/board-view.ts";

const require = createRequire(import.meta.url);
const { Miniflare } = require("../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare");
const root = JUNTA_EXTERNAL_SOURCES.find(([id]) => id === "abiertos-primaria");
const statePath = resolve(fileURLToPath(new URL("../.wrangler/juntas-checkpoint-probe", import.meta.url)));
const mode = process.argv[2];
if (!root || !["--prepare", "--status", "--run"].includes(mode) || process.argv.length !== 3)
  throw new Error("JUNTAS_PROBE_USAGE: --prepare | --status | --run");
if (mode === "--run" && !/^[A-Za-z0-9_-]{10,}$/.test(process.env.GOOGLE_DRIVE_API_KEY || ""))
  throw new Error("GOOGLE_DRIVE_API_KEY_REQUIRED");

const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('local'); } }",
  d1Databases: ["DB"], d1Persist: statePath });
const applySql = async (db, text) => {
  for (const sql of text.replace(/^--.*$/gm, "").split(";").map((part) => part.trim()).filter(Boolean))
    await db.prepare(sql).run();
};
const meter = (raw) => {
  const counts = { queries: 0, rowsRead: 0, rowsWritten: 0 };
  const record = (result) => { counts.queries++; counts.rowsRead += Number(result.meta?.rows_read || 0);
    counts.rowsWritten += Number(result.meta?.rows_written || 0); return result; };
  return { metrics: () => ({ ...counts }), prepare(sql) { return { bind(...values) {
    const statement = raw.prepare(sql).bind(...values);
    return { raw: statement, all: async () => record(await statement.all()),
      first: async () => (await record(await statement.all())).results[0] || null,
      run: async () => record(await statement.run()) };
  } }; }, batch: async (statements) => (await raw.batch(statements.map((item) => item.raw))).map(record) };
};

try {
  const raw = await mf.getD1Database("DB");
  if (mode === "--prepare") {
    await applySql(raw, readFileSync(new URL("./fixtures/sime-ui-local.sql", import.meta.url), "utf8"));
    await applySql(raw, readFileSync(new URL("../migrations/0026_juntas_incremental.sql", import.meta.url), "utf8"));
    console.log(JSON.stringify({ prepared: true, root: root[0], localD1: statePath, migration: "0026" }));
  } else {
    const existing = await raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='juntas_import_checkpoint'").first();
    if (!existing) throw new Error("JUNTAS_PROBE_PREPARE_FIRST");
    let result;
    let filesReturned = 0;
    if (mode === "--run") {
      const sourceFetch = async (input, init) => {
        const url = new URL(String(input));
        if (url.origin !== "https://www.googleapis.com" && url.origin !== "https://docs.google.com")
          throw new Error("JUNTAS_PROBE_SOURCE_INVALID");
        const response = await fetch(input, init);
        if (url.pathname === "/drive/v3/files" && response.ok) {
          const body = await response.clone().json();
          filesReturned += Array.isArray(body.files) ? body.files.length : 0;
        }
        return response;
      };
      result = await runJuntasCheckpoint({ db: meter(raw), driveKey: process.env.GOOGLE_DRIVE_API_KEY,
        sourceFetch, sources: [root], maxRequests: 5, maxPublicationWrites: 10 });
    }
    const row = await raw.prepare("SELECT state_json,status,last_attempt_at,last_success_at,error_code FROM juntas_import_checkpoint WHERE root_id=?")
      .bind(root[0]).first();
    const state = row ? JSON.parse(row.state_json) : null;
    const counts = await raw.prepare(`SELECT COUNT(*) AS total, COUNT(DISTINCT id) AS distinct_ids
      FROM publications WHERE id LIKE 'drive:abiertos-primaria:%'`).first();
    const publications = (await raw.prepare(`SELECT id,kind,category,metadata,starts_at,ends_at,updated_at,
      source_published_at,removed_at,normalized_status FROM publications
      WHERE id LIKE 'drive:abiertos-primaria:%' LIMIT 20`).all()).results;
    console.log(JSON.stringify({ root: root[0],
      ...(result ? { sourceRequests: result.sourceRequests, filesReturned, filesExamined: result.filesExamined,
        publicationAttempts: result.publicationAttempts,
        created: result.created, updated: result.updated, unchanged: result.unchanged,
        skippedUnchanged: result.skippedUnchanged, d1: result.d1, failures: result.failures } : {}),
      publications: { total: counts.total, duplicates: counts.total - counts.distinct_ids,
        sampled: publications.length, verifiedCurrentCallsInSample: boardItems(publications, "llamados").length },
      checkpoint: row ? { status: row.status, lastAttempt: row.last_attempt_at, lastComplete: row.last_success_at,
        error: row.error_code, cycle: state.cycle, pendingFolders: state.queue.length,
        currentFolder: state.queue[0]?.id || null, pageTokenPresent: Boolean(state.queue[0]?.token),
        pendingPageItems: state.page ? state.page.files.length - state.page.index : 0 } : null }));
  }
} finally { await mf.dispose(); }
