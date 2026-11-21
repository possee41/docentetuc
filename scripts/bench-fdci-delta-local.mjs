// Real local Workerd/D1; sources are pre-normalized synthetic observations.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fdciFixtureSql } from "./fdci-local-fixture.mjs";
import { deltaData, deltaSeed } from "./fdci-delta-local-fixture.mjs";
import { runDeltaFdci } from "./fdci-delta.mjs";
const require = createRequire(import.meta.url);
const { Miniflare } = require("../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare");
const { build } = require("../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild");
const compare = process.argv.includes("--compare-1000");
let baselineRunner;
if (compare) {
  const old = await build({ stdin: { contents: execFileSync("git", ["show", "4067980:scripts/fdci-delta.mjs"], { encoding: "utf8" }),
    resolveDir: resolve("scripts") }, bundle: true, format: "esm", platform: "node", target: "node24", write: false });
  baselineRunner = (await import(`data:text/javascript;base64,${Buffer.from(old.outputFiles[0].text).toString("base64")}`)).runDeltaFdci;
}
const rows = [];
for (const variant of compare ? ["4067980", "current"] : ["current"]) {
const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
import gateway from './workers/source-import-gateway.mjs';
export default {async fetch(request,env){
  const m={queries:0,rowsRead:0,rowsWritten:0};
  const record=r=>{m.queries++;m.rowsRead+=r.meta?.rows_read||0;m.rowsWritten+=r.meta?.rows_written||0;return r;};
  const wrap=s=>({raw:s,bind(...a){return wrap(s.bind(...a));},async all(){return record(await s.all());},
    async first(){return(await this.all()).results[0]||null;},async run(){return record(await s.run());}});
  const db={prepare:sql=>wrap(env.DB.prepare(sql)),async batch(list){return(await env.DB.batch(list.map(s=>s.raw))).map(record);}};
  const r=await gateway.fetch(request,{...env,DB:db});const h=new Headers(r.headers);h.set('x-local-d1',JSON.stringify(m));
  return new Response(r.body,{status:r.status,headers:h});
}};` }, bundle: true, format: "esm", platform: "browser", target: "es2022", write: false,
  plugins: variant === "4067980" ? [{ name: "local-git-baseline", setup(b) {
    b.onLoad({ filter: /[\\/]workers[\\/][a-z-]+\.mjs$/ }, args => ({
      contents: execFileSync("git", ["show", `4067980:workers/${args.path.split(/[\\/]/).at(-1)}`], { encoding: "utf8" }),
      loader: "js", resolveDir: resolve("workers"),
    }));
  } }] : [] });
const secret = "synthetic_delta_bench_secret_123456789012345", owner = "delta-local";
const target = { origin: "http://127.0.0.1:8798", endpoint: "http://127.0.0.1:8798/api/internal/fdci-import", secret };
let outbound = 0;
const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-05-15",
  d1Databases: ["DB"], d1Persist: false, outboundService() { outbound++; throw new Error("REMOTE_FORBIDDEN"); },
  bindings: { IMPORT_GATE_ENABLED: "false", IMPORT_GATE_LEASE_REQUIRED: "true", IMPORT_GATE_ALLOWED_SOURCE: "fdci",
    FDCI_EXTERNAL_ENABLED: "true", FDCI_IMPORT_SECRET: secret, FDCI_DELTA_ENABLED: "true",
    IMPORT_DATABASE_NAME: "synthetic-canary", IMPORT_DATABASE_ID: "synthetic-id" } });
try {
  const db = await mf.getD1Database("DB");
  for (const text of [...fdciFixtureSql(), readFileSync("migrations/0034_fdci_delta_queue.sql", "utf8")])
    for (const sql of text.replace(/^--.*$/gm, "").split(";").map(s => s.trim()).filter(Boolean)) await db.prepare(sql).run();
  await db.prepare("INSERT INTO import_gateway_identity VALUES(1,'synthetic-canary','synthetic-id')").run();
  await db.prepare("INSERT INTO import_gate_lease VALUES(1,'fdci','2099-01-01T00:00:00Z','2026-01-01T00:00:00Z','delta-local')").run();
  for (const count of compare ? [1000] : [30, 259, 500, 1000]) for (const events of [0, 2, 10, 30, 100]) {
    await db.exec("DELETE FROM fdci_delta_queue; DELETE FROM publications; UPDATE fdci_delta_state SET revision=0,stage_token='',stage_owner='',last_staged_id='',last_complete_scan_at=NULL,detail_after='',detail_upper='',detail_cycle=1");
    const data = await deltaData(count, events), seed = deltaSeed(data.baseline);
    for (let i = 0; i < seed.length; i += 10) await db.exec(seed.slice(i, i + 10).map(sql => sql.replace(/\n\s*/g, " ")).join("\n"));
    const d1 = { queries: 0, rowsRead: 0, rowsWritten: 0 };
    let gatewayRequests = 0, publicationRequests = 0;
    const fetcher = async (url, init) => {
      if (new URL(url).origin !== target.origin) throw new Error("REMOTE_FORBIDDEN");
      gatewayRequests++; if (new URL(url).pathname.endsWith("fdci-import")) publicationRequests++;
      const r = await mf.dispatchFetch(url, init);
      assert.equal(r.status, 200, await r.clone().text());
      const metrics = JSON.parse(r.headers.get("x-local-d1"));
      for (const key of Object.keys(d1)) d1[key] += metrics[key];
      return r;
    };
    const start = performance.now(), cpu = process.cpuUsage();
    const run = variant === "4067980" ? baselineRunner : runDeltaFdci;
    const r = await run(target, { maxPublications: 2, owner }, fetcher, async () => ({ items: data.items, failures: 0,
      activeCommissions: count, detail: { after: "000000000100", upper: "000000000100", complete: true } }));
    const used = process.cpuUsage(cpu);
    assert.equal(r.queued, data.uniqueChanges); assert.equal(r.updated, Math.min(2, data.uniqueChanges));
    assert.equal(r.pending, Math.max(0, data.uniqueChanges - 2)); assert.equal(r.created, 0);
    if (!events) { assert.equal(publicationRequests, 0); assert.equal(d1.rowsWritten, 1); }
    rows.push({ variant, count, modificationEvents: events, uniqueChanges: data.uniqueChanges, nodeNormalizationMs: data.normalizationMs,
      deltaElapsedMs: performance.now() - start, nodeProcessCpuMs: (used.user + used.system) / 1000,
      gatewayRequests, publicationRequests, ...d1, pending: r.pending, updated: r.updated });
  }
  assert.equal(outbound, 0);
} finally { await mf.dispose(); }
}
const report = { at: new Date().toISOString(), nodeVersion: process.version, rows, remoteOperations: 0,
  note: "Local D1 meta with instrumentation, not remote billing. Delta wall time includes loopback, excludes source collection, pauses, runtime startup and lease/automation controls. Node process CPU is not Cloudflare CPU. 100 events on 30 records coalesce to 30 latest states." };
writeFileSync(compare ? ".wrangler/fdci-delta-comparison-local.json" : ".wrangler/fdci-delta-local.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
