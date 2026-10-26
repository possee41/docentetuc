// Isolated Workerd D1 accounting: no source fetches or production access.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readSyncHealth } from "../lib/sync-health.ts";
import { runScheduledTask } from "./scheduled-task.mjs";

const require = createRequire(import.meta.url);
const { Miniflare } = require("../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare");
const mf = new Miniflare({ modules: true,
  script: "export default { fetch() { return new Response('isolated'); } }", d1Databases: ["DB"] });
try {
  const raw = await mf.getD1Database("DB");
  await raw.prepare("CREATE TABLE sync_state(source TEXT PRIMARY KEY,sync_status TEXT,last_attempt_at TEXT,last_successful_sync_at TEXT)").run();
  await raw.prepare("CREATE TABLE publications(id TEXT PRIMARY KEY,title TEXT)").run();
  for (const source of ["SIME", "Capacitación Docente", "Padrones", "CeNET / INET", "INFoD / AulaS-TIC"])
    await raw.prepare("INSERT INTO sync_state(source,sync_status) VALUES(?,'PARTIAL')").bind(source).run();
  for (let offset = 0; offset < 7200; offset += 100) {
    const ids = Array.from({ length: 100 }, (_, index) => `historic:${offset + index}`);
    await raw.prepare(`INSERT INTO publications(id,title) VALUES ${ids.map(() => "(?,'Conservada')").join(",")}`)
      .bind(...ids).run();
  }
  let fetches = 0;
  const started = performance.now();
  const task = await runScheduledTask("0 * * * *", "synthetic", async () => { fetches++; throw new Error("UNEXPECTED_FETCH"); });
  const retiredWallMs = performance.now() - started;
  const metrics = { calls: 0, rowsRead: 0, rowsWritten: 0 };
  const db = { prepare: (sql) => ({ all: async () => {
    metrics.calls++;
    const result = await raw.prepare(sql).all();
    metrics.rowsRead += Number(result.meta?.rows_read || 0);
    metrics.rowsWritten += Number(result.meta?.rows_written || 0);
    return result;
  } }) };
  const health = await readSyncHealth(db);
  assert.equal(task, "sync-retired");
  assert.equal(fetches, 0);
  assert.equal(health.length, 5);
  assert.equal((await raw.prepare("SELECT COUNT(*) AS n FROM publications").first()).n, 7200);
  console.log(JSON.stringify({ database: "D1 efímera Workerd", catalogRows: 7200,
    scheduled: { fetches, d1Calls: 0, rowsRead: 0, rowsWritten: 0, wallMs: retiredWallMs },
    authenticatedStatus: metrics, note: "wallMs no representa CPU facturada" }));
} finally { await mf.dispose(); }
