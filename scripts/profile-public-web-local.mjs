// Finite Workerd profiles using an existing public snapshot, never remote D1.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';import{createRequire}from'node:module';
import{connectWorkerdCpuProfiler}from'./workerd-cpu-profiler.mjs';
const [build,fixture,output]=process.argv.slice(2);if(!build||!fixture||!output)throw Error('Usage: <build> <public-fixture.json> <local-output>');
const root=path.resolve(build,'server'),out=path.resolve(output),data=JSON.parse(fs.readFileSync(fixture));
if(!data.publications?.length||data.publications.length>8000)throw Error('LOCAL_FIXTURE_LIMIT');
fs.mkdirSync(out,{recursive:true});
const {Miniflare}=createRequire(fs.realpathSync('node_modules/wrangler/package.json'))('miniflare');
const modules=fs.readdirSync(root,{recursive:true}).filter(f=>/\.(?:js|mjs)$/.test(f)).map(f=>({type:'ESModule',path:path.join(root,f)})).sort((a,b)=>a.path.endsWith(path.sep+'worker-entry.mjs')?-1:b.path.endsWith(path.sep+'worker-entry.mjs')?1:0);
const mf=new Miniflare({modules,modulesRoot:root,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],d1Persist:path.join(out,'d1'),cachePersist:path.join(out,'cache'),inspectorPort:0,outboundService:()=>{throw Error('LOCAL_PROFILE_EXTERNAL_NETWORK_FORBIDDEN');}});
let profiler;
try{
 await mf.ready;const db=await mf.getD1Database('DB');
 for(const statement of fs.readFileSync('lib/fixtures/juntas-production-schema-20261121.sql','utf8').split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
 const cols=Object.keys(data.publications[0]);assert.ok(cols.every(c=>/^[_a-z]+$/.test(c)));
 for(let start=0;start<data.publications.length;start+=100)await db.batch(data.publications.slice(start,start+100).map(row=>db.prepare('INSERT INTO publications('+cols.join(',')+') VALUES('+cols.map(()=>'?').join(',')+')').bind(...cols.map(c=>row[c]??null))));
 for(const row of data.sync){const keys=Object.keys(row);await db.prepare('INSERT INTO sync_state('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').bind(...keys.map(c=>row[c]??null)).run();}
 profiler=await connectWorkerdCpuProfiler(await mf.getInspectorURL());
 const results=[];
 for(const [name,route]of [['home-first','/'],['home-repeat-1','/'],['home-repeat-2','/'],['public-first','/api/public-app'],['public-hit','/api/public-app'],['public-bypass','/api/public-app?profile-local=1']].filter(([,route])=>process.argv[5]!=='--api-only'||route!=='/')){
  const {value,cpu,profile}=await profiler.measure(async()=>{const t=performance.now(),r=await mf.dispatchFetch('https://local.invalid'+route,{headers:{Accept:route==='/'?'text/html':'application/json'}}),body=await r.text();assert.equal(r.status,200,name);fs.writeFileSync(path.join(out,name+(route==='/'?'.html':'.json')),body);return {name,route,status:r.status,bytes:Buffer.byteLength(body),cache:r.headers.get('x-public-app-cache'),wallLocalMs:performance.now()-t,sha256:crypto.createHash('sha256').update(body).digest('hex')};});
  fs.writeFileSync(path.join(out,name+'.cpuprofile'),JSON.stringify(profile));
  results.push({...value,cpu});
 }
 fs.writeFileSync(path.join(out,'measurements.json'),JSON.stringify({localOnly:true,fixtureSha256:crypto.createHash('sha256').update(fs.readFileSync(fixture)).digest('hex'),publications:data.publications.length,results},null,2));
 console.log(JSON.stringify(results.map(r=>({name:r.name,bytes:r.bytes,cache:r.cache,cpuLocalSampledMs:r.cpu.activeSampledMs,lowResolution:r.cpu.lowResolution,wallLocalMs:r.wallLocalMs,top:r.cpu.topSampledFrames.slice(0,4)}))));
}finally{profiler?.close();await mf.dispose();}
