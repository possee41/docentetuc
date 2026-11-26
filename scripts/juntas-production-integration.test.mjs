import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {spawnSync} from 'node:child_process';
import {stripTypeScriptTypes,createRequire} from 'node:module';
import {boardPageQuery} from '../lib/board-page.ts';
import {OFFICIAL_JUNTAS} from '../lib/juntas.ts';
import {padronesPage,boardPage,boardRevisions} from '../lib/juntas-public-api.ts';
import {juntasProductionConfig,runJuntasProduction,JUNTAS_PRODUCTION_ORIGIN} from './juntas-production.mjs';
import receiver from '../workers/juntas-production.mjs';

const base='85c4a912c346bb480e5707639e3a82ae48a5b866';
const sha='a'.repeat(40),secret='synthetic_juntas_only_'.padEnd(48,'x');
const config={JUNTAS_APPROVED_SHA:sha,JUNTAS_PRODUCTION_ENABLED:'true',JUNTAS_SCHEMA_READY:'true',
  JUNTAS_DATABASE_ID:'baaf5886-0123-4948-96da-aa7106424549',JUNTAS_DATABASE_NAME:'docentetuc-db',
  JUNTAS_RECEIVER_ORIGIN:JUNTAS_PRODUCTION_ORIGIN,JUNTAS_IMPORT_SECRET:secret,GOOGLE_DRIVE_API_KEY:'synthetic_drive_key',
  GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REPOSITORY:'possee41/docentetuc',GITHUB_RUN_ATTEMPT:'1',GITHUB_RUN_ID:'123'};
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
function harness(){
  const raw=new DatabaseSync(':memory:');raw.exec(read('lib/fixtures/juntas-production-schema-20261121.sql'));
  const wrap=(sql,args=[])=>({bind:(...values)=>wrap(sql,values),
    async all(){return{results:raw.prepare(sql).all(...args)};},
    async first(){return raw.prepare(sql).get(...args)||null;},
    async run(){const r=raw.prepare(sql).run(...args);return{meta:{changes:Number(r.changes),rows_written:Number(r.changes)}};}});
  const db={prepare:sql=>wrap(sql)};
  const insert=(id,category='Padrones',junta='Secundaria',metadata='{}',date=null)=>raw.prepare(`INSERT INTO publications
    (id,source,external_id,kind,category,title,summary,junta,official_url,metadata,content_hash,source_published_at)
    VALUES(?,'Padrones y Comunicados',?,'junta',?,?,'Fixture local; no oferta real',?,'https://drive.google.com/file/d/local_fixture/view',?,?,?)`)
    .run(id,id,category,'Padrón definitivo 2026 '+id,junta,metadata,'a'.repeat(64),date);
  return{raw,db,insert,close:()=>raw.close()};
}
test('DDL productivo real + 0100: instalación aditiva, repetible y conservación de revisión previa',()=>{
  const h=harness();try{
    h.raw.exec(read('migrations/0025_external_publication_events.sql'));
    h.insert('drive:legacy');h.raw.prepare('UPDATE publications SET summary=? WHERE id=?').run('x'.repeat(40000),'drive:legacy');h.raw.exec("INSERT INTO juntas_import_checkpoint VALUES('pad-secundaria','Padrones','{\"queue\":[{\"id\":\"pending\"}]}','PARTIAL',NULL,NULL,NULL,NULL,NULL)");
    const before=h.raw.prepare('SELECT * FROM publications').get(),checkpoint=h.raw.prepare('SELECT * FROM juntas_import_checkpoint').get();
    const ddl=read('migrations/0100_juntas_document_revisions.sql');h.raw.exec(ddl);h.raw.exec(ddl);
    assert.deepEqual(h.raw.prepare('SELECT * FROM publications').get(),before);assert.deepEqual(h.raw.prepare('SELECT * FROM juntas_import_checkpoint').get(),checkpoint);
    assert.equal(h.raw.prepare('SELECT count(*) n FROM juntas_document_revisions').get().n,0);
    h.raw.prepare('UPDATE publications SET content_hash=?,summary=? WHERE id=?').run('b'.repeat(64),'Cambio oficial simulado','drive:legacy');
    assert.equal(h.raw.prepare('SELECT count(*) n FROM juntas_document_revisions').get().n,2);
    h.raw.prepare('UPDATE publications SET summary=summary WHERE id=?').run('drive:legacy');
    assert.equal(h.raw.prepare('SELECT count(*) n FROM juntas_document_revisions').get().n,2);
    const previous=JSON.parse(h.raw.prepare('SELECT snapshot_json FROM juntas_document_revisions ORDER BY revision_id LIMIT 1').get().snapshot_json);assert.equal(previous.content_hash,before.content_hash);assert.equal(previous.summary.length,40000);
    assert.equal(h.raw.prepare('SELECT count(*) n FROM external_publication_events').get().n,0);
    h.raw.exec("INSERT INTO external_event_sources(source) VALUES('SIME')");
    h.raw.prepare("INSERT INTO publications(id,source,external_id,kind,category,title,official_url,content_hash) VALUES('sime:local','SIME','sime:local','vacante','Vacantes','Fixture local','https://sime.educaciontuc.gov.ar/',?)").run('c'.repeat(64));
    assert.equal(h.raw.prepare('SELECT count(*) n FROM external_publication_events').get().n,1);assert.equal(h.raw.prepare('SELECT count(*) n FROM juntas_document_revisions').get().n,2);
  }finally{h.close();}
});
test('volumen productivo representativo: 3454 padrones, cuatro juntas, 50 por página, sin pérdida ni duplicados',async()=>{
  const h=harness();try{
    const counts=[844,695,815,1100];h.raw.exec('BEGIN');for(let j=0;j<4;j++)for(let i=0;i<counts[j];i++)h.insert(`drive:local-${j}-${String(i).padStart(4,'0')}`,'Padrones',OFFICIAL_JUNTAS[j].label);h.raw.exec('COMMIT');
    let cursor='',pages=0;const ids=new Set();do{
      const r=await padronesPage(new Request('https://local.invalid/api/boards/padrones?cursor='+encodeURIComponent(cursor)),()=>h.db);
      assert.equal(r.status,200);const p=await r.json();assert.ok(p.items.length<=50);for(const item of p.items){assert.ok(!ids.has(item.id));ids.add(item.id);}cursor=p.nextCursor;pages++;assert.ok(pages<=70);
    }while(cursor);assert.equal(ids.size,3454);assert.equal(pages,70);
    const r=await padronesPage(new Request('https://local.invalid/api/boards/padrones?junta=secundaria'),()=>h.db);const p=await r.json();assert.equal(p.items.length,50);assert.ok(p.items.every(x=>x.junta==='Secundaria'));
  }finally{h.close();}
});
test('Comunicados/historial integrados: fecha descendente, cursor y exclusión de datos de control',async()=>{
  const h=harness();try{
    h.raw.exec(read('migrations/0100_juntas_document_revisions.sql'));
    const meta=JSON.stringify({official:{version:1,sourceCategory:'Comunicados',entity:'notice',facts:{},sources:[],issues:[]}});
    for(let i=0;i<55;i++)h.insert('notice:local-'+String(i).padStart(2,'0'),'Comunicados','Secundaria',meta,`2026-11-${String(1+i%20).padStart(2,'0')}T12:00:00Z`);
    h.insert('notice:preview','Comunicados','Secundaria',JSON.stringify({...JSON.parse(meta),preview:true}),'2026-12-01T00:00:00Z');
    const a=await(await boardPage(new Request('https://local.invalid/api/boards?view=comunicados'),()=>h.db)).json();
    const b=await(await boardPage(new Request('https://local.invalid/api/boards?view=comunicados&cursor='+encodeURIComponent(a.nextCursor)),()=>h.db)).json();
    assert.equal(a.items.length,50);assert.equal(b.items.length,5);assert.equal(b.nextCursor,null);assert.equal(new Set([...a.items,...b.items].map(x=>x.id)).size,55);
    assert.ok([...a.items,...b.items].every(x=>x.id!=='notice:preview'));
    const dates=[...a.items,...b.items].map(x=>x.source_published_at);assert.deepEqual(dates,[...dates].sort().reverse());
    const history=await boardRevisions(new Request('https://local.invalid/api/boards/revisions?id=notice:local-00'),()=>h.db);assert.equal(history.status,200);assert.equal((await history.json()).items.length,1);
    assert.equal((await boardRevisions(new Request('https://local.invalid/api/boards/revisions?id=notice:preview'),()=>h.db)).status,404);
  }finally{h.close();}
});
test('Llamados mantiene exactamente el SQL y los parámetros productivos; módulos ajenos sin cambios',async()=>{
  const old=execFileSync('git',['show',base+':lib/board-page.ts'],{encoding:'utf8'});
  const js=stripTypeScriptTypes(old).replace(/import \{ OFFICIAL_JUNTAS[^;]+;/,'const OFFICIAL_JUNTAS='+JSON.stringify(OFFICIAL_JUNTAS)+';');
  const previous=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
  for(const junta of ['todas',...OFFICIAL_JUNTAS.map(x=>x.id)])for(const mode of ['current','references'])for(const q of ['','Matemática'])assert.deepEqual(boardPageQuery('llamados',junta,mode,q),previous.boardPageQuery('llamados',junta,mode,q));
  for(const file of ['lib/board-view.ts','lib/app-publications-query.ts','app/api/app/route.ts','app/api/public-app/route.ts','app/api/search/route.ts','components/fdci-catalog-pilot.tsx','scripts/scheduled-task.mjs','wrangler.1.2-web-production.jsonc','.github/workflows/sime-import.yml']){
    assert.equal(read(file).replaceAll('\r\n','\n'),execFileSync('git',['show',base+':'+file],{encoding:'utf8'}).replaceAll('\r\n','\n'),file);
  }
  const beforeUi=execFileSync('git',['show',base+':app/docente-app.tsx'],{encoding:'utf8'}),afterUi=read('app/docente-app.tsx');
  assert.equal(afterUi.slice(afterUi.indexOf('function Dashboard(')).replaceAll('\r\n','\n'),beforeUi.slice(beforeUi.indexOf('function Dashboard(')).replaceAll('\r\n','\n'));
});
test('reconciliación conserva DDJJ PDF/Word, Trámites, Licencias y toda Información útil productiva',()=>{
  for(const file of execFileSync('git',['ls-tree','-r','--name-only',base,'public/documents'],{encoding:'utf8'}).trim().split('\n').filter(Boolean)){
    assert.deepEqual(readFileSync(new URL('../'+file,import.meta.url)),execFileSync('git',['show',base+':'+file]),file);
  }
  assert.equal(read('lib/useful-information.ts').replaceAll('\r\n','\n'),execFileSync('git',['show',base+':lib/useful-information.ts'],{encoding:'utf8'}).replaceAll('\r\n','\n'));
  const before=execFileSync('git',['show',base+':app/docente-app.tsx'],{encoding:'utf8'}),after=read('app/docente-app.tsx');
  const section=text=>text.slice(text.indexOf('function InformationHub('),text.indexOf('function PadronSection(')).replaceAll('\r\n','\n');
  assert.ok(before.includes('function InformationHub(')&&after.includes('function InformationHub('));
  assert.equal(section(after),section(before));
  assert.match(section(after),/normalize\(category \|\| ""\) === "tramites"/);
  assert.match(section(after),/Licencias y salud laboral/);
  assert.match(section(after),/Nueva_DDJJ_2026_en_blanco\.pdf/);
  assert.match(section(after),/Nueva_DDJJ_2026_en_blanco\.docx/);
  const manifest=read('scripts/prepare-juntas-production.mjs');
  assert.ok(manifest.includes("referenceProductionVersion:'6fb7a6a2-1552-4e43-9e2d-9d054e370419'"));
  assert.equal(read('migrations/0100_juntas_document_revisions.sql').replaceAll('\r\n','\n'),execFileSync('git',['show','1a33d4cee2bbed4d770739a3fe48332127656277:migrations/0100_juntas_document_revisions.sql'],{encoding:'utf8'}).replaceAll('\r\n','\n'));
});

test('diff funcional limitado al paquete Juntas aprobado sobre la base productiva vigente',()=>{
  const allowed=new Set(execFileSync('git',['diff','--name-only','2d32f22e888e296948f70711efd86692691cabe9','1a33d4cee2bbed4d770739a3fe48332127656277'],{encoding:'utf8'}).trim().split('\n'));
  const changed=execFileSync('git',['diff',base,'--name-only'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
  for(const file of changed)assert.ok(allowed.has(file)||file==='docs/juntas-reconciliacion-productiva-2026-11-26.md','Fuera de alcance: '+file);
});

test('configuración productiva rechaza origen, SHA, activación, evento y reintentos incorrectos antes de HTTP',async()=>{
  for(const patch of [{JUNTAS_APPROVED_SHA:'b'.repeat(40)},{JUNTAS_RECEIVER_ORIGIN:'https://docentetuc.com.ar'},{JUNTAS_PRODUCTION_ENABLED:'True'},{JUNTAS_SCHEMA_READY:'false'},{GITHUB_RUN_ATTEMPT:'2'},{GITHUB_EVENT_NAME:'push'},{GITHUB_EVENT_NAME:'schedule'},{JUNTAS_IMPORT_SECRET:''}]){
    let calls=0;await assert.rejects(runJuntasProduction({...config,...patch},sha,{fetcher:async()=>{calls++;throw Error();}}));assert.equal(calls,0);
  }
  assert.doesNotThrow(()=>juntasProductionConfig({...config,GITHUB_EVENT_NAME:'schedule',JUNTAS_DAILY_ENABLED:'true'},sha));
});
const mockFetch=(calls,{identityBad=false,closeFail=false}={})=>async(url,init={})=>{
  assert.equal(new URL(url).origin,JUNTAS_PRODUCTION_ORIGIN);assert.equal(new Headers(init.headers).get('authorization'),'Bearer '+secret);
  if(url.includes('import-identity'))return Response.json({id:identityBad?'wrong':config.JUNTAS_DATABASE_ID,name:config.JUNTAS_DATABASE_NAME});
  const p=JSON.parse(init.body);calls.push(p.action);
  if(p.action==='close'&&closeFail)return new Response(null,{status:503});
  return Response.json({ok:true,source:'juntas',owner:'juntas-123',closed:p.action==='close',expiresAt:new Date(Date.now()+590000).toISOString()});
};
test('identidad fallida impide concesión; PARTIAL cierra y conserva presupuestos/raíces sin Llamados',async()=>{
  const bad=[];await assert.rejects(runJuntasProduction(config,sha,{fetcher:mockFetch(bad,{identityBad:true})}));assert.equal(bad.length,0);
  const calls=[];const result=await runJuntasProduction(config,sha,{fetcher:mockFetch(calls),maintenance:async options=>{
    assert.equal(options.maxRequests,25);assert.equal(options.maxPublicationWrites,20);assert.equal(options.sources.length,11);assert.ok(options.sources.every(s=>s[1]!=='Llamados abiertos'));
    return{created:2,updated:1,unchanged:0,publicationAttempts:3,sourceRequests:5,completed:false,coverage:[]};
  }});assert.equal(result.status,'PARTIAL');assert.equal(result.closed,true);assert.deepEqual(calls,['open','close']);
});
test('fallos ambiguos, vencimiento y límites cierran sin reintento; cierre independiente no requiere habilitación',async()=>{
  for(const maintenance of [async()=>{throw Error('AMBIGUOUS_ACK');},async()=>({publicationAttempts:21,sourceRequests:1}),async o=>{await o.receiverOverride.receiverFetch(JUNTAS_PRODUCTION_ORIGIN+'/api/internal/juntas-checkpoint');}]){
    const calls=[];let now=Date.now();await assert.rejects(runJuntasProduction(config,sha,{fetcher:mockFetch(calls),clock:()=>now,maintenance:async o=>{now+=600000;return maintenance(o);}}));assert.deepEqual(calls,['open','close']);
  }
  const calls=[];assert.equal((await runJuntasProduction({...config,JUNTAS_PRODUCTION_ENABLED:'false',GOOGLE_DRIVE_API_KEY:''},sha,{fetcher:mockFetch(calls),closing:true})).closed,true);assert.deepEqual(calls,['close']);
  await assert.rejects(runJuntasProduction(config,sha,{fetcher:mockFetch([],{closeFail:true}),maintenance:async()=>({publicationAttempts:0,sourceRequests:0,completed:true})}),/JUNTAS_GATE_HTTP_503/);
});
test('receptor dedicado: denegación sin D1 y cierre idempotente autenticado con habilitación false',async()=>{
  const h=harness();try{
    // Schema-only identity fixture; actual production identity was checked by SELECT.
    h.raw.exec(read('migrations/0029_import_gateway_identity.sql'));
    h.raw.prepare('INSERT INTO import_gateway_identity VALUES(1,?,?)').run('docentetuc-db',config.JUNTAS_DATABASE_ID);
    const env={DB:h.db,IMPORT_DATABASE_NAME:'docentetuc-db',IMPORT_DATABASE_ID:config.JUNTAS_DATABASE_ID,IMPORT_GATE_ALLOWED_SOURCE:'juntas',IMPORT_GATE_ENABLED:'false',IMPORT_GATE_LEASE_REQUIRED:'true',JUNTAS_IMPORT_SECRET:secret,JUNTAS_PRODUCTION_ENABLED:'true'};
    const req=(path,body,token=secret)=>new Request(JUNTAS_PRODUCTION_ORIGIN+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});
    assert.equal((await receiver.fetch(req('/api/internal/juntas-checkpoint',{op:'prior',args:['pad-secundaria']},'invalid'),env)).status,401);
    assert.equal((await receiver.fetch(req('/api/internal/sime-import',{}),env)).status,404);
    assert.equal((await receiver.fetch(req('/api/internal/import-gate',{source:'juntas',owner:'juntas-123',action:'open',ttlSeconds:601}),env)).status,400);
    const gate={source:'juntas',owner:'juntas-123',action:'open',ttlSeconds:600};assert.equal((await receiver.fetch(req('/api/internal/import-gate',gate),env)).status,200);
    assert.equal((await receiver.fetch(req('/api/internal/import-gate',{...gate,action:'close'},'invalid'),{...env,JUNTAS_PRODUCTION_ENABLED:'false'})).status,401);
    for(let i=0;i<2;i++)assert.equal((await receiver.fetch(req('/api/internal/import-gate',{...gate,action:'close'}),{...env,JUNTAS_PRODUCTION_ENABLED:'false'})).status,200);
    assert.equal(h.raw.prepare('SELECT count(*) n FROM import_gate_lease').get().n,0);
  }finally{h.close();}
});

test('workflow inerte: preflight sin Environment, SHA fijado por output, concurrencia y cierre always',async()=>{
  const eslint=createRequire(realpathSync('node_modules/eslint/package.json'));
  const yaml=createRequire(eslint.resolve('@eslint/eslintrc'))('js-yaml');
  const workflow=yaml.load(read('.github/workflows/juntas-maintenance-production.yml'));
  const receiverConfig=JSON.parse(read('wrangler.juntas-production.jsonc'));assert.equal(receiverConfig.account_id,'6bbc3dae7e111660f0c835677ceffb69');assert.equal(receiverConfig.workers_dev,false);assert.equal(receiverConfig.vars.JUNTAS_PRODUCTION_ENABLED,'false');assert.deepEqual(receiverConfig.triggers.crons,[]);assert.equal(receiverConfig.d1_databases.length,1);assert.equal(receiverConfig.d1_databases[0].database_id,config.JUNTAS_DATABASE_ID);
  assert.equal(Object.hasOwn(workflow.on,'schedule'),false);assert.deepEqual(Object.keys(workflow.on),['workflow_dispatch']);
  assert.equal(workflow.permissions.contents,'read');assert.equal(workflow.permissions.actions,'read');
  assert.equal(workflow.concurrency.group,'daily-production-source-writes');assert.equal(workflow.concurrency['cancel-in-progress'],false);
  assert.equal(Object.hasOwn(workflow.jobs.preflight,'environment'),false);
  assert.equal(workflow.jobs.maintain.environment,'juntas-production');assert.equal(workflow.jobs.maintain.needs,'preflight');
  assert.equal(workflow.jobs.maintain.steps[0].with.ref,'${{ needs.preflight.outputs.runtime_sha }}');
  assert.equal(workflow.jobs.maintain.steps.at(-1).if,'always()');assert.match(workflow.jobs.maintain.steps.at(-1).run,/--close$/);
  const script=workflow.jobs.preflight.steps[0].with.script,AsyncFunction=Object.getPrototypeOf(async()=>{}).constructor;
  const evaluate=new AsyncFunction('github','context','core',script);
  const saved=Object.fromEntries(['JUNTAS_APPROVED_SHA','JUNTAS_SCHEMA_READY','ACK_FAILED_RUN'].map(k=>[k,process.env[k]]));
  process.env.JUNTAS_APPROVED_SHA=sha;process.env.JUNTAS_SCHEMA_READY='true';process.env.ACK_FAILED_RUN='';
  const context={repo:{owner:'possee41',repo:'docentetuc'},actor:'possee41',eventName:'workflow_dispatch',runId:123,payload:{sender:{id:296786704},repository:{default_branch:'fix/navigation-community-1.1'}}};
  const baseEnv={can_admins_bypass:false,deployment_branch_policy:{custom_branch_policies:true,protected_branches:false},protection_rules:[]};
  const mock=({missing=false,bypass=false,branches=['fix/navigation-community-1.1'],prior=null}={})=>({rest:{repos:{
    getEnvironment:async()=>{if(missing)throw Error('403_OR_MISSING_ENVIRONMENT');return{data:{...baseEnv,can_admins_bypass:bypass}};},
    listDeploymentBranchPolicies:async()=>({data:{total_count:branches.length,branch_policies:branches.map(name=>({name,type:'branch'}))}})
  },actions:{listWorkflowRuns:async()=>({data:{workflow_runs:prior?[prior]:[]}})}}});
  try{
    let output;await evaluate(mock(),context,{setOutput:(_,value)=>output=value});assert.equal(output,sha);
    for(const fixture of [{missing:true},{bypass:true},{branches:['*']},{prior:{id:99,conclusion:'failure'}},{prior:{id:99,conclusion:'cancelled'}}])await assert.rejects(evaluate(mock(fixture),context,{setOutput(){}}));
    process.env.ACK_FAILED_RUN='99';await evaluate(mock({prior:{id:99,conclusion:'failure'}}),context,{setOutput(){}});
    await assert.rejects(evaluate(mock({prior:{id:99,conclusion:'failure'}}),{...context,eventName:'schedule'},{setOutput(){}}));
    await assert.rejects(evaluate(mock(),{...context,actor:'other'},{setOutput(){}}));
  }finally{for(const[k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});

test('runtime de Actions importa sin paquetes externos y falla cerrado sin configuración',()=>{
  const guard=`import {registerHooks,builtinModules} from 'node:module';registerHooks({resolve(s,c,n){if(!s.startsWith('.')&&!s.startsWith('/')&&!s.startsWith('file:')&&!s.startsWith('node:')&&!builtinModules.includes(s))throw Error('EXTERNAL_PACKAGE_FORBIDDEN:'+s);return n(s,c);}});globalThis.fetch=()=>{throw Error('NETWORK_MUST_NOT_BE_USED');};`;
  const result=spawnSync(process.execPath,['--experimental-strip-types','--import','data:text/javascript,'+encodeURIComponent(guard),'scripts/juntas-production.mjs'],{encoding:'utf8',windowsHide:true,env:{...process.env,JUNTAS_APPROVED_SHA:''}});
  assert.equal(result.status,1);assert.match(result.stderr,/JUNTAS_PRODUCTION_IDENTITY_INVALID/);assert.doesNotMatch(result.stderr,/EXTERNAL_PACKAGE_FORBIDDEN|NETWORK_MUST_NOT_BE_USED/);
});
