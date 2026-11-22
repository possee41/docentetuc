// Dedicated Juntas entry: reuses audited identity, authorization and expiring leases.
// No SIME/FDCI/training/news routes and no scheduled handler.
import gateway from './source-import-gateway.mjs';
const origin='https://docentetuc-juntas-1-2.possee41.workers.dev';
const paths=new Set(['/api/internal/import-identity','/api/internal/import-gate','/api/internal/juntas-checkpoint','/api/internal/public-source-import/juntas']);
const reply=(status,error)=>Response.json({error},{status,headers:{'Cache-Control':'no-store'}});
const juntasProduction = {async fetch(request,env){
  const url=new URL(request.url);
  if(url.origin!==origin||!paths.has(url.pathname))return reply(404,'NOT_FOUND');
  if(env.IMPORT_DATABASE_ID!=='baaf5886-0123-4948-96da-aa7106424549'||env.IMPORT_DATABASE_NAME!=='docentetuc-db'||
     env.IMPORT_GATE_ALLOWED_SOURCE!=='juntas'||env.IMPORT_GATE_ENABLED!=='false'||env.IMPORT_GATE_LEASE_REQUIRED!=='true')return reply(503,'JUNTAS_CLOSED');
  let close=false;
  if(url.pathname==='/api/internal/import-identity'&&url.searchParams.get('source')!=='juntas')return reply(404,'NOT_FOUND');
  if(url.pathname==='/api/internal/import-gate'){
    if(request.method!=='POST'||!request.headers.get('content-type')?.startsWith('application/json'))return reply(400,'INVALID_REQUEST');
    const reader=request.body?.getReader();if(!reader)return reply(400,'INVALID_REQUEST');
    let size=0,text='';const decoder=new TextDecoder();
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024){await reader.cancel();return reply(413,'TOO_LARGE');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();
      const p=JSON.parse(text);if(p.source!=='juntas'||!['open','close'].includes(p.action)||p.action==='open'&&(!Number.isInteger(p.ttlSeconds)||p.ttlSeconds<60||p.ttlSeconds>600))return reply(400,'INVALID_REQUEST');close=p.action==='close';
      request=new Request(request.url,{method:'POST',headers:request.headers,body:text});
    }catch{return reply(400,'INVALID_REQUEST');}
  }
  // Disabling new imports must never disable authenticated emergency closure.
  if(env.JUNTAS_PRODUCTION_ENABLED!=='true'&&!close&&url.pathname!=='/api/internal/import-identity')return reply(503,'JUNTAS_CLOSED');
  return gateway.fetch(request,{DB:env.DB,IMPORT_DATABASE_ID:env.IMPORT_DATABASE_ID,IMPORT_DATABASE_NAME:env.IMPORT_DATABASE_NAME,
    IMPORT_GATE_ALLOWED_SOURCE:'juntas',IMPORT_GATE_ENABLED:'false',IMPORT_GATE_LEASE_REQUIRED:'true',JUNTAS_IMPORT_SECRET:env.JUNTAS_IMPORT_SECRET,FDCI_EXTERNAL_ENABLED:'false'});
}};

export default juntasProduction;
