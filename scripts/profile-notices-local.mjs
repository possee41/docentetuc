// Manual comparison only: ephemeral D1, synthetic secrets, no Cloudflare API.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { connectWorkerdCpuProfiler } from "./workerd-cpu-profiler.mjs";

const require = createRequire(import.meta.url);
const { Miniflare } = require("../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare");
const { build } = require("../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild");
const migrations = ["drizzle/0000_docentetuc.sql", "drizzle/0001_training_metadata.sql",
  "drizzle/0002_reminders_ai.sql", "drizzle/0003_web_push.sql", "migrations/0002_designations.sql",
  "migrations/0003_information_agenda.sql", "migrations/0004_agenda_reminders.sql",
  "migrations/0006_manual_events.sql", "migrations/0007_manual_event_recurrence.sql",
  "migrations/0008_personal_matching_circuits.sql", "migrations/0009_reliability_lifecycle.sql",
  "migrations/0029_import_gateway_identity.sql"];
const baseline = execFileSync("git", ["show", "4e2b237:scripts/external-reminders.mjs"], { encoding: "utf8" });
const databaseId = "11111111-1111-4111-8111-111111111111";
const secret = "synthetic_local_notices_secret_1234567890";
const source = `
  import worker from "./workers/notices-receiver.mjs";
  export default { async fetch(request, env) {
    const metrics = { rpc: 0, queries: 0, rowsRead: 0, rowsWritten: 0 };
    const record = r => { metrics.queries++; metrics.rowsRead += r.meta.rows_read;
      metrics.rowsWritten += r.meta.rows_written; return r; };
    const wrap = stmt => ({ raw: stmt, bind(...args) { return wrap(stmt.bind(...args)); },
      async all() { metrics.rpc++; return record(await stmt.all()); },
      async first() { metrics.rpc++; return record(await stmt.all()).results[0] || null; },
      async run() { metrics.rpc++; return record(await stmt.run()); } });
    const db = { prepare(sql) { return wrap(env.DB.prepare(sql)); },
      async batch(statements) { metrics.rpc++; return (await env.DB.batch(statements.map(s=>s.raw))).map(record); } };
    const start = performance.now();
    const response = await worker.fetch(request, { ...env, DB: db });
    return Response.json({ http: response.status, ack: await response.json(), metrics, wallMs: performance.now()-start });
  } };`;
const bundles = new Map();
for (const variant of ["baseline", "current"]) {
  const bundle = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: "ts" },
    bundle: true, write: false, format: "esm", platform: "browser", target: "es2022",
    plugins: variant === "baseline" ? [{ name: "baseline-reminders", setup(bundler) {
      bundler.onLoad({ filter: /[\\/]scripts[\\/]external-reminders\.mjs$/ }, () =>
        ({ contents: baseline, loader: "js", resolveDir: resolve("scripts") }));
    } }] : [] });
  bundles.set(variant, bundle.outputFiles[0].text);
}
const results = [];
const baselineOnly = process.argv.includes("--baseline-only");
for (let round = 0; round < (baselineOnly ? 1 : 3); round++) for (const variant of baselineOnly ? ["baseline"] : ["baseline", "current"]) {
  const mf = new Miniflare({ modules: true, script: bundles.get(variant), d1Databases: ["DB"],
    inspectorHost: "127.0.0.1", inspectorPort: 0,
    bindings: { NOTICES_ENABLED: "true", NOTICES_IMPORT_SECRET: secret,
      NOTICES_DATABASE_NAME: "docentetuc-notices-canary-1-2", NOTICES_DATABASE_ID: databaseId },
    outboundService: () => { throw new Error("REMOTE_REQUEST_FORBIDDEN"); },
  });
  let profiler;
  try {
    const db = await mf.getD1Database("DB");
    const seed = readFileSync(new URL("./notices-canary-seed.sql", import.meta.url), "utf8")
      .replaceAll("bee24175-2591-4fe3-a4ed-deb7f680f615", databaseId);
    for (const text of [...migrations.map(file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8")), seed])
      for (const sql of text.replace(/^--.*$/gm, "").split(";").map(s => s.trim()).filter(Boolean))
        await db.prepare(sql).run();
    profiler = await connectWorkerdCpuProfiler(await mf.getInspectorURL());
    for (const phase of ["firstAuthenticated", "subsequentAuthenticated"]) {
      if (phase === "subsequentAuthenticated") for (const sql of [
        "DELETE FROM notifications", "DELETE FROM manual_event_push_queue",
        "UPDATE training_reminders SET notified=0", "UPDATE designation_tracking SET reminder_notified=0",
        "UPDATE saved_publications SET agenda_reminder_notified=0", "UPDATE manual_events SET reminder_notified=0",
      ]) await db.prepare(sql).run();
      const measured = await profiler.measure(() => mf.dispatchFetch("http://local/api/internal/notices/reminders", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
        body: JSON.stringify({ mode: "reminders", limit: 4 }),
      }));
      const result = await measured.value.json();
      assert.equal(result.http, 200);
      assert.deepEqual(result.ack, { ok: true, considered: 4, inserted: 4, processed: 4 });
      assert.equal((await db.prepare("SELECT count(*) AS n FROM notifications").first()).n, 3);
      assert.equal((await db.prepare("SELECT count(*) AS n FROM manual_event_push_queue").first()).n, 1);
      const row = { variant, round, phase, ...result, sampledCpu: measured.cpu };
      results.push(row);
      console.log(JSON.stringify(row));
    }
  } finally { profiler?.close(); await mf.dispose(); }
}
const median = values => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const summary = ["baseline", "current"].flatMap(variant => ["firstAuthenticated", "subsequentAuthenticated"].flatMap(phase => {
  const rows = results.filter(r=>r.variant===variant && r.phase===phase);
  return rows.length ? [{ variant, phase, invocations: rows.length,
    rpc: rows.map(r=>r.metrics.rpc), queries: rows.map(r=>r.metrics.queries), rowsRead: rows.map(r=>r.metrics.rowsRead),
    rowsWritten: rows.map(r=>r.metrics.rowsWritten), medianWallMs: median(rows.map(r=>r.wallMs)),
    medianActiveSampledMs: median(rows.map(r=>r.sampledCpu.activeSampledMs)),
    lowResolutionProfiles: rows.filter(r=>r.sampledCpu.lowResolution).length }] : [];
}));
const report = { results, summary, note: "Sampled local CPU, not billed Cloudflare CPU; first authenticated excludes deployment/startup." };
writeFileSync(".wrangler/notices-cpu-local-profile.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ summary, note: report.note }));
