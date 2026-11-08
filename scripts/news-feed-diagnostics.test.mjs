import test from 'node:test';import assert from 'node:assert/strict';
import{classifyNewsFeedError,diagnoseNewsFeed}from'./news-feed-diagnostics.mjs';
import{runDailyNews}from'./news-via-receiver.mjs';import{initialDailyState}from'./daily-sync-state.mjs';import{NEWS_FEEDS}from'../lib/news-discovery.ts';
test('classifies HTTP, TLS, redirects, format, content, timeouts and network causes',()=>{
 for(const [error,type]of [[Error('NEWS_FEED_HTTP_403'),'HTTP'],[Object.assign(Error('certificate'),{code:'CERT_HAS_EXPIRED'}),'TLS'],[new TypeError('fetch failed',{cause:Error('unexpected redirect')}),'REDIRECT'],[Error('NEWS_FEED_EMPTY'),'FORMAT'],[Error('NEWS_FEED_CONTENT_TYPE_INVALID'),'CONTENT'],[new DOMException('timeout','TimeoutError'),'TIMEOUT'],[new TypeError('fetch failed',{cause:Object.assign(Error('lookup'),{code:'ENOTFOUND'})}),'NETWORK'],[Error('unclassified'),'UNKNOWN']])assert.equal(classifyNewsFeedError(error).type,type);
 assert.deepEqual(classifyNewsFeedError(Error('NEWS_FEED_HTTP_502')),{type:'HTTP',httpStatus:502});
});
test('reports only source, type and timestamps, never credentials, URL, article or stack',async()=>{
 for(const key of ['ministry','atep','infod']){const events=[],times=[new Date('2026-11-08T10:00:00Z'),new Date('2026-11-08T10:00:01Z')];
 const error=new TypeError('fetch failed https://example.test/?token=PRIVATE_TOKEN ARTICLE_PRIVATE',{cause:Object.assign(Error('PRIVATE_KEY'),{code:'CERT_HAS_EXPIRED'})});
 await assert.rejects(diagnoseNewsFeed({key,url:'https://example.test/?secret=PRIVATE_URL'},async()=>{throw error;},{report:e=>events.push(e),clock:()=>times.shift()}),new RegExp(`NEWS_${key.toUpperCase()}_TLS`));
 assert.equal(events[0].source,key);assert.equal(events[0].phase,'collection');assert.equal(events[0].failedAt,'2026-11-08T10:00:01.000Z');assert(!JSON.stringify(events).includes('PRIVATE'));assert.deepEqual(Object.keys(events[0]).sort(),['event','source','sourceName','phase','startedAt','failedAt','type'].sort());}
});
test('success is unchanged and does not emit a failure event',async()=>{let count=0;assert.deepEqual(await diagnoseNewsFeed({key:'infod'},async()=>[1,2],{report:()=>count++}),[1,2]);assert.equal(count,0);});
test('actual collector identifies the failed feed and makes no receiver writes',async()=>{
 for(const failed of NEWS_FEEDS){const sha='a'.repeat(40);let value={revision:'0'.repeat(40),state:initialDailyState('news',sha)},writes=0;const events=[],original=console.error;console.error=message=>events.push(JSON.parse(message));
 const store={load:async()=>structuredClone(value),save:async(_,state)=>{value={revision:String(state.data.generation).padStart(40,'0'),state};return structuredClone(value);}};
 try{await assert.rejects(runDailyNews({DAILY_SOURCES_ENABLED:'true',NEWS_DISCOVERY_ORIGIN:'https://canary.docentetuc.com.ar',NEWS_DISCOVERY_SECRET:'local_test_secret_123456789012345678901',GITHUB_RUN_ID:'1',GITHUB_RUN_ATTEMPT:'1'},sha,{store,receiverFetch:async()=>{writes++;throw Error('MUST_NOT_SEND');},sourceFetch:async url=>{if(url===failed.url)return new Response(null,{status:503});const feed=NEWS_FEEDS.find(f=>f.url===url);return new Response(feed.format==='rss'?'<rss><item><title>Local expired</title></item></rss>':'<feed><entry><title>Local expired</title></entry></feed>',{headers:{'Content-Type':'application/xml'}});}}),new RegExp(`NEWS_${failed.key.toUpperCase()}_HTTP`));assert.equal(events[0].source,failed.key);assert.equal(events[0].httpStatus,503);assert.equal(writes,0);assert.equal(value.state.data.inFlight,null);assert.equal(value.state.data.lastSuccessAt,null);}finally{console.error=original;}
 }
});
