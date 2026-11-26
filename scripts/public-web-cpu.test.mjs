import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import{DatabaseSync}from'node:sqlite';
import path from 'node:path';import{createRequire}from'node:module';
import{APP_PUBLICATIONS_QUERY}from'../lib/app-publications-query.ts';
import{PUBLIC_APP_ROWS_QUERY,PUBLIC_APP_TRANSPORT_QUERY,publicAppApi,getPublicApp}from'../lib/public-app.ts';
import{juntasDocument}from'./juntas-document.mjs';

test('public JSON rows preserve every column, value, order, large metadata, nulls and escaping',()=>{
 const db=new DatabaseSync(':memory:');try{
  db.exec(fs.readFileSync('lib/fixtures/juntas-production-schema-20261121.sql','utf8'));
  const insert=db.prepare("INSERT INTO publications(id,source,external_id,kind,category,title,summary,official_url,content_hash,metadata,circuit_confidence,starts_at,ends_at) VALUES(?,'Fuente',?,'vacante','Vacantes',?,?, 'https://local.invalid/', ?,?,?,?,?)");
  for(let i=0;i<420;i++){const id='fixture-'+String(i).padStart(3,'0');insert.run(id,id,'Título "docente"\nñ '+i,'Texto oficial\n'+i,'a'.repeat(64),JSON.stringify({text:'\\"\nñ'.repeat(i===419?16000:1)}),i%2,i%3?null:'2027-01-01',i%5?null:'2020-01-01');}
  const original=db.prepare(APP_PUBLICATIONS_QUERY).all(),encoded=db.prepare(PUBLIC_APP_ROWS_QUERY).all().map(row=>JSON.parse(row.row_json));
  assert.equal(original.length,400);assert.deepEqual(encoded,JSON.parse(JSON.stringify(original)));assert.equal(Object.keys(encoded[0]).length,db.prepare('PRAGMA table_info(publications)').all().length);
  assert.ok(encoded.every(x=>typeof x.metadata==='string'));assert.ok(encoded.some(x=>x.starts_at===null));assert.ok(encoded.some(x=>x.metadata.length>16000));
  assert.deepEqual(db.prepare(PUBLIC_APP_TRANSPORT_QUERY).all().map(row=>JSON.parse(Buffer.from(row.row_hex,'hex').toString('utf8'))),encoded);
 }finally{db.close();}
});

test('fast public endpoint leaves private/API/RSC operations to existing authenticated handlers',async()=>{
 let calls=0;const forbidden=()=>{calls++;throw Error('NO_DATABASE_ACCESS');};
 for(const path of ['/api/app','/api/personalized','/api/admin','/api/boards','/api/auth/status'])assert.equal(publicAppApi(new Request('https://local.invalid'+path),forbidden),null);
 for(const method of ['POST','PUT','DELETE','HEAD'])assert.equal(publicAppApi(new Request('https://local.invalid/api/public-app',{method}),forbidden),null);
 assert.equal(calls,0);
 const documents={inicio:'<!DOCTYPE html><h1>Public shell</h1>',padrones:'padrones',comunicados:'comunicados'};
 for(const headers of [{},{cookie:'session=synthetic-user-A'},{cookie:'session=synthetic-user-B'}]){
  const r=juntasDocument(new Request('https://local.invalid/',{headers}),documents);assert.equal(await r.text(),documents.inicio);assert.equal(r.headers.get('set-cookie'),null);assert.equal(r.headers.get('cache-control'),'no-store');
 }
 for(const path of ['/?section=perfil','/?section=cuentas','/?section=inicio','/?publication=fixture','/?_rsc=test','/api/app'])assert.equal(juntasDocument(new Request('https://local.invalid'+path),documents),null);
 for(const headers of [{RSC:'1'},{'Next-Router-State-Tree':'synthetic'},{Accept:'text/x-component'}])assert.equal(juntasDocument(new Request('https://local.invalid/',{headers}),documents),null);
 assert.equal(await juntasDocument(new Request('https://local.invalid/',{method:'HEAD'}),documents).text(),'');
 const failed=await getPublicApp(new Request('https://local.invalid/api/public-app'),forbidden);assert.equal(failed.status,503);assert.equal(failed.headers.get('cache-control'),'no-store');
});

