import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import receiver from '../workers/sime-receiver.mjs';
import { runSimeImport, parseSimeOptions, parseSimeCursor } from './import-sime.mjs';
import { CANARY, runSimeCanaryPilot, closeSimeCanary, verifyExecution, readSimeCheckpoint, sealReport } from './import-via-gateway.mjs';

// Any accidental fallback to a real HTTP client fails the local suite.
globalThis.fetch = () => { throw Error('REMOTE_NETWORK_FORBIDDEN_IN_LOCAL_TEST'); };

const sha = 'a'.repeat(40), secret = 'synthetic_canary_secret_12345678901234567890';
const labels = ['Inicial y Primaria', 'Secundaria', 'Técnica, Agrotécnica y No Formal', 'Superior, Especial y Artística'];
const config = {
  SYNC_SOURCE: 'sime', IMPORT_GATEWAY_TARGET: 'canary', IMPORT_GATEWAY_PRODUCTION_ENABLED: 'false',
  IMPORT_GATEWAY_ORIGIN: CANARY.origin, IMPORT_GATEWAY_DATABASE_ID: CANARY.id, IMPORT_GATEWAY_DATABASE_NAME: CANARY.name,
  SIME_IMPORT_SECRET: secret, SIME_IMPORT_JUNTAS: '1,2,3,4', SIME_IMPORT_LIMIT: '50', SIME_IMPORT_RESUME_AFTER: '',
  SIME_CANARY_ENABLED: 'true', SIME_CANARY_APPROVED_SHA: sha, SIME_CANARY_AUTHORIZED_RUN_ID: '123',
  GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REPOSITORY: 'possee41/docentetuc', GITHUB_REF: 'refs/heads/pilot/sime-fair-canary', GITHUB_SHA: sha,
};

