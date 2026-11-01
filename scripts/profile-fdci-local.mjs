// Explicit local comparison only. No Cloudflare API, source API, credentials or deploy.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { prepareFdciImports } from "../lib/fdci-import.ts";
import { fdciFixtureSql } from "./fdci-local-fixture.mjs";
import { connectWorkerdCpuProfiler } from "./workerd-cpu-profiler.mjs";

const require = createRequire(import.meta.url);
const { Miniflare } = require("../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare");
const { build } = require("../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild");
const baseline = new Map(["source-import-gateway.mjs", "fdci-receiver.mjs"].map(file => [file,
  execFileSync("git", ["show", `61345db:workers/${file}`], { encoding: "utf8" })]));
const source = `import gateway from './workers/source-import-gateway.mjs';
export default {async fetch(request,env){
  const metrics={queries:0,rowsRead:0,rowsWritten:0};
  const record=r=>{metrics.queries++;metrics.rowsRead+=r.meta.rows_read;metrics.rowsWritten+=r.meta.rows_written;return r;};
  const wrap=s=>({raw:s,bind(...args){return wrap(s.bind(...args));},async all(){return record(await s.all());},
    async first(){return (await this.all()).results[0]||null;},async run(){return record(await s.run());}});
  const db={prepare:sql=>wrap(env.DB.prepare(sql)),async batch(list){return(await env.DB.batch(list.map(s=>s.raw))).map(record);}};
  const start=performance.now(),r=await gateway.fetch(request,{...env,DB:db});
  return Response.json({http:r.status,ack:await r.json(),d1:metrics,workerWallMs:performance.now()-start});
}};`;
const secret = "synthetic_local_fdci_profile_secret_1234567890";
const [item] = await prepareFdciImports([{ capacitacion_id: 100, nombre: "Ficticio", token: "ficticio", slug: "ficticio",
  contenido: "Contenido sintético ".repeat(180) }], [{ id: 9001, capacitacion_id: 100,
  fecha_apertura_preinscripcion: "2026-10-17 23:00:00", fecha_cierre_preinscripcion: "2026-10-19 08:00:00" }]);
const rows = [];
for (let round = 0; round < 3; round++) for (const variant of round % 2 ? ["current", "baseline"] : ["baseline", "current"]) {
  const bundle = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: "js" },
    bundle: true, write: false, platform: "browser", format: "esm", target: "es2022",
    plugins: variant === "baseline" ? [{ name: "approved-baseline", setup(b) {
      b.onLoad({ filter: /[\\/]workers[\\/](source-import-gateway|fdci-receiver)\.mjs$/ }, args => {
        const file = args.path.split(/[\\/]/).at(-1);
        return { contents: baseline.get(file), loader: "js", resolveDir: resolve("workers") };
      });
    } }] : [] });
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, d1Databases: ["DB"],
    inspectorHost: "127.0.0.1", inspectorPort: 0, compatibilityDate: "2026-05-15",
    outboundService: () => { throw new Error("REMOTE_REQUEST_FORBIDDEN"); }, bindings: {
      FDCI_IMPORT_SECRET: secret, FDCI_EXTERNAL_ENABLED: "true", IMPORT_GATE_ENABLED: "false", IMPORT_GATE_LEASE_REQUIRED: "true",
      IMPORT_GATE_ALLOWED_SOURCE: "fdci", IMPORT_DATABASE_NAME: "synthetic-canary", IMPORT_DATABASE_ID: "synthetic-id",
    } });
  let profiler;
  try {
    const db = await mf.getD1Database("DB");
    for (const text of fdciFixtureSql()) for (const sql of text.replace(/^--.*$/gm, "").split(";").map(s => s.trim()).filter(Boolean)) await db.prepare(sql).run();
    await db.prepare("INSERT INTO import_gateway_identity VALUES(1,'synthetic-canary','synthetic-id')").run();
    await db.prepare("INSERT INTO import_gate_lease VALUES(1,'fdci','2099-01-01T00:00:00Z','2026-01-01T00:00:00Z','profile')").run();
    profiler = await connectWorkerdCpuProfiler(await mf.getInspectorURL());
    const measure = async (phase, path, payload) => {
      const result = await profiler.measure(() => mf.dispatchFetch(`http://local/api/internal/${path}`, { method: "POST",
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json", "x-import-gate-owner": "profile" },
        body: JSON.stringify(payload) }));
      const value = await result.value.json();
      assert.equal(value.http, 200);
      rows.push({ variant, round, phase, ...value, sampledCpu: result.cpu });
      return value;
    };
    await measure("firstImport", "fdci-import", { mode: "batch", items: [item] });
    const repeated = await measure("warmUnchanged", "fdci-import", { mode: "batch", items: [item] });
    assert.equal(repeated.ack.rowsWritten, 0);
    await measure("warmChanged", "fdci-import", { mode: "batch", items: [{ ...item, title: "Actualizado", contentHash: "b".repeat(64) }] });
    if (variant === "current") {
      await measure("checkpointGet", "fdci-checkpoint", { op: "get" });
      await measure("checkpointStart", "fdci-checkpoint", { op: "start", revision: 0, upper: "000000000100:000000009001" });
      await measure("checkpointAdvance", "fdci-checkpoint", { op: "advance", revision: 1, after: "000000000100:000000009001", failed: false, code: null });
      await measure("checkpointFinish", "fdci-checkpoint", { op: "finish", revision: 2 });
    }
  } finally { profiler?.close(); await mf.dispose(); }
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const summary = [...new Set(rows.map(r => r.phase))].flatMap(phase => ["baseline", "current"].flatMap(variant => {
  const list = rows.filter(r => r.phase === phase && r.variant === variant);
  return list.length ? [{ variant, phase, samples: list.length, medianActiveSampledMs: median(list.map(r => r.sampledCpu.activeSampledMs)),
    lowResolution: list.filter(r => r.sampledCpu.lowResolution).length, medianWorkerWallMs: median(list.map(r => r.workerWallMs)),
    d1: list.map(r => r.d1) }] : [];
}));
const report = { baseline: "61345db", rows, summary, note: "Local V8 sampling with instrumentation; not Cloudflare billed CPU. First import excludes deployment startup. Never infer CPU from wall time." };
writeFileSync(".wrangler/fdci-cursor-cpu-local.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ summary, note: report.note }));
