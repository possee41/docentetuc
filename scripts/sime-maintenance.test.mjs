import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {resolveSimeDeferred,emptyBoardCursors,SIME_BOARD_NAMES} from './sime-maintenance.mjs';
import {initialDailyState,sealDailyState,validateDailyState,runDailyBatch} from './daily-sync-state.mjs';
import {runDailySource} from './daily-sources.mjs';
import {upgradeSimeRuntime} from './prepare-sime-recovery.mjs';
import {patchSimeMaintenanceWorkflow} from './prepare-sime-production-package.mjs';
import {simeDailySummary} from './sime-daily-summary.mjs';
import {normalizeSimeVacancy} from '../lib/sime-publications.ts';
import {prepareSimeImport} from '../lib/sime-import.ts';
import gateway from '../workers/daily-source-gateway.mjs';

globalThis.fetch=async()=>{throw Error('REMOTE_NETWORK_FORBIDDEN');};
const sha='a'.repeat(40),otherSha='b'.repeat(40),prodId='baaf5886-0123-4948-96da-aa7106424549';
const now=new Date('2026-11-13T16:00:00Z'),hash=x=>createHash('sha256').update(x).digest('hex');
const secret='LOCAL_ONLY_SIME_SECRET_1234567890123456789';
const raw=(board,n,historical=false)=>({id:board*10000+n,codigo:`LOCAL-${board}-${n}`,caracter:'SUPLENTE',cargos:'[9000306/00] CARGO LOCAL',abierto:true,
  fechaPublicacionInicio:historical?'06/11/2026 08:00':'13/11/2026 08:00',fechaPublicacionFin:historical?'11/11/2026 08:00':'31/12/2026 18:00'});
