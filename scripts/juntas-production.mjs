import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {runJuntasMaintenance} from './juntas-maintenance.mjs';
import {createJuntasGatewayDb} from './juntas-gateway-db.mjs';
import {JUNTA_EXTERNAL_SOURCES} from '../lib/junta-external-sources.ts';
export const JUNTAS_PRODUCTION_ORIGIN='https://docentetuc-juntas-1-2.possee41.workers.dev';
export function juntasProductionConfig(env,sha,{closing=false}={}){
  if(!/^[a-f0-9]{40}$/.test(sha||'')||env.JUNTAS_APPROVED_SHA!==sha||env.JUNTAS_DATABASE_ID!=='baaf5886-0123-4948-96da-aa7106424549'||env.JUNTAS_DATABASE_NAME!=='docentetuc-db'||env.JUNTAS_RECEIVER_ORIGIN!==JUNTAS_PRODUCTION_ORIGIN)throw Error('JUNTAS_PRODUCTION_IDENTITY_INVALID');
  if(!closing&&(env.JUNTAS_PRODUCTION_ENABLED!=='true'||env.JUNTAS_SCHEMA_READY!=='true'||!['workflow_dispatch','schedule'].includes(env.GITHUB_EVENT_NAME)||env.GITHUB_REPOSITORY!=='possee41/docentetuc'||env.GITHUB_RUN_ATTEMPT!=='1'||env.GITHUB_EVENT_NAME==='schedule'&&env.JUNTAS_DAILY_ENABLED!=='true'))throw Error('JUNTAS_PRODUCTION_DISABLED');
  const owner=env.JUNTAS_RUN_OWNER||`juntas-${env.GITHUB_RUN_ID||''}`;
  if(!/^juntas-[0-9]{1,30}$/.test(owner)||!/^[A-Za-z0-9_-]{32,}$/.test(env.JUNTAS_IMPORT_SECRET||'')||!closing&&!env.GOOGLE_DRIVE_API_KEY)throw Error('JUNTAS_CREDENTIAL_OR_OWNER_MISSING');
  return {origin:JUNTAS_PRODUCTION_ORIGIN,owner,secret:env.JUNTAS_IMPORT_SECRET,driveKey:env.GOOGLE_DRIVE_API_KEY};
}
export async function runJuntasProduction(env,sha,{fetcher=fetch,maintenance=runJuntasMaintenance,closing=false,clock=()=>Date.now()}={}){
  const cfg=juntasProductionConfig(env,sha,{closing});let deadline=Infinity;
  const receive=async(input,init={})=>{
    const url=new URL(input);if(url.origin!==cfg.origin)throw Error('JUNTAS_DESTINATION_FORBIDDEN');
    if(clock()>=deadline)throw Error('JUNTAS_WINDOW_EXPIRED');
    return fetcher(input,{...init,redirect:'error',headers:{...Object.fromEntries(new Headers(init.headers)),Authorization:`Bearer ${cfg.secret}`,'X-Import-Gate-Owner':cfg.owner},signal:AbortSignal.any([...(init.signal?[init.signal]:[]),AbortSignal.timeout(Math.max(1,Math.min(20000,deadline-clock())))])});
  };
  const gate=async action=>{
    // Closure is independent of deadline and enabled flags, but always authenticated.
    const response=await fetcher(cfg.origin+'/api/internal/import-gate',{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${cfg.secret}`,'Content-Type':'application/json'},body:JSON.stringify({source:'juntas',owner:cfg.owner,action,ttlSeconds:600}),signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error('JUNTAS_GATE_HTTP_'+response.status);const body=await response.json();
    if(body.ok!==true||body.source!=='juntas'||body.owner!==cfg.owner||action==='close'&&body.closed!==true)throw Error('JUNTAS_GATE_ACK_INVALID');return body;
  };
  if(closing){await gate('close');return {closed:true,owner:cfg.owner};}
  const identity=await receive(cfg.origin+'/api/internal/import-identity?source=juntas');if(!identity.ok)throw Error('JUNTAS_IDENTITY_HTTP_'+identity.status);const id=await identity.json();if(id.id!==env.JUNTAS_DATABASE_ID||id.name!==env.JUNTAS_DATABASE_NAME)throw Error('JUNTAS_IDENTITY_MISMATCH');
  let attempted=false,result;
  try{
    attempted=true;const opened=await gate('open'),expires=Date.parse(opened.expiresAt);if(!Number.isFinite(expires)||expires<=clock()||expires-clock()>600000)throw Error('JUNTAS_EXPIRATION_INVALID');deadline=expires-30000;
    const db=createJuntasGatewayDb({origin:cfg.origin,secret:cfg.secret},receive);
    const sourceFetch=(input,init={})=>{if(clock()>=deadline)throw Error('JUNTAS_WINDOW_EXPIRED');return fetcher(input,{...init,signal:AbortSignal.any([...(init.signal?[init.signal]:[]),AbortSignal.timeout(Math.max(1,deadline-clock()))])});};
    result=await maintenance({db,driveKey:cfg.driveKey,sources:JUNTA_EXTERNAL_SOURCES.filter(s=>['Padrones','Comunicados'].includes(s[1])),maxRequests:25,maxPublicationWrites:20,sourceFetch,receiverOverride:{token:cfg.secret,endpoint:p=>cfg.origin+p,receiverFetch:receive}});
    if(!Number.isInteger(result.publicationAttempts)||result.publicationAttempts<0||result.publicationAttempts>20||!Number.isInteger(result.sourceRequests)||result.sourceRequests<0||result.sourceRequests>25)throw Error('JUNTAS_BUDGET_INVALID');
    return {created:result.created,updated:result.updated,unchanged:result.unchanged,publicationAttempts:result.publicationAttempts,sourceRequests:result.sourceRequests,completed:result.completed,status:result.completed?'OK':'PARTIAL',coverage:result.coverage,roots:result.results?.map(row=>({rootId:row.rootId,created:row.created,updated:row.updated,unchanged:row.unchanged,publicationAttempts:row.publicationAttempts})),checkpointTransport:db.metrics(),closed:true};
  }finally{if(attempted)await gate('close');}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();const result=await runJuntasProduction(process.env,sha,{closing:process.argv.includes('--close')});console.log(JSON.stringify(result));}
 catch(error){console.error(/^[A-Z_0-9]+$/.test(error?.message||'')?error.message:'JUNTAS_PRODUCTION_FAILED');process.exitCode=1;}
}
