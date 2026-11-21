// Synthetic local measurements only. Never loads remote configuration or credentials.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { prepareFdciImports } from "../lib/fdci-import.ts";
import { fdciFixtureSql } from "./fdci-local-fixture.mjs";
import { resolveGatewayConfig, runGatewayImport } from "./import-via-gateway.mjs";
import { checkFdciHybridBoundary } from "./check-fdci-hybrid-boundary.mjs";
const require = createRequire(import.meta.url);
const { Miniflare } = require("../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare");
const { build } = require("../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild");
const synthetic = (count, courseCount = 1) => ({
  courses: Array.from({ length: courseCount }, (_, i) => ({ capacitacion_id: 100 + i, nombre: "Curso ficticio",
    token: `synthetic${i}`, slug: `synthetic-${i}`, contenido: "Contenido sintético educativo. ".repeat(30) })),
  commissions: Array.from({ length: count }, (_, i) => ({ id: 9000 + i, capacitacion_id: 100 + i % courseCount,
    fecha_apertura_preinscripcion: "2026-01-01 08:00:00", fecha_cierre_preinscripcion: "2099-12-01 08:00:00" })),
});
const median = list => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
const nodeMeasurements = [];
await prepareFdciImports(synthetic(30).courses, synthetic(30).commissions);
for (const count of [30, 300, 1000]) {
  const data = synthetic(count), samples = [];
  for (let repetition = 0; repetition < 3; repetition++) {
    const cpu = process.cpuUsage(), start = performance.now();
    const items = await prepareFdciImports(data.courses, data.commissions);
    const elapsedMs = performance.now() - start, used = process.cpuUsage(cpu);
    assert.equal(items.length, count);
    samples.push({ elapsedMs, nodeProcessCpuMs: (used.user + used.system) / 1000 });
  }
  nodeMeasurements.push({ count, samples, medianElapsedMs: median(samples.map(s => s.elapsedMs)),
    medianNodeProcessCpuMs: median(samples.map(s => s.nodeProcessCpuMs)) });
}

