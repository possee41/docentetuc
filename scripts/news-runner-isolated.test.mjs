import test from 'node:test';import assert from 'node:assert/strict';
import{runDailyNews}from'./news-via-receiver.mjs';import{initialDailyState}from'./daily-sync-state.mjs';
const sha='a'.repeat(40),origin='https://docentetuc-news-canary-1-2.possee41.workers.dev';
const config={DAILY_SOURCES_ENABLED:'true',NEWS_DISCOVERY_ORIGIN:origin,NEWS_DISCOVERY_SECRET:'local_news_secret_123456789012345678901234',
 IMPORT_GATEWAY_TARGET:'canary',IMPORT_GATEWAY_ORIGIN:origin,IMPORT_GATEWAY_DATABASE_NAME:'docentetuc-web-canary-1-2',IMPORT_GATEWAY_DATABASE_ID:'853e2f5d-89b1-46a3-9c1c-5cbd46784756',
 GITHUB_RUN_ID:'123456',GITHUB_RUN_ATTEMPT:'1'};
test('exact release runner imports helpers, isolates TLS, confirms ACK and closes lease',async()=>{
 let state=initialDailyState('news',sha),requests=0,writes=0;const gates=[];
 const store={load:async()=>({state,revision:'b'.repeat(40)}),save:async(_,next)=>{state=next;return{state,revision:'b'.repeat(40)};}};
 const sourceFetch=async url=>{requests++;if(String(url).includes('educaciontuc'))throw Object.assign(new TypeError('fetch failed'),{cause:{code:'UNABLE_TO_VERIFY_LEAF_SIGNATURE'}});
 if(String(url).includes('blogspot'))return new Response('<feed><entry><title>expired local</title></entry></feed>',{headers:{'Content-Type':'application/atom+xml'}});
 return new Response('<rss><channel><item><title>Local only</title><link>https://red.infd.edu.ar/local-only/</link><pubDate>Sun, 08 Nov 2026 12:00:00 GMT</pubDate></item></channel></rss>',{headers:{'Content-Type':'application/rss+xml'}});};
 const receiverFetch=async(url,init)=>{const path=new URL(url).pathname;
 if(path.endsWith('import-identity'))return Response.json({id:config.IMPORT_GATEWAY_DATABASE_ID,name:config.IMPORT_GATEWAY_DATABASE_NAME});
 if(path.endsWith('import-gate')){const body=JSON.parse(init.body);gates.push(body.action);return Response.json({ok:true,source:'news',owner:'123456-1',closed:true,expiresAt:new Date(Date.now()+600000).toISOString()});}
 writes++;assert.equal(init.headers['X-Import-Gate-Owner'],'123456-1');return Response.json({status:'OK',autoPublish:false,notifications:false,totalReceived:1,result:{created:1,updated:0,unchanged:0,skipped:0}});};
 const result=await runDailyNews(config,sha,{store,sourceFetch,receiverFetch,now:new Date('2026-11-08T20:00:00Z')});
 assert.equal(requests,3);assert.equal(writes,1);assert.deepEqual(gates,['open','close']);assert.equal(result.status,'PARTIAL');assert.equal(result.completed,false);
 assert.equal(state.data.pending,0);assert.equal(state.data.halted,false);assert.equal(state.data.inFlight,null);assert.equal(Object.keys(state.data.confirmed).length,1);assert.equal(state.data.lastSuccessAt,null);
});