// Real SQLite persistence + unchanged SIME receiver. The lease adapter simulates the
// deployed gateway protocol/CAS locally; its counters are not Cloudflare D1 metrics.
function fixture(options = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE publications (
    id TEXT PRIMARY KEY,source TEXT NOT NULL,external_id TEXT NOT NULL,kind TEXT NOT NULL,category TEXT NOT NULL,
    title TEXT NOT NULL,summary TEXT NOT NULL DEFAULT '',level TEXT NOT NULL DEFAULT '',area TEXT NOT NULL DEFAULT '',
    junta TEXT NOT NULL DEFAULT '',location TEXT NOT NULL DEFAULT '',shift TEXT NOT NULL DEFAULT '',character TEXT NOT NULL DEFAULT '',
    starts_at TEXT,ends_at TEXT,status TEXT NOT NULL,official_url TEXT NOT NULL,metadata TEXT NOT NULL,content_hash TEXT NOT NULL,
    source_updated_at TEXT,source_published_at TEXT,registration_open_at TEXT,registration_close_at TEXT,expires_at TEXT,
    source_status TEXT NOT NULL DEFAULT 'UNKNOWN',normalized_status TEXT NOT NULL DEFAULT 'UNKNOWN',removed_at TEXT,
    last_seen_at TEXT NOT NULL DEFAULT '',last_changed_at TEXT NOT NULL DEFAULT '',first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE sync_state(source TEXT PRIMARY KEY,synced_at TEXT NOT NULL,item_count INTEGER NOT NULL DEFAULT 0,error TEXT,
    last_attempt_at TEXT,last_successful_sync_at TEXT,sync_status TEXT NOT NULL DEFAULT 'UNKNOWN',error_code TEXT,error_message TEXT);
    CREATE TABLE lease(id INTEGER PRIMARY KEY,owner TEXT NOT NULL,expires INTEGER NOT NULL);`);
  const prepare = (sql, args = []) => ({
    bind: (...values) => prepare(sql, values),
    async all() { const results = sqlite.prepare(sql).all(...args); return {results, meta:{rows_read:results.length,rows_written:0}}; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async run() { const r = sqlite.prepare(sql).run(...args); return {meta:{changes:r.changes,rows_read:0,rows_written:r.changes}}; },
  });
  const db = {prepare, async batch(statements) { sqlite.exec('BEGIN'); try { const result = []; for (const s of statements) result.push(await s.run()); sqlite.exec('COMMIT'); return result; } catch(e) { sqlite.exec('ROLLBACK'); throw e; } }};
  const f = {sqlite, sourceCalls:0, batches:0, closes:0, opens:0, calls:[], now:Date.parse('2026-10-22T15:00:00Z')};
  f.sourceFetch = async (input) => {
    f.sourceCalls++;
    if (options.expireSource) f.now += 601_000;
    if (options.sourceFailure) return new Response('', {status:503});
    if (options.sourceInvalid) return Response.json({unexpected:true});
    const u = new URL(input), board = Number(u.pathname.match(/Obtener(?:Periodos|Vacantes)\/(\d)/)?.[1]);
    if (u.pathname.includes('ObtenerPeriodos/')) return Response.json({periodos:options.empty ? [] : [{text:'10/2026'}]});
    if (u.pathname.includes('ObtenerVacantes/')) return Response.json({vacantes:Array.from({length:options.count ?? 20},(_,i)=>({
      id:board*1000+i+1,codigo:`FIXTURE-${board}-${i}`,caracter:'SUPLENTE',fechaPublicacionInicio:'22/10/2026 08:00',
      fechaPublicacionFin:'23/10/2026 18:00',cargos:'[9000306/00] CARGO FICTICIO LOCAL',abierto:true,
    }))});
    if (u.pathname.includes('ObtenerVacante/')) return Response.json({vacante:{descripcion:'Fixture local sin datos reales'}});
    throw Error('UNEXPECTED_SOURCE');
  };
  f.receiverFetch = async (input, init = {}) => {
    const u = new URL(input), headers = new Headers(init.headers);
    assert.equal(u.origin, CANARY.origin);
    if (headers.get('authorization') !== 'Bearer '+secret) return new Response('',{status:401});
    f.calls.push(u.pathname);
    if (u.pathname.endsWith('/import-identity')) return Response.json(options.wrongIdentity ? {...CANARY,id:'baaf5886-0123-4948-96da-aa7106424549'} : {id:CANARY.id,name:CANARY.name});
    if (u.pathname.endsWith('/import-gate')) {
      const p = JSON.parse(init.body), lease = sqlite.prepare('SELECT * FROM lease WHERE id=1').get();
      assert.equal(p.ttlSeconds,600); assert.equal(p.source,'sime');
      if (p.action === 'close') {
        f.closes++;
        if (options.closeFailure) return new Response('',{status:503});
        if (lease && lease.owner !== p.owner) return new Response('',{status:409});
        sqlite.prepare('DELETE FROM lease WHERE id=1 AND owner=?').run(p.owner);
        return Response.json({ok:true,closed:true,source:'sime',owner:p.owner});
      }
      f.opens++;
      if (lease && lease.expires > f.now) return new Response('',{status:409});
      sqlite.prepare('INSERT OR REPLACE INTO lease VALUES(1,?,?)').run(p.owner,f.now+600_000);
      if (options.openAckLost) throw Error('OPEN_ACK_LOST');
      return Response.json({ok:true,source:'sime',owner:p.owner,expiresAt:new Date(f.now+(options.badTtl ? 900_000 : 600_000)).toISOString()});
    }
    const lease = sqlite.prepare('SELECT * FROM lease WHERE id=1').get();
    if (!lease || lease.expires<=f.now || lease.owner!==headers.get('x-import-gate-owner')) return new Response('',{status:409});
    if (init.method==='POST' && JSON.parse(init.body).mode==='batch') {
      f.batches++;
      if (options.rejectAt===f.batches) return new Response('',{status:503});
      if (options.badAck===f.batches) return Response.json({ok:true,received:1,created:-1,updated:2,unchanged:0});
      const response = await receiver.fetch(new Request(input,init),{DB:db,SIME_IMPORT_SECRET:secret});
      if (options.ackLost===f.batches) throw Error('ACK_LOST');
      if (options.abortAt===f.batches) options.controller.abort();
      return response;
    }
    return receiver.fetch(new Request(input,init),{DB:db,SIME_IMPORT_SECRET:secret});
  };
  f.run = (patch = {}) => runSimeCanaryPilot({...config,...patch},sha,{sourceFetch:f.sourceFetch,receiverFetch:f.receiverFetch,clock:()=>f.now,signal:options.controller?.signal});
  f.count = () => sqlite.prepare('SELECT count(*) AS n FROM publications').get().n;
  f.leases = () => sqlite.prepare('SELECT count(*) AS n FROM lease').get().n;
  return f;
}

for (const [name,patch] of Object.entries({
  production:{IMPORT_GATEWAY_TARGET:'production'}, missingTarget:{IMPORT_GATEWAY_TARGET:undefined},
  wrongDb:{IMPORT_GATEWAY_DATABASE_ID:'baaf5886-0123-4948-96da-aa7106424549'}, wrongHost:{IMPORT_GATEWAY_ORIGIN:'https://docentetuc-import-1-2.possee41.workers.dev'},
  localhost:{IMPORT_GATEWAY_ORIGIN:'http://127.0.0.1:8787'}, source:{SYNC_SOURCE:'fdci'},
  schedule:{GITHUB_EVENT_NAME:'schedule'}, rerun:{GITHUB_RUN_ATTEMPT:'2'}, otherRun:{GITHUB_RUN_ID:'124'},
  noPermit:{SIME_CANARY_AUTHORIZED_RUN_ID:undefined}, wrongSha:{GITHUB_SHA:'b'.repeat(40)}, branch:{GITHUB_REF:'refs/heads/fix/navigation-community-1.1'},
  overLimit:{SIME_IMPORT_LIMIT:'51'}, wrongJuntas:{SIME_IMPORT_JUNTAS:'1,2'}, disabled:{SIME_CANARY_ENABLED:'false'},
})) test('rechazo antes de red: '+name,()=>assert.throws(()=>verifyExecution({...config,...patch},sha)));

test('fair allocation 12/12/12/12, dos slots sin usar y filas SQLite reales',async t=>{
  const f=fixture();t.after(()=>f.sqlite.close());const r=await f.run();
  assert.equal(r.data.status,'PARTIAL');assert.equal(r.data.closed,true);assert.equal(f.count(),48);assert.equal(f.leases(),0);
  assert.deepEqual(r.data.result.processedByJunta,{1:12,2:12,3:12,4:12});
  assert.deepEqual(r.data.result.byJunta[2],{created:12,updated:0,unchanged:0});
  assert.deepEqual(labels.map(l=>f.sqlite.prepare('SELECT count(*) AS n FROM publications WHERE junta=?').get(l).n),[12,12,12,12]);
  assert.equal(f.sqlite.prepare("SELECT sync_status FROM sync_state WHERE source='SIME'").get().sync_status,'PARTIAL');
});

test('cursor durable: proceso nuevo verifica checksum y reanuda todas las juntas sin starvation',async t=>{
  const f=fixture();t.after(()=>f.sqlite.close());const dir=mkdtempSync(join(tmpdir(),'sime-cursor-'));t.after(()=>rmSync(dir,{recursive:true}));
  const a=await f.run();writeFileSync(join(dir,'checkpoint.json'),JSON.stringify(a));
  const moduleUrl=new URL('./import-via-gateway.mjs',import.meta.url).href;
  const child=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',
    `import{readFileSync}from'node:fs';import{readSimeCheckpoint}from ${JSON.stringify(moduleUrl)};console.log(readSimeCheckpoint(JSON.parse(readFileSync(process.argv[1],'utf8')),process.argv[2],'123'));`,join(dir,'checkpoint.json'),sha],{encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);const cursor=child.stdout.trim();
  const b=await f.run({SIME_IMPORT_RESUME_AFTER:cursor});assert.equal(b.data.result.created,32);assert.equal(f.count(),80);
  assert.deepEqual(b.data.result.processedByJunta,{1:8,2:8,3:8,4:8});
  const c=await f.run({SIME_IMPORT_RESUME_AFTER:readSimeCheckpoint(b,sha,'123')});assert.equal(c.data.result.created,0);assert.equal(f.count(),80);
});

test('replay sin duplicados ni escrituras de publicaciones innecesarias',async t=>{
  const f=fixture({count:3});t.after(()=>f.sqlite.close());await f.run();const r=await f.run();
  assert.equal(r.data.result.created,0);assert.equal(r.data.result.updated,0);assert.equal(r.data.result.unchanged,12);
  assert.equal(r.data.result.rowsWritten,0);assert.equal(f.count(),12);
  assert.equal(f.sqlite.prepare('SELECT count(DISTINCT external_id) AS n FROM publications').get().n,12);
});

test('replay con nuevos detalles oficiales actualiza hashes, sin crear duplicados',async t=>{
  const f=fixture();t.after(()=>f.sqlite.close());await f.run();const r=await f.run();
  assert.equal(r.data.result.created,0);assert.equal(r.data.result.updated,12);assert.equal(r.data.result.unchanged,36);assert.equal(f.count(),48);
});

for (const [name,opts] of Object.entries({reject:{rejectAt:2},badAck:{badAck:2},ackLost:{ackLost:2}}))
  test('detención y cierre sin reintentos: '+name,async t=>{
    const f=fixture(opts);t.after(()=>f.sqlite.close());const r=await f.run();
    assert.equal(r.data.status,'ERROR');assert.equal(r.data.halted,true);assert.equal(r.data.closed,true);assert.equal(f.batches,2);assert.equal(f.leases(),0);
    assert.equal(parseSimeCursor(r.data.result.nextResumeAfter)[1],'sime:1001');
    assert.throws(()=>readSimeCheckpoint(r,sha,'123'),/REVIEW_REQUIRED/);
    if(opts.ackLost)assert.equal(f.count(),2); // Second write persisted but its ACK is uncertain.
  });

for(const [name,opts] of Object.entries({expiry:{expireSource:true},sourceError:{sourceFailure:true},openAck:{openAckLost:true},ttl:{badTtl:true}}))
  test('suspensión antes de publicaciones: '+name,async t=>{
    const f=fixture(opts);t.after(()=>f.sqlite.close());const r=await f.run();assert.equal(r.data.status,'ERROR');assert.equal(r.data.closed,true);assert.equal(f.count(),0);assert.equal(f.leases(),0);
  });

test('cancelación detiene nuevos lotes y el cierre usa señal independiente',async t=>{
  const controller=new AbortController(),f=fixture({controller,abortAt:1});t.after(()=>f.sqlite.close());const r=await f.run();
  assert.equal(f.batches,1);assert.equal(r.data.closed,true);assert.equal(r.data.status,'ERROR');assert.equal(f.leases(),0);
});

test('dos propietarios concurrentes: una concesión, el perdedor no cierra la ajena',async t=>{
  const f=fixture();t.after(()=>f.sqlite.close());const [a,b]=await Promise.all([f.run(),f.run({GITHUB_RUN_ID:'124',SIME_CANARY_AUTHORIZED_RUN_ID:'124'})]);
  assert.equal([a,b].filter(r=>r.data.status==='PARTIAL').length,1);assert.equal([a,b].filter(r=>r.data.status==='ERROR').length,1);assert.equal(f.count(),48);assert.equal(f.leases(),0);
});

test('identidad inesperada no abre concesión',async t=>{const f=fixture({wrongIdentity:true});t.after(()=>f.sqlite.close());const r=await f.run();assert.equal(r.data.status,'ERROR');assert.equal(f.opens,0);assert.equal(f.sourceCalls,0);});

test('schema inesperado de la primera fuente detiene las otras juntas y no publica',async t=>{
  const f=fixture({sourceInvalid:true});t.after(()=>f.sqlite.close());const r=await f.run();
  assert.equal(r.data.status,'ERROR');assert.equal(r.data.closed,true);assert.equal(f.sourceCalls,1);assert.equal(f.count(),0);
});

test('fallo de cierre marca incidente; cierre independiente es idempotente',async t=>{
  const options={closeFailure:true},f=fixture(options);t.after(()=>f.sqlite.close());const r=await f.run();assert.equal(r.data.closed,false);assert.equal(r.data.status,'ERROR');assert.equal(f.leases(),1);
  options.closeFailure=false;
  assert.equal((await closeSimeCanary(config,sha,f.receiverFetch)).closed,true);assert.equal(f.leases(),0);
  assert.equal((await closeSimeCanary(config,sha,f.receiverFetch)).closed,true);
});

test('catálogo vacío: cero publicaciones y cierre confirmado',async t=>{const f=fixture({empty:true});t.after(()=>f.sqlite.close());const r=await f.run();assert.equal(r.data.result.created,0);assert.equal(r.data.closed,true);assert.equal(f.count(),0);});

test('checkpoint alterado o de otra revisión no permite recuperación',async t=>{
  const f=fixture();t.after(()=>f.sqlite.close());const r=await f.run();assert.throws(()=>readSimeCheckpoint(r,'b'.repeat(40),'123'));assert.throws(()=>readSimeCheckpoint(r,sha,'124'));r.data.result.nextResumeAfter='sime:999';assert.throws(()=>readSimeCheckpoint(r,sha,'123'));
});

test('entradas inválidas y cuota menor al número de juntas',async()=>{
  for(const c of [{SIME_IMPORT_JUNTAS:'1,1'},{SIME_IMPORT_LIMIT:'0'},{SIME_IMPORT_LIMIT:'51'},{SIME_IMPORT_LIMIT:'51.5'},{SIME_IMPORT_RESUME_AFTER:'bad'}])assert.throws(()=>parseSimeOptions(c));
  for(const cursor of [null,0,false,'null','[]','{"version":1,"after":{}}'])assert.throws(()=>parseSimeCursor(cursor));
  await assert.rejects(runSimeImport({endpoint:CANARY.origin+'/api/internal/sime-import',token:secret,limit:1,receiverFetch:()=>assert.fail('no network')}));
});

test('paginación cíclica se detiene antes de escribir',async()=>{
  let calls=0;
  await assert.rejects(runSimeImport({endpoint:CANARY.origin+'/api/internal/sime-import',token:secret,
    now:new Date('2026-10-22T15:00:00Z'),execution:{target:'canary',approvedSha:sha,codeSha:sha,runId:'123',authorizedRunId:'123',owner:'sime-canary:123:1',expiresAt:'2026-10-22T15:10:00Z'},
    receiverFetch:async(input,init)=>{assert.equal(init.method,'GET');calls++;return Response.json({items:[],nextCursor:calls%2?'sime:1':'sime:2'});}}),/SIME_PREVIOUS_PAGE_INVALID/);
  assert.equal(calls,3);
});

for(const [name,patch] of Object.entries({empty:{},production:{IMPORT_GATEWAY_TARGET:'production'},
  incomplete:{IMPORT_GATEWAY_TARGET:'canary'},complete:{...config}}))
  test('CLI directa rechaza antes de HTTP: '+name,()=>{
    const preload='data:text/javascript,'+encodeURIComponent("globalThis.fetch=async()=>{console.log('UNEXPECTED_HTTP');throw Error('HTTP_FORBIDDEN');};");
    const child=spawnSync(process.execPath,['--experimental-strip-types','--import',preload,'scripts/import-sime.mjs'],{
      env:{SystemRoot:process.env.SystemRoot,...patch,SIME_IMPORT_URL:'https://docentetuc-import-1-2.possee41.workers.dev/api/internal/sime-import',SIME_IMPORT_SECRET:secret},encoding:'utf8',timeout:10000});
    assert.equal(child.status,1);assert.equal(child.stdout,'');assert.match(child.stderr,/SIME_PROTECTED_ENTRYPOINT_REQUIRED/);
  });

test('API Canary también exige autorización completa antes de HTTP',async()=>{
  const execution={target:'canary',approvedSha:sha,codeSha:sha,runId:'123',authorizedRunId:'123',owner:'sime-canary:123:1',expiresAt:'2026-10-22T15:10:00Z'};
  for(const auth of [undefined,{...execution,target:'production'},{...execution,owner:'other'},{...execution,authorizedRunId:'999'},
    {...execution,codeSha:'b'.repeat(40)},{...execution,expiresAt:'2026-10-22T14:00:00Z'}])
    await assert.rejects(runSimeImport({endpoint:CANARY.origin+'/api/internal/sime-import',token:secret,execution:auth,
      now:new Date('2026-10-22T15:00:00Z'),receiverFetch:()=>assert.fail('HTTP must not happen')}),/SIME_CANARY_AUTHORIZATION_REQUIRED/);
  await assert.rejects(runSimeImport({endpoint:'https://docentetuc-import-1-2.possee41.workers.dev/api/internal/sime-import',token:secret,execution,
    now:new Date('2026-10-22T15:00:00Z'),receiverFetch:()=>assert.fail('HTTP must not happen')}),/SIME_CANARY_AUTHORIZATION_REQUIRED/);
});

test('API de biblioteca fuera del Canary conserva su uso local legítimo',async()=>{
  let writes=0;
  const r=await runSimeImport({endpoint:'https://fixture.invalid/api/internal/sime-import',token:secret,
    sourceFetch:async()=>Response.json({periodos:[]}),receiverFetch:async(input,init)=>{
      if(init.method==='GET')return Response.json({items:[],nextCursor:null});writes++;return Response.json({ok:true});}});
  assert.equal(r.completed,true);assert.equal(r.created,0);assert.equal(writes,2);
});

test('cierre con SIME deshabilitado, repetido y sin habilitar importaciones',async t=>{
  const f=fixture({closeFailure:true});t.after(()=>f.sqlite.close());await f.run();assert.equal(f.leases(),1);
  const disabled={...config,SIME_CANARY_ENABLED:'false'};f.receiverFetch=async(input,init)=>{
    const p=JSON.parse(init.body);assert.equal(p.action,'close');assert.equal(p.owner,'sime-canary:123:1');
    f.sqlite.prepare('DELETE FROM lease WHERE owner=?').run(p.owner);
    return Response.json({ok:true,closed:true,source:'sime',owner:p.owner});};
  assert.equal((await closeSimeCanary(disabled,sha,f.receiverFetch)).closed,true);
  assert.equal((await closeSimeCanary(disabled,sha,f.receiverFetch)).closed,true);assert.equal(f.leases(),0);
  await assert.rejects(runSimeCanaryPilot(disabled,sha,{receiverFetch:()=>assert.fail('disabled import must not use HTTP')}));
});

test('cierre rechaza permiso de propietario ajeno antes de HTTP',async()=>{
  await assert.rejects(closeSimeCanary({...config,SIME_CANARY_ENABLED:'false',SIME_CANARY_AUTHORIZED_RUN_ID:'999'},sha,
    ()=>assert.fail('HTTP must not happen')),/SIME_EXECUTION_NOT_APPROVED/);
});

test('cierre autenticado nunca elimina una concesión de otro propietario',async t=>{
  const f=fixture();t.after(()=>f.sqlite.close());f.sqlite.prepare('INSERT INTO lease VALUES(1,?,?)').run('sime-canary:999:1',f.now+600000);
  await assert.rejects(closeSimeCanary({...config,SIME_CANARY_ENABLED:'false'},sha,f.receiverFetch),/GATE_HTTP_409/);assert.equal(f.leases(),1);
});

test('cierre requiere credencial válida y no toca concesiones con token incorrecto',async t=>{
  const f=fixture();t.after(()=>f.sqlite.close());f.sqlite.prepare('INSERT INTO lease VALUES(1,?,?)').run('sime-canary:123:1',f.now+600000);
  await assert.rejects(closeSimeCanary({...config,SIME_CANARY_ENABLED:'false',SIME_IMPORT_SECRET:'wrong_synthetic_secret_12345678901234567890'},sha,f.receiverFetch),/GATE_HTTP_401/);
  assert.equal(f.leases(),1);
});

test('cierre sin credencial falla antes de HTTP',async()=>{
  await assert.rejects(closeSimeCanary({...config,SIME_CANARY_ENABLED:'false',SIME_IMPORT_SECRET:undefined},sha,
    ()=>assert.fail('HTTP must not happen')),/GATEWAY_SECRET_INVALID/);
});

test('cada ACK conserva un checkpoint; un fallo de persistencia detiene y cierra',async t=>{
  const f=fixture();t.after(()=>f.sqlite.close());const saved=[];
  const r=await runSimeCanaryPilot(config,sha,{sourceFetch:f.sourceFetch,receiverFetch:f.receiverFetch,clock:()=>f.now,
    onProgress:report=>{saved.push(structuredClone(report));if(saved.length===2)throw Error('CHECKPOINT_DISK_FAILED');}});
  assert.equal(f.batches,2);assert.equal(f.count(),2);assert.equal(r.data.closed,true);assert.equal(r.data.halted,true);
  assert.equal(saved[0].checksum,sealReport(saved[0].data).checksum);
  assert.equal(parseSimeCursor(saved[0].data.result.nextResumeAfter)[1],'sime:1001');
  assert.throws(()=>readSimeCheckpoint(saved[1],sha,'123'),/REVIEW_REQUIRED/);
});

test('workflow: manual, SHA actual fijado, run-id, sin secretos D1 ni schedule',()=>{
  const w=readFileSync(new URL('../.github/workflows/sime-import.yml',import.meta.url),'utf8');
  assert.match(w,/workflow_dispatch:/);assert.doesNotMatch(w,/^\s+schedule:/m);assert.match(w,/contents: read/);
  assert.match(w,/github.run_attempt == 1/);assert.match(w,/SIME_CANARY_AUTHORIZED_RUN_ID/);assert.match(w,/ref: \$\{\{ github.sha \}\}/);
  assert.match(w,/steps.verify.outcome == 'success'/);assert.doesNotMatch(w,/D1_IMPORT_TOKEN|CF_ACCOUNT_ID|contents: write|wrangler/);
});
