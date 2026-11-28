import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve } from 'node:path';
import test from 'node:test';
const require=createRequire(import.meta.url);
const {build}=require('../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild');
const {Miniflare}=require('../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare');
import { splitSql } from './public-snapshot-canary-db.mjs';

test('workerd serializes persistent DO transaction: exactly two of three concurrent GETs; restart preserves cap',async()=>{
  const bundled=await build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:`
    import {DurableObject} from 'cloudflare:workers';
    import {PublicSnapshot as CanarySnapshot} from './lib/public-snapshot-canary.ts';
    export class PublicSnapshot extends DurableObject { constructor(ctx,env){ super(ctx,env); this.impl=new CanarySnapshot(ctx,env); } fetch(req){ return this.impl.fetch(req); } inspect(){ return this.ctx.storage.get('canary:get-count'); } }
    export default {fetch(req,env){return env.PUBLIC_SNAPSHOT.get(env.PUBLIC_SNAPSHOT.idFromName('public-app-v1')).fetch(req)}};
  `},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['node:buffer','cloudflare:workers'],plugins:[{name:'alias',setup(b){b.onResolve({filter:/^@\//},a=>({path:resolve(process.cwd(),a.path.slice(2)+'.ts')}));}}]});
  const persist=mkdtempSync(join(tmpdir(),'fdci-workerd-'));
  const options={modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-05-15',
    compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],durableObjectsPersist:join(persist,'do'),d1Persist:join(persist,'d1'),
    durableObjects:{PUBLIC_SNAPSHOT:{className:'PublicSnapshot',useSQLite:true}},
    bindings:{PUBLIC_SNAPSHOT_CANARY_SECRET:'synthetic',JUNTAS_CANARY_DATABASE_ID:'0979f2c2-0e96-4b5c-811b-adcccc2dbd6d',
      PUBLIC_SNAPSHOT_CANARY_UNTIL:new Date(Date.now()+240000).toISOString(),DB:null}};
  let mf=new Miniflare(options);
  try{
    const db=await mf.getD1Database('DB');
    const sqlFiles=['lib/fixtures/juntas-production-schema-20261121.sql','migrations/0032_fdci_import_checkpoint.sql',
      'migrations/0101_public_snapshot_revision.sql','scripts/public-snapshot-canary-fixture.sql'];
    for(const statement of splitSql(readFileSync(sqlFiles[0],'utf8')))await db.prepare(statement).run();
    await db.prepare('INSERT INTO import_gateway_identity VALUES(1,?,?)').bind('docentetuc-sources-canary-1-2','0979f2c2-0e96-4b5c-811b-adcccc2dbd6d').run();
    await db.prepare(`WITH RECURSIVE existing(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM existing WHERE n<248)
      INSERT INTO publications(id,source,external_id,kind,category,title,official_url,content_hash)
      SELECT 'existing:'||n,'Padrones y Comunicados','existing:'||n,'junta','Canary histórico',
        'Publicación existente '||n,'https://example.invalid/existing/'||n,'existing:'||n FROM existing`).run();
    const checkpoint=readFileSync(sqlFiles[1],'utf8');
    for(const statement of splitSql(checkpoint))await db.prepare(statement).run();
    const revision=readFileSync(sqlFiles[2],'utf8').split('CREATE TRIGGER')[0];
    for(const statement of splitSql(revision))await db.prepare(statement).run();
    for(const statement of splitSql(readFileSync(sqlFiles[3],'utf8')))await db.prepare(statement).run();
    const responses=await Promise.all([mf.dispatchFetch('https://local.test/api/public-app'),mf.dispatchFetch('https://local.test/api/public-app'),mf.dispatchFetch('https://local.test/api/public-app')]);
    assert.deepEqual(responses.map(r=>r.status).sort(),[200,200,404]);
    const bodies=await Promise.all(responses.filter(r=>r.status===200).map(r=>r.json()));
    assert.ok(bodies.every(body=>body.publications.length===400),JSON.stringify(bodies.map(body=>Object.fromEntries(Object.entries(body).map(([k,v])=>[k,Array.isArray(v)?v.length:typeof v])))));
    const ns=await mf.getDurableObjectNamespace('PUBLIC_SNAPSHOT');
    const stub=ns.get(ns.idFromName('public-app-v1'));
    const count=await stub.inspect();
    assert.equal(count,2);
    await mf.dispose();
    mf=new Miniflare(options);
    const restarted=await mf.getDurableObjectNamespace('PUBLIC_SNAPSHOT');
    const restartedStub=restarted.get(restarted.idFromName('public-app-v1'));
    assert.equal(await restartedStub.inspect(),2);
    assert.equal((await mf.dispatchFetch('https://local.test/api/public-app')).status,404);
  } finally { await mf.dispose(); rmSync(persist,{recursive:true,force:true}); }
});
