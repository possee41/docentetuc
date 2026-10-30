// Local-only comparison against the approved pre-optimization SQL. No remote binding.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { Miniflare } = require("../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare");
const base = "563832f6ee95879b8eb461ee66a6db7c977d7b8d";
const extract = text => text.match(/export const APP_PUBLICATIONS_QUERY = `([\s\S]*?)`;/)?.[1];
const before = extract(execFileSync("git", ["show", `${base}:lib/app-publications-query.ts`], { encoding: "utf8" }));
const after = extract(readFileSync("lib/app-publications-query.ts", "utf8"));
assert.ok(before && after);
const syncSQL = "SELECT source, synced_at, last_attempt_at, last_successful_sync_at, sync_status FROM sync_state ORDER BY source";
const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('local')}}",
  d1Databases: ["DB"], d1Persist: false });
try {
  const db = await mf.getD1Database("DB");
  // Same 7,200 rows, columns and single sync row as public-app-cache-d1.test.mjs.
  await db.prepare(`CREATE TABLE publications(id TEXT PRIMARY KEY,kind TEXT,source TEXT,title TEXT,summary TEXT,
    metadata TEXT,starts_at TEXT,ends_at TEXT,updated_at TEXT)`).run();
  await db.prepare(`WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM n WHERE i<7199)
    INSERT INTO publications SELECT printf('test:%05d',i),CASE WHEN i%4=0 THEN 'informacion' WHEN i%4=1 THEN 'capacitacion' WHEN i%4=2 THEN 'vacante' ELSE 'junta' END,
    'Fuente sintética','Publicación pública '||i,'Solo información pública','{}',NULL,NULL,'2026-10-30T00:00:00Z' FROM n`).run();
  await db.prepare("CREATE TABLE sync_state(source TEXT,synced_at TEXT,last_attempt_at TEXT,last_successful_sync_at TEXT,sync_status TEXT,error_message TEXT)").run();
  await db.prepare("INSERT INTO sync_state VALUES('Fuente sintética',NULL,'2026-10-30',NULL,'PARTIAL','PRIVATE_DIAGNOSTIC')").run();
  const scenarios = [];
  for (const existingIndexes of [false, true]) {
    if (existingIndexes) {
      // Existing schema indexes only; this benchmark does not propose/apply a migration.
      await db.prepare("CREATE INDEX idx_publications_kind_ends ON publications(kind,ends_at)").run();
      await db.prepare("CREATE INDEX idx_publications_kind_id ON publications(kind,id)").run();
    }
    const plans = {};
    for (const [name, sql] of [["before", before], ["after", after], ["sync", syncSQL]])
      plans[name] = (await db.prepare("EXPLAIN QUERY PLAN " + sql).all()).results;
    const samples = { before: [], after: [] };
    // Alternate execution order to reduce first-query/warm-cache bias.
    for (let round = 0; round < 5; round++) {
      for (const name of round % 2 ? ["after", "before"] : ["before", "after"]) {
        const start = performance.now();
        const publications = await db.prepare(name === "before" ? before : after).all();
        const sync = await db.prepare(syncSQL).all();
        const metrics = r => ({ queries: 1, rowsRead: r.meta.rows_read, rowsWritten: r.meta.rows_written,
          resultCount: r.results.length, sqlDurationMs: r.meta.duration });
        samples[name].push({ publications: metrics(publications), sync: metrics(sync), wallMs: performance.now() - start,
          digest: createHash("sha256").update(JSON.stringify(publications.results)).digest("hex") });
        assert.equal(publications.results.length, 400);
        assert.equal(sync.results[0].sync_status, "PARTIAL");
      }
    }
    assert.ok([...samples.before, ...samples.after].every(s => s.digest === samples.before[0].digest));
    const summarize = values => ({
      publications: values[0].publications, sync: values[0].sync,
      queriesPerMiss: 2,
      rowsReadPerMiss: values[0].publications.rowsRead + values[0].sync.rowsRead,
      rowsWrittenPerMiss: values[0].publications.rowsWritten + values[0].sync.rowsWritten,
      medianMissWallMs: values.map(v => v.wallMs).sort((a,b) => a-b)[2],
      samples: values,
    });
    const result = { existingIndexes, plans, before: summarize(samples.before), after: summarize(samples.after) };
    assert.ok(result.after.rowsReadPerMiss < result.before.rowsReadPerMiss);
    assert.equal(result.after.rowsWrittenPerMiss, 0);
    scenarios.push(result);
  }
  console.log(JSON.stringify({ baseCommit: base, environment: "local Workerd/D1 ephemeral", syntheticPublications: 7200,
    samplesPerQuery: 5, cpu: null, note: "Wall time is not CPU; index-free fixture reproduces the prior benchmark", scenarios }, null, 2));
} finally { await mf.dispose(); }
