// Executes the actual /api/personalized handler in Workerd with synthetic auth and ephemeral D1.
// --profile uses sampled CDP CPU; wallMs is elapsed time, never billed CPU.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { connectWorkerdCpuProfiler } from "./workerd-cpu-profiler.mjs";

const require = createRequire(import.meta.url);
const { build } = require("../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild");
const { Miniflare } = require("../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare");
const profile = process.argv.includes("--profile");
const source = `
import { GET } from "./app/api/personalized/route.ts";
function measured(db, metrics) {
  const wrap = statement => ({ bind(...args) { return wrap(statement.bind(...args)); },
    async all() { const result = await statement.all(); metrics.queries++; metrics.rowsRead += result.meta?.rows_read || 0; metrics.rowsWritten += result.meta?.rows_written || 0; return result; },
    async first() { const result = await statement.all(); metrics.queries++; metrics.rowsRead += result.meta?.rows_read || 0; metrics.rowsWritten += result.meta?.rows_written || 0; return result.results[0] || null; } });
  return { prepare(sql) { return wrap(db.prepare(sql)); } };
}
export default { async fetch(request, env) {
  const metrics = { queries: 0, rowsRead: 0, rowsWritten: 0 };
  globalThis.__benchDb = measured(env.DB, metrics);
  const start = performance.now();
  const response = await GET(request);
  const body = await response.json();
  return Response.json({ status: response.status, body, metrics, wallMs: performance.now() - start });
} };`;
const bundle = await build({ stdin: { contents: source, resolveDir: process.cwd(), sourcefile: "personalized-bench-worker.ts", loader: "ts" },
  bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", plugins: [{ name: "isolated-bindings", setup(bundler) {
    bundler.onResolve({ filter: /^@\/db$/ }, () => ({ path: "db", namespace: "isolated" }));
    bundler.onResolve({ filter: /^@\/lib\/current-user$/ }, () => ({ path: "user", namespace: "isolated" }));
    bundler.onLoad({ filter: /.*/, namespace: "isolated" }, args => ({ contents: args.path === "db"
      ? "export const getD1 = () => globalThis.__benchDb;"
      : "export const currentUser = async request => { if (request.headers.get('x-test-user') !== 'test') throw new Error('UNAUTHENTICATED'); return { userId: 'test' }; }; export const authError = error => error?.message === 'UNAUTHENTICATED';" }));
    bundler.onResolve({ filter: /^@\// }, args => ({ path: resolve(process.cwd(), `${args.path.slice(2)}.ts`) }));
  } }] });
const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, d1Databases: ["DB"],
  ...(profile ? { inspectorHost: "127.0.0.1", inspectorPort: 9239 } : {}) });
let profiler;
try {
  const db = await mf.getD1Database("DB");
  await db.prepare(`CREATE TABLE publications(id TEXT PRIMARY KEY,kind TEXT,source TEXT,title TEXT,summary TEXT,level TEXT,area TEXT,junta TEXT,location TEXT,shift TEXT,character TEXT,metadata TEXT,status TEXT,normalized_status TEXT,starts_at TEXT,ends_at TEXT,official_url TEXT,updated_at TEXT)`).run();
  await db.prepare("CREATE TABLE profiles(user_id TEXT PRIMARY KEY,name TEXT,level TEXT,area TEXT,subjects TEXT,junta TEXT,roles TEXT,personal_match_threshold INTEGER)").run();
  await db.prepare("INSERT INTO profiles VALUES ('test','Test','Secundario','Matemática','Matemática','Secundario','Profesor de Matemática',85)").run();
  await db.prepare("CREATE INDEX idx_publications_kind_id ON publications(kind,id)").run();
  for (let start = 0; start < 7200; start += 900) await db.prepare(`WITH RECURSIVE n(i) AS (SELECT ? UNION ALL SELECT i+1 FROM n WHERE i<?)
    INSERT INTO publications SELECT 'p:' || printf('%04d',i), CASE WHEN i<3600 THEN 'vacante' ELSE 'capacitacion' END,
      CASE WHEN i<3600 THEN 'SIME' ELSE 'FDCI' END, CASE WHEN i<3600 THEN 'Escuela X - Profesor de Matemática' ELSE 'Matemática docente' END,
      'Prueba aislada','Secundario','Historia','Secundario','','','','{}','inscripción abierta','ACTIVE',
      '2026-10-20T09:00:00-03:00','2026-11-05T18:00:00-03:00','https://example.invalid/test','2026-10-26' FROM n`).bind(start, start + 899).run();
  const official = JSON.stringify({ official: { version: 1, entity: "opportunity", topics: ["INSCRIPCION_SIME"], sources: [], scope: {},
    facts: { publicationStart: { value: "2026-10-20T09:00:00-03:00", precision: "datetime" }, publicationEnd: { value: "2026-11-05T18:00:00-03:00", precision: "datetime" } }, abierto: true } });
  const training = JSON.stringify({ entity: "commission", trainingId: "test", registrationOpensAt: "2026-10-20T09:00:00-03:00",
    registrationClosesAt: "2026-11-05T18:00:00-03:00", dateStatus: "confirmed", registrationHasTime: true });
  for (const index of [500, 3500, 4000, 7199]) await db.prepare("UPDATE publications SET area='Matemática',metadata=? WHERE id=?")
    .bind(index < 3600 ? official : training, `p:${String(index).padStart(4, "0")}`).run();
  if (profile) profiler = await connectWorkerdCpuProfiler(await mf.getInspectorURL());
  const cases = [
    ["unauthorized", "vacante", "", false], ["first", "vacante", "", true],
    ["middle", "vacante", "p:0480", true], ["last", "capacitacion", "p:7080", true],
  ];
  for (const [name, kind, cursor, authorized] of cases) {
    const request = new Request(`http://local/api/personalized?kind=${kind}&cursor=${cursor}`, authorized ? { headers: { "x-test-user": "test" } } : undefined);
    const measured = profiler ? await profiler.measure(() => mf.dispatchFetch(request.url, { headers: request.headers }))
      : { value: await mf.dispatchFetch(request.url, { headers: request.headers }), cpu: null };
    const result = await measured.value.json();
    console.log(JSON.stringify({ name, status: result.status, ids: result.body.items?.map(item => item.id), scanned: result.body.scanned,
      nextCursor: result.body.nextCursor, ...result.metrics, wallMs: result.wallMs, sampledCpu: measured.cpu }));
  }
} finally { profiler?.close(); await mf.dispose(); }