async function row(board,n,historical=false){return prepareSimeImport(normalizeSimeVacancy(raw(board,n,historical),SIME_BOARD_NAMES[board-1],board,undefined,now),now);}
function memory(state=initialDailyState('sime',sha,'production')) {
  let current={revision:'0'.repeat(40),state};
  return {load:async()=>structuredClone(current),save:async(previous,state)=>{
    assert.equal(previous.revision,current.revision);validateDailyState(state,'sime',sha);
    current={revision:hash(JSON.stringify(state)).slice(0,40),state:structuredClone(state)};return structuredClone(current);
  }};
}
const response=v=>Response.json({vacante:v});
test('diferido real 144440: identidad/código/fechas frescas; queda cerrado sin truncar ni datos personales',async()=>{
  const fixture=JSON.parse(readFileSync(new URL('fixtures/sime-deferred-144440.json',import.meta.url))),v=fixture.vacante;
  const old={...raw(1,1,true),id:v.id,codigo:v.codigo},pending=await prepareSimeImport(normalizeSimeVacancy(old,SIME_BOARD_NAMES[0],1,undefined,now),now);
  const result=await resolveSimeDeferred({[pending.id]:pending},new Set(),undefined,async()=>response({...v,designado:'NEVER_PERSIST'}),now);
  assert.equal(result.items.length,1);assert.equal(result.items[0].id,'sime:144440');assert.equal(result.items[0].status,'cerrada');
  assert.equal(result.items[0].endsAt,'2026-11-11T08:00:00-03:00');assert(!result.items[0].metadata.includes('NEVER_PERSIST'));assert.equal(result.errors.length,0);
});
test('diferido con ID o código diferente detiene; fecha futura/incompleta permanece pendiente',async()=>{
  const p=await row(2,1,true),v={...raw(2,1,true),descripcion:'Texto oficial',fechaDesignacion:''};
  for(const patch of [{id:1},{codigo:'OTRO'}])await assert.rejects(resolveSimeDeferred({[p.id]:p},new Set(),{},async()=>response({...v,...patch}),now),/IDENTITY_MISMATCH/);
  for(const patch of [{fechaPublicacionFin:'31/12/2026 18:00'},{fechaPublicacionFin:''},{fechaPublicacionInicio:'fecha inválida'},{fechaPublicacionInicio:42}]){
    const r=await resolveSimeDeferred({[p.id]:p},new Set(),{},async()=>response({...v,...patch}),now);assert.equal(r.items.length,0);assert.equal(r.errors[0].code,'SIME_DEFERRED_NOT_CONFIRMED_CLOSED');
  }
  const missing=await resolveSimeDeferred({[p.id]:p},new Set(),{},async()=>Response.json({vacante:null}),now);
  assert.equal(missing.items.length,0);assert.equal(missing.errors[0].code,'SIME_DEFERRED_NOT_VERIFIABLE');
});
test('fallo histórico no reintenta ni bloquea la rotación del siguiente pendiente',async()=>{
  const a=await row(3,1,true),b=await row(3,2,true),queue={[a.id]:a,[b.id]:b};let calls=0;
  const first=await resolveSimeDeferred(queue,new Set(),{},async()=>{calls++;throw Error('NETWORK');},now);
  const second=await resolveSimeDeferred(queue,new Set(),first.cursors,async()=>{calls++;return response({...raw(3,2,true),descripcion:'oficial'});},now);
  assert.equal(calls,2);assert.equal(second.items[0].id,b.id);assert.equal(first.errors.length,1);
});
test('histórico conserva metadata más reciente de D1, sin sobrescribirla con la cola antigua',async()=>{
  const p=await row(2,1,true),metadata={...JSON.parse(p.metadata),editorialNote:'CONSERVAR',simeVacancy:{...raw(2,1,true),cargos:'[9000306/00] CARGO CORREGIDO'}};
  const previous=new Map([[p.id,{metadata:JSON.stringify(metadata)}]]);
  const r=await resolveSimeDeferred({[p.id]:p},new Set(),{},async()=>response({...raw(2,1,true),descripcion:'Detalle oficial'}),now,undefined,previous);
  assert.equal(JSON.parse(r.items[0].metadata).editorialNote,'CONSERVAR');assert(r.items[0].title.includes('CORREGIDO'));
});
test('48 slots: conserva el cupo de cada junta y redistribuye los libres; reserva historial sin postergar vigentes',async()=>{
  const items=[];for(let b=1;b<=4;b++)for(let n=1;n<=(b===2?1:b===4?3:50);n++)items.push(await row(b,n,n===1));
  const store=memory(),sent=[];
  const result=await runDailyBatch({store,source:'sime',codeSha:sha,owner:'1-1',now,limit:48,redistribute:true,
    collect:async()=>({complete:true,items}),send:async p=>{if(p.mode!=='batch')return{ok:true};sent.push(p.items[0]);return{ok:true,received:1,created:1,updated:0,unchanged:0,queries:2,rowsRead:0,rowsWritten:1};}});
  assert.equal(result.processed,48);assert.deepEqual(Object.values(result.byJunta).map(x=>x.created),[22,1,22,3]);
  assert(sent.some(r=>r.junta==='Secundaria'));for(let b=1;b<=4;b++)assert(sent.some(r=>r.id===`sime:${b*10000+1}`));
});
test('mismo día Tucumán: segunda ejecución rechazada; fuente fallida no borra cola y permite mañana',async()=>{
  const store=memory(),p=await row(2,1);let current=await store.load();await store.save(current,sealDailyState({...current.state.data,generation:1,queue:{[p.id]:p},pending:1}));
  const options={store,source:'sime',codeSha:sha,owner:'1-1',now,scheduleDay:'2026-11-13',collect:async()=>{throw Error('SOURCE_DOWN');},send:async()=>{throw Error('NO_SEND');}};
  await assert.rejects(runDailyBatch(options),/SOURCE_DOWN/);await assert.rejects(runDailyBatch(options),/ALREADY_ATTEMPTED/);
  const d=(await store.load()).state.data;assert.equal(d.pending,1);assert.equal(d.halted,false);assert.equal(d.lastRun.code,'SOURCE_DOWN');
  const tomorrow=await runDailyBatch({...options,scheduleDay:'2026-11-14',owner:'2-1',collect:async()=>({complete:true,items:[p]}),send:async payload=>payload.mode==='batch'?{ok:true,received:1,created:1,updated:0,unchanged:0,queries:2,rowsRead:0,rowsWritten:1}:{ok:true}});
  assert.equal(tomorrow.completed,true);
});
test('ACK perdido: conserva estadísticas conocidas e intención, sin recuperación automática ambigua',async()=>{
  const store=memory(),items=[await row(1,1),await row(1,2)];let sent=0;
  await assert.rejects(runDailyBatch({store,source:'sime',codeSha:sha,owner:'1-1',now,collect:async()=>({complete:true,items}),send:async p=>{
    if(p.mode!=='batch')return{ok:true};if(++sent===2)throw Error('ACK_LOST');return{ok:true,received:1,created:1,updated:0,unchanged:0,queries:2,rowsRead:0,rowsWritten:1};}}),/ACK_LOST/);
  const d=(await store.load()).state.data;assert.equal(sent,2);assert.equal(d.halted,true);assert.equal(d.lastRun.processed,1);assert.equal(d.lastRun.uncertainId,items[1].id);assert.equal(d.simeCursors[1],items[0].id);
});
test('upgrade offline conserva cursor, pendientes e historial; nunca libera HALTED o propietario',()=>{
  const state=sealDailyState({...initialDailyState('sime',sha,'production').data,generation:273,recoveryRunId:'43456337623',simeCursors:emptyBoardCursors()});
  const next=upgradeSimeRuntime(state,sha,otherSha);assert.equal(next.data.generation,274);assert.equal(next.data.recoveryRunId,state.data.recoveryRunId);assert.deepEqual(next.data.simeCursors,state.data.simeCursors);
  for(const patch of [{halted:true},{inFlight:{mode:'batch',id:'sime:1'}},{owner:'1-1',expiresAt:now.toISOString()}])assert.throws(()=>upgradeSimeRuntime(sealDailyState({...state.data,...patch}),sha,otherSha),/REVIEW_REQUIRED/);
});
test('resumen seguro distingue PARTIAL/ERROR y nunca imprime payloads ni CPU estimada',()=>{
  const text=simeDailySummary({completed:false,processed:2,pending:89,closed:true,metadata:'SECRET',articles:['PRIVATE'],maintenance:{historicalVerified:1,sourceRequests:20,deferredErrors:[]}});
  assert(text.includes('PARTIAL'));assert(text.includes('Pendientes: 89'));assert(!text.includes('SECRET'));assert(!text.includes('PRIVATE'));assert(text.includes('NO MEDIDA'));
  assert(simeDailySummary({failed:true,code:'SIME_SOURCE_DOWN'}).includes('ERROR'));
  assert(simeDailySummary({failed:true}).includes('ACK: —'));
});
test('workflow: cambia solo el SHA SIME y agrega resumen; horarios y otros runtimes intactos',()=>{
  const baseline=readFileSync(new URL('fixtures/daily-production-sime-maintenance.yml',import.meta.url),'utf8'),patched=patchSimeMaintenanceWorkflow(baseline,otherSha);
  assert.equal((patched.match(new RegExp(otherSha,'g'))||[]).length,5);assert.deepEqual(patched.match(/cron: '[^']+'/g),baseline.match(/cron: '[^']+'/g));
  assert.equal((patched.match(/e7fc12fe3454f865b53c0c45f36b5568653dc02c/g)||[]).length,(baseline.match(/e7fc12fe3454f865b53c0c45f36b5568653dc02c/g)||[]).length);
  assert(patched.includes('scripts/sime-daily-summary.mjs'));assert(!patched.includes('CLOUDFLARE_API_TOKEN'));assert.throws(()=>patchSimeMaintenanceWorkflow('other',''),/BASELINE/);
});

