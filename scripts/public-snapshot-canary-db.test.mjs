import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { captureCanaryBaseline, runCanarySql, splitSql, validateCanaryTarget } from './public-snapshot-canary-db.mjs';

const require=createRequire(import.meta.url);
const {build}=require('../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild');
const {Miniflare}=require('../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare');
const config=JSON.parse(readFileSync('wrangler.1.2-public-snapshot-canary.jsonc','utf8'));
const identity={database_name:'docentetuc-sources-canary-1-2',database_id:'0979f2c2-0e96-4b5c-811b-adcccc2dbd6d'};

test('fixed Canary config, trigger-aware SQL splitting, actual D1 identity and fail-closed responses',async()=>{
  validateCanaryTarget(config);
  assert.throws(()=>validateCanaryTarget({...config,name:'docentetuc'}));
  const sql=readFileSync('migrations/0101_public_snapshot_revision.sql','utf8');
  const triggers=splitSql(sql).filter(statement=>/^CREATE TRIGGER/i.test(statement));
  assert.equal(triggers.length,6);
  assert.ok(triggers.every(statement=>/BEGIN[\s\S]*;[\s\S]*END$/i.test(statement)));

  const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:`
    import {DurableObject} from 'cloudflare:workers';
    import {PublicSnapshot as CanarySnapshot} from './lib/public-snapshot-canary.ts';
    export class PublicSnapshot extends DurableObject {
      constructor(ctx,env){super(ctx,env);this.impl=new CanarySnapshot(ctx,env)}
      fetch(request){return this.impl.fetch(request)}
      inspect(){return this.ctx.storage.list()}
    }
    export default {fetch(request,env){return env.PUBLIC_SNAPSHOT.get(env.PUBLIC_SNAPSHOT.idFromName('public-app-v1')).fetch(request)}};
  `},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['node:buffer','cloudflare:workers'],
    plugins:[{name:'alias',setup(b){b.onResolve({filter:/^@\//},a=>({path:resolve(process.cwd(),a.path.slice(2)+'.ts')}));}}]});
  const persist=mkdtempSync(join(tmpdir(),'fdci-db-cycle-'));
  const options={modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],
    d1Databases:['DB'],d1Persist:join(persist,'d1'),durableObjectsPersist:join(persist,'do'),
    durableObjects:{PUBLIC_SNAPSHOT:{className:'PublicSnapshot',useSQLite:true}},
    bindings:{PUBLIC_SNAPSHOT_CANARY_SECRET:'synthetic',JUNTAS_CANARY_DATABASE_ID:identity.database_id,
      PUBLIC_SNAPSHOT_CANARY_UNTIL:new Date(Date.now()-1000).toISOString(),DB:null}};
  const mf=new Miniflare(options);
  try{
    const db=await mf.getD1Database('DB');
    const run=async statement=>{const result=await db.prepare(statement).run();assert.equal(result.success,true,statement);return result;};
    for(const statement of splitSql(readFileSync('lib/fixtures/juntas-production-schema-20261121.sql','utf8')))await run(statement);
    await run('INSERT INTO import_gateway_identity VALUES(1,\'docentetuc-sources-canary-1-2\',\'0979f2c2-0e96-4b5c-811b-adcccc2dbd6d\')');
    await run("INSERT INTO publications(id,source,external_id,kind,category,title,official_url,content_hash) VALUES('historic:1','Padrones','historic:1','junta','Histórico','Registro histórico','https://example.invalid/historic','historic-hash')");
    for(const statement of splitSql(`CREATE TRIGGER historical_pub_insert AFTER INSERT ON publications BEGIN SELECT 1; END;
      CREATE TRIGGER historical_pub_update AFTER UPDATE ON publications BEGIN SELECT 1; END;
      CREATE TRIGGER historical_pub_delete AFTER DELETE ON publications BEGIN SELECT 1; END;`))await run(statement);
    let baseline=await captureCanaryBaseline({config,database:db});

    await run("UPDATE import_gateway_identity SET database_id='wrong' WHERE id=1");
    let attempted=0;
    await assert.rejects(runCanarySql({config,database:db,phase:'migrations',baseline}),/destination ID mismatch/);
    assert.equal(attempted,0);
    await run(`UPDATE import_gateway_identity SET database_id='${identity.database_id}' WHERE id=1`);

    const calls=[];
    const faultyDatabase={prepare(sql){const statement=db.prepare(sql);return {first:()=>statement.first(),all:()=>statement.all(),run:async()=>{
      calls.push(sql);if(calls.length===2)return {success:false,error:'synthetic SQL failure'};return statement.run();
    }}}};
    await assert.rejects(runCanarySql({config,database:faultyDatabase,phase:'migrations',baseline}),
      error=>error.completed.length===1&&/ambiguous/.test(error.message));
    assert.equal(calls.length,2);
    await run('DROP TABLE fdci_import_checkpoint');
    baseline=await captureCanaryBaseline({config,database:db});

    const migrations=await runCanarySql({config,database:db,phase:'migrations',baseline});
    assert.equal(migrations.statements,10);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND name LIKE 'public_snapshot_%'").first()).n,6);
    const inserted=await runCanarySql({config,database:db,phase:'fixture',baseline});
    assert.equal(inserted.statements,1);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM publications WHERE id LIKE 'fdci:canary:snapshot:20261127:%'").first()).n,152);

    const close=async()=>mf.dispatchFetch('https://canary.local/__fdci_public_snapshot_canary_close',{method:'POST',headers:{'X-DT-Canary-Secret':'synthetic'}});
    const restored=await runCanarySql({config,database:db,phase:'restore',baseline,closeCanary:async()=>{
      const response=await close();assert.equal(response.status,200);assert.equal((await response.clone().json()).closed,true);
      const namespace=await mf.getDurableObjectNamespace('PUBLIC_SNAPSHOT');
      const stub=namespace.get(namespace.idFromName('public-app-v1'));
      assert.equal((await stub.inspect()).size,0);
      return response;
    }});
    assert.equal(restored.statements,9);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM publications').first()).n,baseline.publicationCount);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='trigger'").first()).n,3);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name IN ('fdci_import_checkpoint','public_snapshot_revision')").first()).n,0);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND name LIKE 'historical_pub_%'").first()).n,3);
  }finally{await mf.dispose();rmSync(persist,{recursive:true,force:true});}
});
