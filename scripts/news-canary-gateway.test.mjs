import test from 'node:test';
import assert from 'node:assert/strict';
import gateway from '../workers/news-canary-gateway.mjs';
test('exclusive News canary fails closed, requires auth and rejects other sources/TTL', async () => {
  let reads=0;
  const env={DAILY_SOURCES_ENABLED:'true',DAILY_RECEIVER_NAME:'docentetuc-news-canary-1-2',
    IMPORT_DATABASE_ID:'853e2f5d-89b1-46a3-9c1c-5cbd46784756',IMPORT_DATABASE_NAME:'docentetuc-web-canary-1-2',
    IMPORT_GATE_ENABLED:'false',IMPORT_GATE_LEASE_REQUIRED:'true',IMPORT_GATE_ALLOWED_SOURCE:'news',
    NEWS_IMPORT_SECRET:'local_news_secret_12345678901234567890',
    DB:{prepare(sql){reads++; return {first:async()=>sql.includes('import_gateway_identity')?
      {database_name:env.IMPORT_DATABASE_NAME,database_id:env.IMPORT_DATABASE_ID}:null};}}};
  const request=(path,body,auth)=>new Request('https://local.test'+path,{method:body?'POST':'GET',
    headers:{...(auth?{Authorization:`Bearer ${env.NEWS_IMPORT_SECRET}`}:{ }),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await gateway.fetch(request('/api/internal/import-identity?source=news'),{...env,DAILY_SOURCES_ENABLED:'false'})).status,503);
  assert.equal((await gateway.fetch(request('/api/internal/import-identity?source=news'),env)).status,401);assert.equal(reads,0);
  assert.equal((await gateway.fetch(request('/api/internal/import-identity?source=news',null,true),env)).status,200);
  assert.equal((await gateway.fetch(request('/api/internal/import-identity?source=sime',null,true),env)).status,404);
  assert.equal((await gateway.fetch(request('/api/internal/import-gate',{source:'news',action:'open',ttlSeconds:601},true),env)).status,400);
  assert.equal((await gateway.fetch(request('/api/internal/news-discovery',{articles:[]},true),env)).status,503);
  assert.equal((await gateway.fetch(request('/api/internal/import-identity?source=news',null,true),{...env,IMPORT_DATABASE_ID:'baaf5886-0123-4948-96da-aa7106424549'})).status,503);
});
