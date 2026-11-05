// Local-only reproduction of the two-candidate canary stage, with sampled Workerd CPU.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import { prepareFdciImports } from "../lib/fdci-import.ts";
import { connectWorkerdCpuProfiler } from "./workerd-cpu-profiler.mjs";
const require = createRequire(import.meta.url);
const { Miniflare } = require("../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare");
const { build } = require("../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild");
const baseline = process.argv.find(x => x.startsWith("--baseline="))?.split("=")[1] || "47707e6";
assert.match(baseline, /^[a-f0-9]{7,40}$/);
const count = 40, rounds = 3, secret = "synthetic_stage_profile_secret_1234567890", sha = "a".repeat(40), owner = "100-1";
const items = await prepareFdciImports([{ capacitacion_id: 100, nombre: "Canary FDCI sintético — NO OFICIAL", token: "synthetic", slug: "synthetic" }],
  [9000, 9001].map((id, i) => ({ id, capacitacion_id: 100, cupo: 21 + i,
    fecha_apertura_preinscripcion: "2026-01-01 08:00:00", fecha_cierre_preinscripcion: "2099-12-01 08:00:00" })), new Date("2026-11-05T11:00:00Z"));
const migrations = ["drizzle/0000_docentetuc.sql", "drizzle/0001_training_metadata.sql", "drizzle/0003_web_push.sql",
  "migrations/0008_personal_matching_circuits.sql", "migrations/0009_reliability_lifecycle.sql", "migrations/0029_import_gateway_identity.sql",
  "migrations/0031_import_gate_lease.sql", "migrations/0032_fdci_import_checkpoint.sql", "migrations/0033_fdci_automation_control.sql", "migrations/0034_fdci_delta_queue.sql"];
const source = `import gateway from './workers/source-import-gateway.mjs';
function measured(db,m) {
 const wrap=(s)=>({raw:s,bind(...args){return wrap(s.bind(...args));},
  async first(){m.rpc++;m.sql++;const r=await s.all();m.read+=r.meta.rows_read;m.written+=r.meta.rows_written;return r.results[0]??null;},
  async all(){m.rpc++;m.sql++;const r=await s.all();m.read+=r.meta.rows_read;m.written+=r.meta.rows_written;return r;}});
 return {prepare(sql){m.prepared++;return wrap(db.prepare(sql));},async batch(ss){m.rpc++;m.sql+=ss.length;const rr=await db.batch(ss.map(s=>s.raw));for(const r of rr){m.read+=r.meta.rows_read;m.written+=r.meta.rows_written;}return rr;}};
}
export default {async fetch(request,env){const metrics={rpc:0,sql:0,prepared:0,read:0,written:0};const start=performance.now();
 const response=await gateway.fetch(request,{...env,DB:measured(env.DB,metrics)});const wallMs=performance.now()-start;
 return Response.json({status:response.status,ack:await response.json(),metrics,wallMs});}};`;
