// Ephemeral D1 only: compare the deployed SQL with the exact-ID exclusion.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { APP_PUBLICATIONS_QUERY } from "../lib/app-publications-query.ts";
import { FDCI_CANARY_SYNTHETIC_IDS } from "../lib/fdci-canary-synthetic.ts";
const require = createRequire(import.meta.url);
const { Miniflare } = require("../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare");
const previous = execFileSync("git", ["show", "65ed550:lib/app-publications-query.ts"], { encoding: "utf8" })
  .match(/export const APP_PUBLICATIONS_QUERY = `([\s\S]*?)`;/)?.[1];
assert(previous);
const median = values => [...values].sort((a,b) => a-b)[Math.floor(values.length / 2)];
const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('local-only')}}", d1Databases: ["DB"], d1Persist: false });
try {
  const db = await mf.getD1Database("DB");
  await db.exec("CREATE TABLE publications(id TEXT PRIMARY KEY,kind TEXT,metadata TEXT,starts_at TEXT,ends_at TEXT,updated_at TEXT); CREATE INDEX idx_publications_kind_ends ON publications(kind,ends_at); CREATE INDEX idx_publications_kind_id ON publications(kind,id);");
  await db.prepare(`WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM n WHERE i<7199)
    INSERT INTO publications SELECT printf('local:%05d',i),CASE WHEN i%4=0 THEN 'informacion' ELSE 'capacitacion' END,
    CASE WHEN i%5=0 THEN NULL WHEN i%5=1 THEN '' WHEN i%5=2 THEN 'invalid{' ELSE '{}' END,NULL,NULL,'2026-10-30' FROM n`).run();
  for (const id of FDCI_CANARY_SYNTHETIC_IDS) await db.prepare("INSERT INTO publications VALUES(?,'capacitacion','{}',NULL,NULL,'2026-11-01 07:33:49')").bind(id).run();
  for (const id of ["fdci:commission:6432", "fdci:commission:6434"]) await db.prepare("INSERT INTO publications VALUES(?,'capacitacion','{}',NULL,NULL,'2026-11-01 02:19:34')").bind(id).run();
  const results = {};
  for (const [name, sql] of [["before", previous], ["after", APP_PUBLICATIONS_QUERY]]) {
    const samples = [];
    await db.prepare(sql).all(); // warm up only local D1
    for (let i=0;i<9;i++) {
      const start = performance.now(), response = await db.prepare(sql).all();
      samples.push({ elapsedMs: performance.now()-start, meta: response.meta });
      assert.equal(response.results.length,400);
      assert(response.results.some(r => r.id === "fdci:commission:6432")); assert(response.results.some(r => r.id === "fdci:commission:6434"));
      assert.equal(response.results.filter(r => FDCI_CANARY_SYNTHETIC_IDS.includes(r.id)).length,name === "before" ? 5 : 0);
    }
    results[name] = { inferredQueriesPerMiss: 2, catalogQueries: 1, unchangedSyncQueries: 1, samples: samples.length,
      medianRowsRead: median(samples.map(r=>r.meta.rows_read)), medianRowsWritten: median(samples.map(r=>r.meta.rows_written)),
      medianD1LocalDurationMs: median(samples.map(r=>r.meta.duration)), medianNodeRoundtripMs: median(samples.map(r=>r.elapsedMs)),
      plan: (await db.prepare("EXPLAIN QUERY PLAN "+sql).all()).results.map(r=>r.detail) };
  }
  assert.deepEqual(results.after.plan, results.before.plan);
  assert(results.after.medianRowsRead <= results.before.medianRowsRead);
  console.log(JSON.stringify({ rows:7207, localOnly:true, remoteCpuMeasured:false, ...results },null,2));
} finally { await mf.dispose(); }