test('MISS prepares one immutable body without clone; cache and client independently receive identical 2 MB content',async()=>{
 const saved=Object.getOwnPropertyDescriptor(globalThis,'caches'),clone=Response.prototype.clone;
 const records=Array.from({length:400},(_,i)=>({id:'local-'+i,metadata:JSON.stringify({text:'\\"ñ'.repeat(1500)})}));
 const encoded=records.map(row=>[Buffer.from(JSON.stringify(row)).toString('hex')]);let reads=0,stored=null,storedHeaders=null;
 const cache={async match(){return stored?new Response(stored,{headers:storedHeaders}):undefined;},async put(key,response){assert.equal(key.headers.has('authorization'),false);assert.equal(response.headers.get('cache-control'),'public, max-age=60');storedHeaders=new Headers(response.headers);stored=await response.arrayBuffer();}};
 Object.defineProperty(globalThis,'caches',{configurable:true,value:{default:cache}});Response.prototype.clone=()=>{throw Error('RESPONSE_TEE_MUST_NOT_BE_USED');};
 try{
  const db={prepare(sql){return{raw:async()=>{assert.match(sql,/AS row_hex/);reads++;return encoded;},all:async()=>{reads++;return{results:[]};}};}};
  const response=await getPublicApp(new Request('https://local.invalid/api/public-app'),()=>db);
  assert.equal(response.status,200);assert.equal(response.headers.get('x-public-app-cache'),'MISS');assert.equal(reads,2);
  const client=await response.arrayBuffer();assert.ok(client.byteLength>1_900_000);assert.deepEqual(new Uint8Array(client),new Uint8Array(stored));assert.deepEqual(JSON.parse(new TextDecoder().decode(client)).publications,records);
  const hit=await getPublicApp(new Request('https://local.invalid/api/public-app'),()=>{throw Error('CACHE_HIT_MUST_NOT_READ_D1');});assert.equal(hit.headers.get('x-public-app-cache'),'HIT');assert.deepEqual(new Uint8Array(await hit.arrayBuffer()),new Uint8Array(stored));
 }finally{Response.prototype.clone=clone;if(saved)Object.defineProperty(globalThis,'caches',saved);else delete globalThis.caches;}
});

test('compiled homepage equals same-build SSR with cookies and future date, without DB or network',async()=>{
 const {default:documents}=await import('../dist/server/juntas-shell.mjs');
 assert.ok(documents.inicio.includes('<!DOCTYPE html>'));assert.ok(documents.inicio.includes('DocenteTuc'));
 // Current record data enters only through the runtime API, never this HTML.
 assert.ok(!documents.inicio.includes('PDVC-20261106-145502'));
 const {Miniflare}=createRequire(fs.realpathSync('node_modules/wrangler/package.json'))('miniflare'),root=path.resolve('dist/server');
 const entry=path.join(root,'public-home-test-entry.mjs');
 const code=`import app from './index.js';const OriginalDate=Date;export default {async fetch(request,env,ctx){if(request.headers.has('x-test-future'))globalThis.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:['2050-03-01T12:00:00Z']));}static now(){return +new OriginalDate('2050-03-01T12:00:00Z');}};return app.fetch(request,env,ctx);}};`;
 const modules=[{type:'ESModule',path:entry,contents:code},...fs.readdirSync(root,{recursive:true}).filter(f=>/\.(?:js|mjs)$/.test(f)&&f!=='public-home-test-entry.mjs').map(f=>({type:'ESModule',path:path.join(root,f)}))];
 const mf=new Miniflare({modules,modulesRoot:root,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],outboundService:()=>{throw Error('EXTERNAL_NETWORK_FORBIDDEN');}});
 try{for(const headers of [{Accept:'text/html'},{Accept:'text/html',cookie:'session=synthetic-user-A','x-test-future':'1'}]){
  const r=await mf.dispatchFetch('https://local.invalid/',{headers});assert.equal(r.status,200);assert.equal(r.headers.get('set-cookie'),null);assert.equal(await r.text(),documents.inicio);
 }}finally{await mf.dispose();}
});
