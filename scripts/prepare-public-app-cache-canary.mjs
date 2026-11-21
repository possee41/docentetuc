// Local preparation only. Builds the real GET handler, never calls Wrangler/fetch.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { build } = require("../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild");
const root = resolve(import.meta.dirname, "..");
const config = JSON.parse(readFileSync(resolve(root, "wrangler.1.2-web-canary.remote.jsonc"), "utf8"));
assert.equal(config.name, "docentetuc-web-canary-1-2");
assert.deepEqual(config.d1_databases, [{ binding: "DB", database_name: "docentetuc-web-canary-1-2", database_id: "853e2f5d-89b1-46a3-9c1c-5cbd46784756" }]);
assert.ok(!config.routes && !config.route && !config.triggers?.crons?.length);
const output = resolve(root, ".wrangler/public-app-cache-canary");
mkdirSync(output, { recursive: true });
const result = await build({ stdin: { resolveDir: root, loader: "ts", contents: `
  import {GET} from './app/api/public-app/route.ts';
  import {APP_PUBLICATIONS_QUERY} from './lib/app-publications-query.ts';
  import {storage} from 'public-cache-test-context';
  const syncSQL='SELECT source, synced_at, last_attempt_at, last_successful_sync_at, sync_status FROM sync_state ORDER BY source';
  const closed=()=>new Response('CACHE_TEST_CLOSED',{status:503,headers:{'Cache-Control':'no-store'}});
  export default {async fetch(request,env){
    const remaining=Date.parse(env.PUBLIC_CACHE_TEST_UNTIL||'')-Date.now();
    if(env.PUBLIC_CACHE_TEST_ENABLED!=='true'||!env.DB||!(remaining>0&&remaining<=300000)
      ||env.PUBLIC_CACHE_TEST_DATABASE_ID!=='853e2f5d-89b1-46a3-9c1c-5cbd46784756'
      ||env.PUBLIC_APP_CACHE_ENABLED!=='1'||!env.VERSION_METADATA?.id
      ||!/^cache-[a-z0-9-]{1,50}$/.test(env.PUBLIC_CACHE_TEST_RUN_ID||'')) return closed();
    const url=new URL(request.url),step=request.headers.get('x-public-cache-test-step');
    if(request.method!=='GET'||url.pathname!=='/api/public-app'||url.search
      ||request.headers.get('x-public-cache-test-run')!==env.PUBLIC_CACHE_TEST_RUN_ID
      ||!['miss','hit','expired'].includes(step)) return new Response('NOT_FOUND',{status:404});
    const metrics={queries:0,rowsRead:0,rowsWritten:0,statements:[]};
    const db={prepare(sql){
      const label=sql===APP_PUBLICATIONS_QUERY?'publications':sql===syncSQL?'sync':null;
      if(!label) throw new Error('CACHE_TEST_SQL_DENIED');
      return {async all(){
        metrics.queries++;
        const result=await env.DB.prepare(sql).all(),m=result.meta;
        if(!Number.isSafeInteger(m?.rows_read)||m.rows_read<0||m?.rows_written!==0) throw new Error('CACHE_TEST_D1_META_INVALID');
        metrics.rowsRead+=m.rows_read;metrics.rowsWritten+=m.rows_written;
        metrics.statements.push({label,rowsRead:m.rows_read,rowsWritten:m.rows_written});
        return result;
      }};
    }};
    let response;
    try {response=await storage.run(db,()=>GET(request));}catch{return closed();}
    const versionId=env.VERSION_METADATA.id,cache=response.headers.get('X-Public-App-Cache');
    console.log(JSON.stringify({event:'public_app_cache_canary',runId:env.PUBLIC_CACHE_TEST_RUN_ID,step,versionId,status:response.status,cache,d1:metrics}));
    const headers=new Headers(response.headers);
    headers.set('X-Public-Cache-Test-Version',versionId);
    headers.set('X-Public-Cache-Test-Queries',String(metrics.queries));
    headers.set('X-Public-Cache-Test-Rows-Read',String(metrics.rowsRead));
    headers.set('X-Public-Cache-Test-Rows-Written',String(metrics.rowsWritten));
    return new Response(response.body,{status:response.status,headers});
  }};` }, bundle: true, write: false, platform: "browser", format: "esm", target: "es2022",
  external: ["cloudflare:workers", "node:async_hooks"], plugins: [{ name: "public-cache-measured-db", setup(b) {
    b.onResolve({ filter: /^@\/db$|^public-cache-test-context$/ }, a => ({ path: a.path, namespace: "measured" }));
    b.onLoad({ filter: /.*/, namespace: "measured" }, a => ({ contents: a.path === "@/db"
      ? "import {storage} from 'public-cache-test-context'; export const getD1=()=>{const db=storage.getStore();if(!db)throw new Error('CACHE_TEST_NO_CONTEXT');return db};"
      : "import {AsyncLocalStorage} from 'node:async_hooks';export const storage=new AsyncLocalStorage();" }));
    b.onResolve({ filter: /^@\// }, a => ({ path: resolve(root, a.path.slice(2) + ".ts") }));
  } }] });
writeFileSync(resolve(output, "worker.mjs"), result.outputFiles[0].text);
writeFileSync(resolve(output, "wrangler.jsonc"), JSON.stringify({
  name: config.name, account_id: "6bbc3dae7e111660f0c835677ceffb69", main: "worker.mjs",
  compatibility_date: config.compatibility_date, compatibility_flags: ["nodejs_compat"], workers_dev: true, preview_urls: false, keep_vars: false,
  version_metadata: { binding: "VERSION_METADATA" }, observability: { enabled: true, head_sampling_rate: 1 },
  triggers: { crons: [] }, d1_databases: config.d1_databases,
  vars: { PUBLIC_CACHE_TEST_ENABLED: "false", PUBLIC_CACHE_TEST_UNTIL: "", PUBLIC_CACHE_TEST_RUN_ID: "",
    PUBLIC_CACHE_TEST_DATABASE_ID: config.d1_databases[0].database_id,
    PUBLIC_APP_CACHE_ENABLED: "0", PUBLIC_APP_CACHE_VERSION: "cache-canary-not-opened",
    AI_WEB_SEARCH_ENABLED: "0", PUSH_DISPATCH_MODE: "disabled", LEGACY_SYNC_PAUSED: "true" },
}, null, 2) + "\n");
console.log("Prepared locally: .wrangler/public-app-cache-canary/wrangler.jsonc (closed, no remote actions)");
