// Actual handler + Workerd Cache API + ephemeral D1. No Wrangler/remote resources.
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { build } = require("../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild");
const { Miniflare } = require("../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare");

test("public-app: caché real aislada, privacidad, expiración y consumo D1", async (t) => {
  const bundled = await build({ stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
    import {GET} from './app/api/public-app/route.ts';
    const realNow=Date.now, started=realNow();
    export default {async fetch(request,env){
      if(request.method!=='GET') return new Response('Method not allowed',{status:405});
      const metrics={queries:0,rowsRead:0,rowsWritten:0};
      Date.now=()=>started+Number(request.headers.get('x-test-offset')||0);
      globalThis.__settings={PUBLIC_APP_CACHE_ENABLED:request.headers.get('x-test-enabled')||'1',
        PUBLIC_APP_CACHE_VERSION:request.headers.get('x-test-version')||'default'};
      globalThis.__db={prepare(sql){
        if(!sql.includes('FROM publications')&&!sql.includes('FROM sync_state')) throw new Error('PRIVATE_TABLE_QUERY');
        return {async all(){metrics.queries++;
          if(request.headers.has('x-test-d1-failure')) throw new Error('SYNTHETIC_D1_FAILURE');
          const r=await env.DB.prepare(sql).all();
          metrics.rowsRead+=r.meta.rows_read;metrics.rowsWritten+=r.meta.rows_written;return r;
        }};
      }};
      const start=performance.now(),response=await GET(request),body=await response.json();
      const result={status:response.status,body,headers:Object.fromEntries(response.headers),metrics,wallMs:performance.now()-start};
      if(request.headers.has('x-test-inspect')){
        const u=new URL(request.url),key=new Request(u.origin+'/api/public-app?__cache='+globalThis.__settings.PUBLIC_APP_CACHE_VERSION);
        const stored=await caches.default.match(key);
        result.stored=stored?{body:await stored.json(),headers:Object.fromEntries(stored.headers),keyHeaders:[...key.headers]}:null;
      }
      return Response.json(result);
    }};` }, bundle: true, write: false, format: "esm", platform: "browser", target: "es2022",
    plugins: [{ name: "local-bindings", setup(b) {
      b.onResolve({ filter: /^@\/db$|^cloudflare:workers$/ }, args => ({ path: args.path, namespace: "local" }));
      b.onLoad({ filter: /.*/, namespace: "local" }, args => ({ contents: args.path === "@/db"
        ? "export const getD1=()=>globalThis.__db;"
        : "export const env=new Proxy({},{get:(_,key)=>globalThis.__settings[key]});" }));
      b.onResolve({ filter: /^@\// }, args => ({ path: resolve(process.cwd(), args.path.slice(2) + ".ts") }));
    } }] });
  const mf = new Miniflare({ modules: true, script: bundled.outputFiles[0].text, d1Databases: ["DB"],
    cachePersist: false, d1Persist: false });
  try {
    const db = await mf.getD1Database("DB");
    await db.prepare(`CREATE TABLE publications(id TEXT PRIMARY KEY,kind TEXT,source TEXT,title TEXT,summary TEXT,
      metadata TEXT,starts_at TEXT,ends_at TEXT,updated_at TEXT)`).run();
    await db.prepare(`WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM n WHERE i<7199)
      INSERT INTO publications SELECT printf('test:%05d',i),CASE WHEN i%4=0 THEN 'informacion' WHEN i%4=1 THEN 'capacitacion' WHEN i%4=2 THEN 'vacante' ELSE 'junta' END,
      'Fuente sintética','Publicación pública '||i,'Solo información pública','{}',NULL,NULL,'2026-10-30T00:00:00Z' FROM n`).run();
    await db.prepare("CREATE TABLE sync_state(source TEXT,synced_at TEXT,last_attempt_at TEXT,last_successful_sync_at TEXT,sync_status TEXT,error_message TEXT)").run();
    await db.prepare("INSERT INTO sync_state VALUES('Fuente sintética',NULL,'2026-10-30',NULL,'PARTIAL','PRIVATE_DIAGNOSTIC')").run();
    await db.prepare("CREATE TABLE profiles(user_id TEXT,name TEXT)").run();
    await db.prepare("INSERT INTO profiles VALUES('A','PRIVATE_PROFILE_A'),('B','PRIVATE_PROFILE_B')").run();
    await db.prepare("CREATE TABLE manual_events(user_id TEXT,title TEXT)").run();
    await db.prepare("INSERT INTO manual_events VALUES('A','PRIVATE_EVENT_A')").run();
    const call = async (version, headers = {}, suffix = "") => {
      const start = performance.now();
      const r = await mf.dispatchFetch("https://public-cache.test/api/public-app" + suffix,
        { headers: { "x-test-version": version, ...headers } });
      const value = await r.json();
      value.clientWallMs = performance.now() - start;
      return value;
    };
    const state = r => r.headers["x-public-app-cache"];
    const privacy = r => {
      assert.equal(r.body.profile, null); assert.equal(r.body.publicProfile, null);
      for (const field of ["saved", "notifications", "reminders", "designations", "manualEvents"]) assert.deepEqual(r.body[field], []);
      assert.doesNotMatch(JSON.stringify(r.body), /PRIVATE_|synthetic-cookie|synthetic-token/);
      assert.equal(r.headers["cache-control"], "no-store");
      assert.equal(r.headers["set-cookie"], undefined);
    };
    let original;
    await t.test("MISS y HIT: mismo contrato público, sin datos/headers de dos usuarios", async () => {
      original = await call("privacy", { cookie: "session=synthetic-cookie-A", authorization: "Bearer synthetic-token-A", "x-docentetuc-device": "synthetic-device-A", "x-test-inspect": "1" });
      assert.equal(original.status, 200); assert.equal(state(original), "MISS"); assert.equal(original.metrics.queries, 2);
      assert.equal(original.body.publications.length, 400); privacy(original);
      assert.deepEqual(original.stored.body, original.body);
      assert.deepEqual(original.stored.keyHeaders, []);
      assert.equal(original.stored.headers["set-cookie"], undefined);
      assert.equal(original.stored.headers["cache-control"], "public, max-age=60");
      assert.equal(original.headers["x-public-app-cache-expires"], undefined);
      const hit = await call("privacy", { cookie: "session=synthetic-cookie-B", authorization: "Bearer synthetic-token-B" });
      assert.equal(state(hit), "HIT"); assert.deepEqual(hit.body, original.body); privacy(hit);
      assert.deepEqual(hit.metrics, { queries: 0, rowsRead: 0, rowsWritten: 0 });
    });
    await t.test("parámetros desconocidos, métodos y otras rutas no crean entradas", async () => {
      const first = await call("params");
      for (const suffix of ["?junta=primaria", "?junta=secundaria", "?__cache=poison"]) {
        const r = await call("params", {}, suffix);
        assert.equal(state(r), "BYPASS"); assert.equal(r.metrics.queries, 2); assert.deepEqual(r.body, first.body);
      }
      assert.equal(state(await call("params")), "HIT");
      assert.equal((await mf.dispatchFetch("https://public-cache.test/api/public-app", { method: "POST" })).status, 405);
      const other = await mf.dispatchFetch("https://public-cache.test/api/app");
      assert.equal(state(await other.json()), "BYPASS");
      const otherOrigin = await mf.dispatchFetch("https://other-cache.test/api/public-app", { headers: { "x-test-version": "params" } });
      assert.equal(state(await otherOrigin.json()), "MISS");
    });
    await t.test("TTL de 60 s: no se renueva al leer; actualización al límite", async () => {
      await call("expiry");
      await db.prepare("UPDATE publications SET title='Contenido público actualizado'").run();
      const inside = await call("expiry", { "x-test-offset": "59999" });
      assert.equal(state(inside), "HIT"); assert.deepEqual(inside.body, original.body);
      const expired = await call("expiry", { "x-test-offset": "60000" });
      assert.equal(state(expired), "MISS"); assert.equal(expired.metrics.queries, 2);
      assert.ok(expired.body.publications.every(p => p.title === "Contenido público actualizado"));
      assert.equal(state(await call("expiry", { "x-test-offset": "60001" })), "HIT");
    });
    await t.test("errores D1 no se almacenan y no hay fallback a caché vencida", async () => {
      const failed = await call("errors", { "x-test-d1-failure": "1", "x-test-inspect": "1" });
      assert.equal(failed.status, 503); assert.equal(failed.stored, null);
      assert.equal(failed.headers["cache-control"], "no-store");
      assert.equal(state(await call("errors")), "MISS");
      const expired = await call("errors", { "x-test-offset": "60000", "x-test-d1-failure": "1" });
      assert.equal(expired.status, 503);
      assert.equal(state(await call("errors", { "x-test-offset": "60000" })), "MISS");
    });
    await t.test("apagado evita lectura y escritura de caché; versión invalida", async () => {
      await call("switch");
      for (const enabled of ["0", "false"]) {
        const r = await call("switch", { "x-test-enabled": enabled });
        assert.equal(state(r), "BYPASS"); assert.equal(r.metrics.queries, 2);
      }
      assert.equal(state(await call("switch-new", { "x-test-inspect": "1" })), "MISS");
      const off = await call("switch-off", { "x-test-enabled": "0", "x-test-inspect": "1" });
      assert.equal(off.stored, null);
    });
    await t.test("medición comparable: 5 lecturas sin caché frente a MISS + 4 HIT", async () => {
      const before = [], after = [];
      for (let i = 0; i < 5; i++) before.push(await call("bench", { "x-test-enabled": "0" }));
      for (let i = 0; i < 5; i++) after.push(await call("bench"));
      const summarize = samples => ({ requests: samples.length,
        queries: samples.reduce((sum, r) => sum + r.metrics.queries, 0),
        rowsRead: samples.reduce((sum, r) => sum + r.metrics.rowsRead, 0),
        rowsWritten: samples.reduce((sum, r) => sum + r.metrics.rowsWritten, 0),
        medianHandlerWallMs: samples.map(r => r.wallMs).sort((a,b) => a-b)[2],
        medianClientWallMs: samples.map(r => r.clientWallMs).sort((a,b) => a-b)[2],
        cache: samples.map(state) });
      const b = summarize(before), a = summarize(after);
      assert.equal(b.queries, 10); assert.equal(a.queries, 2);
      assert.equal(a.rowsRead * 5, b.rowsRead); assert.equal(a.rowsWritten, 0);
      for (const r of [...before, ...after]) { assert.deepEqual(r.body, before[0].body); privacy(r); }
      console.log(JSON.stringify({ syntheticPublications: 7200, before: b, after: a, cpu: "not measured", workerInvocationsSaved: 0 }));
    });
  } finally { await mf.dispose(); }
});
