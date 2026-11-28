import assert from 'node:assert/strict';
import test from 'node:test';
import { PublicSnapshot } from '../lib/public-snapshot-canary.ts';

const secret='synthetic', id='0979f2c2-0e96-4b5c-811b-adcccc2dbd6d';
const request=(method='GET',token=secret)=>new Request(`https://test.invalid${method==='POST'?'/__fdci_public_snapshot_canary_close':'/api/public-app'}`,{method,headers:{'X-DT-Canary-Secret':token}});
function fixture({failAlarm=false,failAll=false,readGate=false}={}){
  let now=Date.now(); const realNow=Date.now; Date.now=()=>now;
  const values=new Map(); let alarmFails=failAlarm,allFails=failAll,queries=0,resolveBuild,tail=Promise.resolve();
  let readStarted; const started=new Promise(r=>readStarted=r), holdBuild=readGate?new Promise(r=>resolveBuild=r):null;
  const storage={get:async k=>values.get(k),put:async(k,v)=>values.set(k,v),delete:async k=>values.delete(k),
    transaction:async fn=>{const previous=tail;let release;tail=new Promise(r=>release=r);await previous;try{return await fn({get:storage.get,put:storage.put,delete:storage.delete})}finally{release()}},
    deleteAlarm:async()=>{if(alarmFails)throw Error('alarm')},deleteAll:async()=>{if(allFails)throw Error('all');values.clear()}};
  const bindings={PUBLIC_SNAPSHOT_CANARY_SECRET:secret,JUNTAS_CANARY_DATABASE_ID:id,
    PUBLIC_SNAPSHOT_CANARY_UNTIL:new Date(now+60_000).toISOString(),
    DB:{prepare:()=>({first:async()=>({database_name:'docentetuc-sources-canary-1-2',database_id:id})})}};
  const make=()=>{const obj=new PublicSnapshot({storage},bindings);obj.coordinator.source.revision=async()=>{queries++;return 1};obj.coordinator.source.build=async()=>{readStarted();if(holdBuild)await holdBuild;return {body:'{"publications":[]}',boundary:Infinity}};return obj};
  return {make,bindings,values,started,release:()=>resolveBuild?.(),advance:()=>{now+=301_000;bindings.PUBLIC_SNAPSHOT_CANARY_UNTIL=new Date(now-1).toISOString()},
    stats:()=>({queries,storageItems:values.size}),failAlarm:v=>alarmFails=v,failAll:v=>allFails=v,restore:()=>{Date.now=realNow}};
}

test('two GET only, third and concurrent excess rejected across object restart',async()=>{
  const h=fixture();try{const obj=h.make();
    const rs=await Promise.all([obj.fetch(request()),obj.fetch(request()),obj.fetch(request())]);
    assert.deepEqual(rs.map(r=>r.status).sort(),[200,200,404]);
    assert.equal(await h.make().fetch(request()).then(r=>r.status),404);
  }finally{h.restore()}
});

test('close before expiry blocks reads and preserves storage; after expiry it cleans and stays closed',async()=>{
  const h=fixture({readGate:true});try{const obj=h.make();const read=obj.fetch(request());await h.started;
    const phaseAWork=obj.fetch(request('POST'));
    for(let i=0;i<20&&!h.values.has('canary:closed');i++)await new Promise(resolve=>setImmediate(resolve));
    assert.equal(h.values.get('canary:closed'),true);
    assert.equal((await obj.fetch(request())).status,404);
    assert.ok(h.values.size>0);
    h.release();assert.equal((await read).status,200);
    const phaseA=await phaseAWork;assert.equal(phaseA.status,202);assert.equal((await phaseA.json()).closed,false);
    assert.ok(h.values.size>0);
    h.advance();const phaseB=await obj.fetch(request('POST'));assert.equal(phaseB.status,200);assert.equal((await phaseB.json()).closed,true);
    assert.equal(h.stats().storageItems,0);assert.equal((await h.make().fetch(request())).status,404);
  }finally{h.restore()}
});

test('identity and key failures reject; deleteAlarm/deleteAll failures do not claim closed and can be retried',async()=>{
  const h=fixture();try{const obj=h.make();
    assert.equal((await obj.fetch(request('POST','bad'))).status,403);
    const missing={...h.bindings,DB:{prepare:()=>({first:async()=>null})}};
    assert.equal((await new PublicSnapshot({storage:{get:async()=>undefined,put:async()=>{} }},missing).fetch(request('POST'))).status,403);
    h.advance();
    for(const failure of ['alarm','all']){
      const failHarness=fixture({[failure==='alarm'?'failAlarm':'failAll']:true});
      try{failHarness.advance();const failing=failHarness.make();
        const response=await failing.fetch(request('POST'));assert.equal(response.status,500);assert.notEqual((await response.json()).closed,true);
        assert.equal(failHarness.values.get('canary:closed'),true);
        if(failure==='alarm')failHarness.failAlarm(false);else failHarness.failAll(false);
        const retry=await failHarness.make().fetch(request('POST'));assert.equal(retry.status,200);assert.equal((await retry.json()).closed,true);
        assert.equal(failHarness.values.size,0);
      }finally{failHarness.restore()}
    }
  }finally{h.restore()}
});

test('closed snapshot is never rebuilt; request counter adds no D1 queries',async()=>{
  const h=fixture();try{const obj=h.make();
    assert.equal((await obj.fetch(request())).status,200);const q1=h.stats().queries;
    assert.equal((await obj.fetch(request())).status,200);assert.equal(h.stats().queries,q1);
    assert.equal((await obj.fetch(request())).status,404);assert.equal(h.stats().queries,q1);
    await obj.fetch(request('POST'));h.advance();await obj.fetch(request('POST'));
    assert.equal(h.stats().storageItems,0);assert.equal((await h.make().fetch(request())).status,404);
    assert.equal(h.stats().queries,q1);
  }finally{h.restore()}
});