function sqliteD1() {
  const raw=new DatabaseSync(':memory:');raw.exec(readFileSync(new URL('fixtures/sime-production-schema.sql',import.meta.url),'utf8'));
  raw.prepare('INSERT INTO import_gateway_identity VALUES(1,?,?)').run('docentetuc-db',prodId);
  const prepare=(sql,args=[])=>({bind:(...a)=>prepare(sql,a),all:async()=>({results:raw.prepare(sql).all(...args),meta:{rows_read:1,rows_written:0}}),first:async()=>raw.prepare(sql).get(...args)??null,run:async()=>{const r=raw.prepare(sql).run(...args);return{meta:{changes:r.changes,rows_read:0,rows_written:r.changes}};}});
  return{raw,db:{prepare,batch:async statements=>{raw.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());raw.exec('COMMIT');return results;}catch(e){raw.exec('ROLLBACK');throw e;}}}};
}
async function harness() {
  const {raw:sqlite,db}=sqliteD1(),records=new Map(),currentCounts=[36,0,35,0],deferredCounts=[4,1,10,3],queue={};
  for(let b=1;b<=4;b++)for(let n=1;n<=currentCounts[b-1]+deferredCounts[b-1];n++){
    const historical=n>currentCounts[b-1],r=await row(b,n,historical);queue[r.id]=r;records.set(r.externalId,{raw:raw(b,n,historical),historical,board:b});
  }
  const store=memory(sealDailyState({...initialDailyState('sime',sha,'production').data,queue,pending:89,recoveryRunId:'43456337623'}));
  const env={DB:db,SIME_IMPORT_SECRET:secret,DAILY_SOURCES_ENABLED:'true',DAILY_PRODUCTION_APPROVED:'true',DAILY_RECEIVER_NAME:'docentetuc-sources-1-2',IMPORT_DATABASE_ID:prodId,IMPORT_DATABASE_NAME:'docentetuc-db',IMPORT_GATE_ENABLED:'false',IMPORT_GATE_LEASE_REQUIRED:'true',SIME_IMPORT_ENABLED:'true'};
  const config={DAILY_SOURCES_ENABLED:'true',SYNC_SOURCE:'sime',DAILY_IMPORT_SECRET:secret,IMPORT_GATEWAY_TARGET:'production',IMPORT_GATEWAY_PRODUCTION_ENABLED:'true',IMPORT_GATEWAY_APPROVED_SHA:sha,SIME_PRODUCTION_APPROVED_SHA:sha,IMPORT_GATEWAY_ORIGIN:'https://docentetuc-sources-1-2.possee41.workers.dev',IMPORT_GATEWAY_DATABASE_ID:prodId,IMPORT_GATEWAY_DATABASE_NAME:'docentetuc-db',DAILY_STATE_ENVIRONMENT:'production',GITHUB_REPOSITORY:'possee41/docentetuc',GITHUB_REF:'refs/heads/fix/navigation-community-1.1',GITHUB_RUN_ATTEMPT:'1',GITHUB_RUN_ID:'1',DAILY_EVENT_NAME:'schedule',DAILY_EVENT_SCHEDULE:'7 9 * * *',SIME_PRODUCTION_DAILY_ENABLED:'true'};
  const calls=[];
  const sourceFetch=async input=>{const u=new URL(input);calls.push(u.pathname);const board=Number(u.pathname.match(/Obtener(?:Periodos|Vacantes)\/(\d)/)?.[1]);
    if(u.pathname.includes('ObtenerPeriodos/'))return Response.json({periodos:[{text:'11/2026'}]});
    if(u.pathname.includes('ObtenerVacantes/'))return Response.json({vacantes:[...records.values()].filter(r=>r.board===board&&!r.historical).map(r=>r.raw)});
    const record=records.get(u.pathname.split('/').at(-1));if(!record)throw Error('UNKNOWN_LOCAL_ID');
    return response({...record.raw,fechaDesignacion:'29/11/2026 10:00 a.m.',descripcion:'Inscripción online por SIME. Fixture local.',estadoId:12,designado:'NEVER_PERSIST'});
  };
  return{sqlite,store,config,calls,records,env,sourceFetch,receiverFetch:async(url,init)=>gateway.fetch(new Request(url,init),env)};
}
test('E2E SQLite: 89 pendientes (71 actuales/18 diferidos), runners nuevos, cuatro juntas y replay sin duplicados',async()=>{
  const h=await harness();let completed=false,total=0;const daily=[];
  for(let day=0;day<16;day++){
    const date=new Date(now.getTime()+day*86400000),before=h.calls.length;
    const result=await runDailySource({...h.config,GITHUB_RUN_ID:String(day+1)},sha,{store:h.store,sourceFetch:h.sourceFetch,receiverFetch:h.receiverFetch,now:date});
    assert(result.processed<=48);assert.equal(result.closed,true);assert.equal(h.calls.length-before,result.maintenance.sourceRequests);assert(result.maintenance.sourceRequests<=24);
    assert.equal(h.sqlite.prepare('SELECT count(*) n FROM import_gate_lease').get().n,0);
    const d=(await h.store.load()).state.data;assert.equal(d.pending,Object.keys(d.queue).length);assert.equal(d.halted,false);total+=result.created;
    daily.push({day:day+1,processed:result.processed,pending:result.pending,deferred:result.deferred,sourceRequests:result.maintenance.sourceRequests});
    if(result.completed)completed=true;
    if(day===0){assert.equal(result.processed,48);assert.equal(result.completed,false);assert(result.byJunta[2].created>=1);}
  }
  assert(completed);assert.equal(total,89);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM publications').get().n,89);
  assert.equal(h.sqlite.prepare('SELECT count(DISTINCT external_id) n FROM publications').get().n,89);
  assert.equal(h.sqlite.prepare("SELECT count(*) n FROM publications WHERE junta='Secundaria'").get().n,1);
  assert.equal(h.sqlite.prepare("SELECT count(*) n FROM publications WHERE metadata LIKE '%NEVER_PERSIST%'").get().n,0);
  assert.equal(daily.at(-1).pending,0);assert.equal(daily.at(-1).processed,0);
  console.log('LOCAL_89_PENDING_REPLAY '+JSON.stringify(daily));h.sqlite.close();
});
test('E2E: rotación durable de detalle verifica registros distintos aunque la metadata no cambie',async()=>{
  const h=await harness(),after=[];
  for(let day=0;day<2;day++){
    const offset=h.calls.length;await runDailySource({...h.config,GITHUB_RUN_ID:String(day+1)},sha,{store:h.store,sourceFetch:h.sourceFetch,receiverFetch:h.receiverFetch,now:new Date(now.getTime()+day*86400000)});
    after.push(h.calls.slice(offset).filter(p=>p.startsWith('/Vacantes/ObtenerVacante/')));
  }
  assert(after[1].some(p=>!after[0].includes(p)));const d=(await h.store.load()).state.data;assert(d.simeMaintenance.detailCursors[1]);assert.equal(d.simeMaintenance.sourceCheckedAt,'2026-11-14T16:00:00.000Z');h.sqlite.close();
});
test('E2E: segunda corrida del día, otro cron o SHA incorrecto se rechazan antes de HTTP',async()=>{
  const h=await harness(),options={store:h.store,sourceFetch:h.sourceFetch,receiverFetch:h.receiverFetch,now};
  await runDailySource(h.config,sha,options);const count=h.calls.length;
  await assert.rejects(runDailySource({...h.config,GITHUB_RUN_ID:'2'},sha,options),/ALREADY_ATTEMPTED/);
  await assert.rejects(runDailySource({...h.config,GITHUB_RUN_ID:'3'},sha,{...options,now:new Date('2026-11-14T02:45:00Z')}),/ALREADY_ATTEMPTED/);
  await assert.rejects(runDailySource({...h.config,DAILY_EVENT_SCHEDULE:'0 * * * *'},sha,options),/SCHEDULE_NOT_APPROVED/);
  await assert.rejects(runDailySource({...h.config,SIME_PRODUCTION_APPROVED_SHA:otherSha},sha,options),/SCHEDULE_NOT_APPROVED/);
  assert.equal(h.calls.length,count);h.sqlite.close();
});
test('E2E: una junta con error no bloquea las sanas ni produce un falso OK',async()=>{
  const h=await harness();
  const sourceFetch=(url,init)=>new URL(url).pathname==='/Vacantes/ObtenerPeriodos/2'?Promise.resolve(new Response('',{status:503})):h.sourceFetch(url,init);
  const result=await runDailySource(h.config,sha,{store:h.store,sourceFetch,receiverFetch:h.receiverFetch,now});
  assert.equal(result.closed,true);assert.equal(result.completed,false);assert.equal(result.byJunta[2].created,0);assert(result.byJunta[1].created>0);assert(result.byJunta[3].created>0);
  assert.equal(result.maintenance.boards[2],false);assert.equal(result.maintenance.sourceCheckedAt,null);assert.equal(result.maintenance.boardErrors[0].board,2);
  const d=(await h.store.load()).state.data;assert.equal(d.halted,false);assert.equal(d.lastSuccessAt,null);assert.equal(h.sqlite.prepare("SELECT sync_status FROM sync_state WHERE source='SIME'").get().sync_status,'PARTIAL');h.sqlite.close();
});
test('E2E: todas las juntas fallan; conserva pendientes y error por junta, sin tocar publicaciones',async()=>{
  const h=await harness();let failure;
  try{await runDailySource(h.config,sha,{store:h.store,sourceFetch:async()=>new Response('',{status:503}),receiverFetch:h.receiverFetch,now});}catch(e){failure=e;}
  assert.match(failure.message,/SOURCE_INCOMPLETE/);assert.equal(failure.diagnostics.maintenance.boardErrors.length,4);assert.equal(failure.diagnostics.closed,true);
  const d=(await h.store.load()).state.data;assert.equal(d.pending,89);assert.equal(d.halted,false);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM publications').get().n,0);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM import_gate_lease').get().n,0);h.sqlite.close();
});
test('inconsistencia de identidad suspende persistentemente antes de escrituras',async()=>{
  const store=memory();let calls=0;
  await assert.rejects(runDailyBatch({store,source:'sime',codeSha:sha,owner:'1-1',now,collect:async()=>{throw Error('SIME_DEFERRED_IDENTITY_MISMATCH');},send:async()=>{calls++;}}),/IDENTITY_MISMATCH/);
  assert.equal(calls,0);assert.equal((await store.load()).state.data.halted,true);
});
test('E2E: fallo de cierre conserva los ACK conocidos y suspende; cierre independiente posterior',async()=>{
  const h=await harness();let failure;
  const receiverFetch=(url,init)=>init?.body&&JSON.parse(init.body).action==='close'?Promise.resolve(new Response('',{status:503})):h.receiverFetch(url,init);
  try{await runDailySource(h.config,sha,{store:h.store,sourceFetch:h.sourceFetch,receiverFetch,now});}catch(e){failure=e;}
  assert.match(failure.message,/GATE_CLOSE_FAILED/);assert.equal(failure.diagnostics.closed,false);assert.equal(failure.diagnostics.lastRun.processed,48);assert.equal((await h.store.load()).state.data.halted,true);
  h.env.SIME_IMPORT_ENABLED='false';
  const r=await h.receiverFetch('https://local.invalid/api/internal/import-gate',{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({source:'sime',action:'close',owner:'1-1',ttlSeconds:600})});
  assert.equal(r.status,200);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM import_gate_lease').get().n,0);h.sqlite.close();
});