// Instrument the existing Worker only in this in-memory bundle; production stays unchanged.
const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
import gateway from './workers/source-import-gateway.mjs';
export default {async fetch(request,env){
  const m={queries:0,roundTrips:0,rowsRead:0,rowsWritten:0};
  const record=r=>{m.queries++;m.rowsRead+=r.meta?.rows_read||0;m.rowsWritten+=r.meta?.rows_written||0;return r;};
  const wrap=s=>({raw:s,bind(...a){return wrap(s.bind(...a));},async all(){m.roundTrips++;return record(await s.all());},
    async first(){return(await this.all()).results[0]||null;},async run(){m.roundTrips++;return record(await s.run());}});
  const db={prepare:sql=>wrap(env.DB.prepare(sql)),async batch(list){m.roundTrips++;return(await env.DB.batch(list.map(s=>s.raw))).map(record);}};
  const r=await gateway.fetch(request,{...env,DB:db});
  const headers=new Headers(r.headers);headers.set('x-local-d1',JSON.stringify(m));
  return new Response(r.body,{status:r.status,headers});
}};` }, bundle: true, write: false, platform: "browser", format: "esm", target: "es2022" });
const config = { SYNC_SOURCE: "fdci", IMPORT_GATEWAY_TARGET: "canary", IMPORT_GATEWAY_ORIGIN: "http://127.0.0.1:8798",
  IMPORT_GATEWAY_DATABASE_NAME: "docentetuc-web-canary-1-2-local", IMPORT_GATEWAY_DATABASE_ID: "00000000-0000-4000-8000-000000000012",
  FDCI_IMPORT_SECRET: "synthetic_capacity_secret_123456789012", IMPORT_GATE_RUN_ID: "capacity-local", FDCI_SCOPE: "active",
  FDCI_MAX_REQUESTS: "6", FDCI_PAUSE_MS: "400" };
const gatewayMeasurements = [];
for (const scenario of [{ count: 30, courses: 1, limit: 2 }, { count: 30, courses: 30, limit: 5 }, { count: 5, courses: 1, limit: 5 }]) {
  const data = synthetic(scenario.count, scenario.courses);
  let outbound = 0;
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, d1Databases: ["DB"], d1Persist: false,
    compatibilityDate: "2026-05-15", outboundService() { outbound++; throw new Error("REMOTE_FORBIDDEN"); },
    bindings: { IMPORT_GATE_ENABLED: "false", IMPORT_GATE_LEASE_REQUIRED: "true", IMPORT_GATE_ALLOWED_SOURCE: "fdci",
      FDCI_EXTERNAL_ENABLED: "true", FDCI_IMPORT_SECRET: config.FDCI_IMPORT_SECRET,
      IMPORT_DATABASE_NAME: config.IMPORT_GATEWAY_DATABASE_NAME, IMPORT_DATABASE_ID: config.IMPORT_GATEWAY_DATABASE_ID } });
  try {
    const db = await mf.getD1Database("DB");
    for (const text of fdciFixtureSql())
      for (const sql of text.replace(/^--.*$/gm, "").split(";").map(s => s.trim()).filter(Boolean)) await db.prepare(sql).run();
    await db.prepare("INSERT INTO import_gateway_identity VALUES(1,?,?)").bind(config.IMPORT_GATEWAY_DATABASE_NAME, config.IMPORT_GATEWAY_DATABASE_ID).run();
    await db.prepare("INSERT INTO import_gate_lease VALUES(1,'fdci','2099-01-01T00:00:00Z','2026-01-01T00:00:00Z',?)").bind(config.IMPORT_GATE_RUN_ID).run();
    for (const phase of scenario.count === 5 ? ["new", "unchanged", "changed"] : ["new"]) {
      if (phase === "changed") data.courses[0].nombre = "Curso ficticio actualizado";
      const d1 = { queries: 0, roundTrips: 0, rowsRead: 0, rowsWritten: 0 }, requestMs = [], publicationAcks = [];
      const source = async (url, init) => {
        assert.equal(new URL(url).hostname, "apicapacitaciones.educaciontuc.edu.ar");
        if (String(url).endsWith("getCapaActivas")) return Response.json(data.commissions);
        if (String(url).endsWith("getRestoCapas")) return Response.json(data.courses);
        const course = data.courses.find(c => c.token === JSON.parse(init.body).token);
        return Response.json({ comisiones: data.commissions.filter(c => c.capacitacion_id === course.capacitacion_id) });
      };
      const receiver = async (url, init) => {
        const start = performance.now(), response = await mf.dispatchFetch(url, init);
        requestMs.push(performance.now() - start);
        assert.equal(response.status, 200);
        const measured = JSON.parse(response.headers.get("x-local-d1"));
        for (const key of Object.keys(d1)) d1[key] += measured[key];
        if (new URL(url).pathname.endsWith("fdci-import")) {
          assert.equal(JSON.parse(init.body).items.length, 1);
          publicationAcks.push(await response.clone().json());
        }
        return response;
      };
      const start = performance.now();
      const r = await runGatewayImport(resolveGatewayConfig(config), { ...config, FDCI_MAX_PUBLICATIONS: String(scenario.limit) }, source, receiver);
      assert.ok(r.examined <= scenario.limit); assert.ok(r.sourceRequests <= 6);
      assert.equal(r.created + r.updated + r.unchanged, r.batches);
      if (phase === "unchanged") {
        assert.equal(r.unchanged, 5); assert.ok(publicationAcks.every(a => a.rowsWritten === 0));
      }
      if (phase === "changed") assert.equal(r.updated, 5);
      gatewayMeasurements.push({ ...scenario, phase, elapsedMs: performance.now() - start,
        gatewayRequests: requestMs.length, gatewayMedianRoundTripMs: median(requestMs), d1,
        publicationRowsWritten: publicationAcks.reduce((n, a) => n + a.rowsWritten, 0),
        examined: r.examined, created: r.created, updated: r.updated, unchanged: r.unchanged,
        rejected: r.rejected, skipped: r.skipped, pending: r.deferred || 0, sourceRequests: r.sourceRequests,
        cycleComplete: r.cycleComplete, status: r.status });
    }
    assert.equal(outbound, 0);
  } finally { await mf.dispose(); }
}
const report = { at: new Date().toISOString(), nodeVersion: process.version, platform: process.platform,
  synthetic: true, remoteOperations: 0, nodeMeasurements, gatewayMeasurements,
  boundary: await checkFdciHybridBoundary(),
  warning: "Local Node process CPU (coarse Windows resolution: zero is not zero CPU) and loopback wall time only; no Cloudflare CPU measurement. Gateway runs exclude startup, lease opening/closing and automation facade. D1 metrics are local Workerd, not billed remote usage." };
mkdirSync(".wrangler", { recursive: true });
writeFileSync(".wrangler/fdci-hybrid-capacity-local.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
