// Called only after the shared gateway verifies authentication, identity and lease owner.
import { importNewsCandidates, NEWS_FEEDS } from '../lib/news-discovery.ts';
import { normalizeNewsSourceUrl } from '../lib/news-editorial.ts';
const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const newsReceiver = {async fetch(request,env){
 if(request.method!=='POST')return reply({error:'METHOD_NOT_ALLOWED'},405);
 if(!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'JSON_REQUIRED'},415);
 let body;try{
  if(Number(request.headers.get('content-length')||0)>100000)return reply({error:'TOO_LARGE'},413);
  const reader=request.body?.getReader();if(!reader)return reply({error:'INVALID_BODY'},400);
  let bytes=0,text='';const decoder=new TextDecoder('utf-8',{fatal:true});
  while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>100000){await reader.cancel();return reply({error:'TOO_LARGE'},413);}text+=decoder.decode(value,{stream:true});}
  body=JSON.parse(text+decoder.decode());
 }catch{return reply({error:'INVALID_JSON'},400);}
 if(!body||!Array.isArray(body.articles)||body.articles.length<1||body.articles.length>5||body.maxCandidates!==1)return reply({error:'INVALID_BATCH'},400);
 const articles=[];
 for(const input of body.articles){
  const feed=NEWS_FEEDS.find(f=>f.key===input?.feedKey),url=normalizeNewsSourceUrl(input?.url);
  if(!feed||!url||new URL(url).hostname!==feed.host||typeof input.title!=='string'||!input.title.trim()||input.title.length>160||
   typeof input.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(input.fingerprint)||
   !['publishedAt','updatedAt'].every(k=>typeof input[k]==='string'&&Number.isFinite(Date.parse(input[k]))))return reply({error:'ARTICLE_INVALID'},400);
  articles.push({feed,url,title:input.title.trim(),fingerprint:input.fingerprint,publishedAt:new Date(input.publishedAt).toISOString(),updatedAt:new Date(input.updatedAt).toISOString()});
 }
 try{const result=await importNewsCandidates(env.DB,articles,new Date(),1);return reply({status:'OK',result,totalReceived:articles.length,autoPublish:false,notifications:false});}
 catch{return reply({error:'NEWS_PERSISTENCE_FAILED'},503);}
}};

export default newsReceiver;