async function bundle(ref) {
  const plugins = ref ? [{ name: "read-only-baseline", setup(b) {
    b.onLoad({ filter: /[\\/]workers[\\/](fdci-delta|fdci-automation)\.mjs$/ }, args => ({
      contents: execFileSync("git", ["show", `${ref}:${relative(process.cwd(), args.path).replaceAll("\\", "/")}`], { encoding: "utf8", windowsHide: true }), loader: "js",
    }));
  } }] : [];
  return (await build({ stdin: { contents: source, resolveDir: process.cwd(), sourcefile: "fdci-stage-local.mjs" },
    plugins, bundle: true, write: false, format: "esm", platform: "browser", target: "es2022" })).outputFiles[0].text;
}
const bundles = { before: await bundle(baseline), after: await bundle() }, results = [];
for (let round = 0; round < rounds; round++) for (const variant of round % 2 ? ["after", "before"] : ["before", "after"]) {
  const mf = new Miniflare({ modules: true, script: bundles[variant], compatibilityDate: "2026-05-15",
    d1Databases: ["DB"], d1Persist: false, inspectorHost: "127.0.0.1", inspectorPort: 0,
    bindings: { IMPORT_DATABASE_NAME: "synthetic-canary", IMPORT_DATABASE_ID: "synthetic-id",
      IMPORT_GATE_ALLOWED_SOURCE: "fdci", IMPORT_GATE_ENABLED: "false", IMPORT_GATE_LEASE_REQUIRED: "false",
      FDCI_EXTERNAL_ENABLED: "false", FDCI_AUTOMATION_ENABLED: "true", FDCI_DELTA_ENABLED: "true", FDCI_AUTOMATION_SECRET: secret } });
  let profiler;
  try {
    const db = await mf.getD1Database("DB");
    for (const file of migrations) {
      const statements = readFileSync(file, "utf8").replace(/^--.*$/gm, "").split(";").map(x => x.trim()).filter(Boolean);
      await db.batch(statements.map(sql => db.prepare(sql)));
    }
    const from = Math.floor(Date.now() / 7_200_000) * 7_200_000, until = new Date(Date.now() + 600_000).toISOString();
    await db.batch([
      db.prepare("INSERT INTO import_gateway_identity VALUES(1,'synthetic-canary','synthetic-id')"),
      db.prepare("INSERT INTO import_gate_lease VALUES(1,'fdci',?,?,'100-1')").bind(until, new Date().toISOString()),
      db.prepare("UPDATE fdci_automation_control SET status='RUNNING',owner='100-1',approved_sha=?,not_before=?,not_after=?,lease_until=? WHERE id=1")
        .bind(sha, new Date(from).toISOString(), until, until),
    ]);
    profiler = await connectWorkerdCpuProfiler(await mf.getInspectorURL());
    let revision = 0;
    const stage = async () => {
      const r = await mf.dispatchFetch("http://local.test/api/internal/fdci-automation/delta", { method: "POST",
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json", "x-import-gate-owner": owner, "x-fdci-automation-sha": sha },
        body: JSON.stringify({ op: "stage", revision, items }) });
      const result = await r.json(); assert.equal(result.status, 200); assert.equal(result.ack.state.revision, ++revision); return result;
    };
    const cold = await profiler.measure(stage);
    const repeated = await profiler.measure(async () => { const samples = []; for (let i = 0; i < count; i++) samples.push(await stage()); return samples; });
    const queue = (await db.prepare("SELECT publication_id,content_hash,version FROM fdci_delta_queue ORDER BY publication_id").all()).results;
    assert.deepEqual(queue.map(x => [x.publication_id, x.content_hash, x.version]), items.map(x => [x.id, x.contentHash, 1]));
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM publications").first()).n, 0);
    const output = { variant, round, cold: { ...cold.value, sampledCpu: cold.cpu },
      repeat: { requests: count, meanGatewayWallMs: repeated.value.reduce((s, r) => s + r.wallMs, 0) / count,
        metricsPerRequest: repeated.value[0].metrics, sampledCpu: repeated.cpu,
        activeSampledMsPerRequest: repeated.cpu.activeSampledMs / count },
      queueUnchangedOnRepeat: true };
    results.push(output); console.log(JSON.stringify(output));
  } finally { profiler?.close(); await mf.dispose(); }
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const summary = Object.fromEntries(["before", "after"].map(v => { const rr = results.filter(x => x.variant === v); return [v, {
  coldMetrics: rr[0].cold.metrics, repeatedMetrics: rr[0].repeat.metricsPerRequest,
  coldActiveSampledMsMedian: median(rr.map(x => x.cold.sampledCpu.activeSampledMs)),
  repeatActiveSampledMsPerRequestMedian: median(rr.map(x => x.repeat.activeSampledMsPerRequest)),
  repeatGatewayWallMsMedian: median(rr.map(x => x.repeat.meanGatewayWallMs)),
}]; }));
const report = { scope: "Local Workerd/CDP sampled active time, not remote CPU or billing", baseline, count, rounds,
  fixture: { publications: 0, candidates: 2, payloadBytes: Buffer.byteLength(JSON.stringify({ op: "stage", revision: 0, items })) }, summary, results };
mkdirSync(".wrangler", { recursive: true }); writeFileSync(".wrangler/fdci-stage-workerd-comparison.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ summary, caveat: report.scope }));
