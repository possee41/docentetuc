// One bounded coordinator. Google requests/parsing stay on Node, not Workers.
import {runJuntasCheckpoint,folderSignature,padronWorkScope,padronCurrentCoverage} from './import-juntas-checkpoint.mjs';
import {JUNTA_EXTERNAL_SOURCES} from '../lib/junta-external-sources.ts';
import {createJuntasSourceFetch} from './juntas-source-fetch.mjs';
const day=86400000;
export async function runJuntasMaintenance(options){
  const {sources=JUNTA_EXTERNAL_SOURCES,now=new Date()}=options;
  if((options.maxRequests??25)!==25 || (options.maxPublicationWrites??20)!==20)throw Error('JUNTAS_MAINTENANCE_BUDGET_INVALID');
  if(!Number.isFinite(now.getTime()) || !sources.length || sources.length>13 || new Set(sources.map(s=>s[0])).size!==sources.length ||
    sources.filter(s=>s[1]==='Comunicados').length>7 || sources.filter(s=>s[1]==='Padrones').length>4 ||
    sources.filter(s=>s[1]==='Llamados abiertos').length>2 || sources.some(s=>!['Comunicados','Padrones','Llamados abiertos'].includes(s[1])))throw Error('JUNTAS_MAINTENANCE_SCOPE_INVALID');
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Tucuman',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const fairBoards=options.comunicadosOnlyFair===true;
  if(fairBoards&&sources.some(source=>source[1]!=='Comunicados'))throw Error('JUNTAS_MAINTENANCE_SCOPE_INVALID');
  // Seven source documents represent four Juntas. Reserve six real HTTP hops
  // per Junta; the remaining request rotates daily between them.
  const boards=[...new Set(sources.map(source=>source[2]))];
  const extraBoard=boards[Math.floor(now.getTime()/day)%boards.length];
  const boardRequests=new Map(boards.map(board=>[board,0]));
  const boardWrites=new Map(boards.map(board=>[board,0]));
  const boardLimit=board=>fairBoards?6+Number(board===extraBoard):25;
  const boardForRoot=new Map(sources.map(source=>[source[0],source[2]]));
  const dailyWindow=now.getTime()-Date.parse(today+'T00:00:00-03:00')+1,weeklyWindow=dailyWindow+6*day;
  const rotate=rows=>{if(!rows.length)return rows;const offset=Math.floor(now.getTime()/day)%rows.length;return [...rows.slice(offset),...rows.slice(0,offset)];};
  const results=[],probes=new Map();
  const started=performance.now(),clock=()=>new Date(now.getTime()+Math.max(0,performance.now()-started));
  const documentResponses=new Map();let sourceRequests=0,cachedDocumentReads=0;
  const sourceChecks=[];let activeRoot=null;
  const transport=createJuntasSourceFetch({fetcher:(input,init)=>{
    if(fairBoards){const board=boardForRoot.get(activeRoot),used=boardRequests.get(board)||0;
      if(used>=boardLimit(board))throw Error('JUNTAS_REQUEST_BUDGET_EXHAUSTED');
      boardRequests.set(board,used+1);
    }
    return (options.sourceFetch||fetch)(input,init);
  }});
  const checkedFetch=async(input,init)=>{
    const start=performance.now(),url=new URL(String(input));
    const check={rootId:activeRoot,kind:url.hostname==='docs.google.com'?'document':'drive',phase:'headers'};
    sourceChecks.push(check);
    try{const response=await transport.fetch(input,init);check.status=response.status;return response;}
    catch(error){
      check.error=/timeout|abort/i.test(error?.name||'')?'timeout':'network';
      const code=error?.cause?.code;
      if(/^(?:UND_ERR_(?:CONNECT_TIMEOUT|HEADERS_TIMEOUT|BODY_TIMEOUT)|EAI_AGAIN|ENOTFOUND|ECONNRESET|ETIMEDOUT)$/.test(code||''))check.transportCode=code;
      throw error;
    }finally{sourceRequests=transport.metrics().requests;check.elapsedMs=Math.round(performance.now()-start);}
  };
  const sourceFetch=async(input,init)=>{
    const url=new URL(String(input)),key=url.toString();
    if(url.hostname==='docs.google.com'&&url.pathname.endsWith('/export')){
      if(documentResponses.has(key))cachedDocumentReads++;
      else{documentResponses.set(key,Promise.resolve().then(()=>checkedFetch(input,init)));}
      return (await documentResponses.get(key)).clone();
    }
    return checkedFetch(input,init);
  };
  const run=async(source,limits)=>{
    const remainingWrites=20-results.reduce((n,result)=>n+result.publicationAttempts,0);
    const remainingRequests=25-sourceRequests;
    const remainingBoard=boardLimit(source[2])-(boardRequests.get(source[2])||0);
    const remainingBoardWrites=fairBoards?5-(boardWrites.get(source[2])||0):20;
    if(remainingWrites<1||remainingRequests<1||remainingBoard<1||remainingBoardWrites<1)return null;
    activeRoot=source[0];
    const result=await runJuntasCheckpoint({...options,sourceFetch,clock,rootOnly:false,sources:[source],now,
      documentTimeoutMs:options.documentTimeoutMs??45_000,prioritizePadrones:true,prioritizeRecentNotices:fairBoards,...limits,
      maxRequests:Math.min(limits.maxRequests,remainingRequests,remainingBoard),maxPublicationWrites:Math.min(limits.maxPublicationWrites,remainingWrites,remainingBoardWrites)});
    if(fairBoards)boardWrites.set(source[2],(boardWrites.get(source[2])||0)+result.publicationAttempts);
    results.push({rootId:source[0],scope:limits.rootOnly?'root':'full',...result});return result;
  };
  const comunicados=rotate(sources.filter(s=>s[1]==='Comunicados'));
  const padrones=rotate(sources.filter(s=>s[1]==='Padrones'));
  const llamados=rotate(sources.filter(s=>s[1]==='Llamados abiertos'));
  const writesLeft=()=>20-results.reduce((n,result)=>n+result.publicationAttempts,0);
  // One daily document check per root. Superior's child logs publish a notice
  // on their first slot; the four existing roots keep their index slot.
  // Preserve a probe and a deep slot per Padrón plus one slot per Llamado.
  for(const source of comunicados)
    await run(source,{maxRequests:1,maxPublicationWrites:source[0].startsWith('com-superior')?1:2,refreshAfterMs:dailyWindow});
  for(const source of padrones)
    probes.set(source[0],await run(source,{maxRequests:1,maxPublicationWrites:1,refreshAfterMs:dailyWindow,rootOnly:true}));
  for(const [index,source] of padrones.entries()) {
    const full=await options.db.prepare("SELECT state_json,status,last_success_at FROM juntas_import_checkpoint WHERE root_id=?").bind(source[0]).first();
    const state=full?JSON.parse(full.state_json):null;
    const sweep=Date.parse(state?.currentSweepAt||'invalid');
    const refreshCurrentFolders=!!state && !state.queue.some(entry=>padronWorkScope(entry,now)!=='history') &&
      (!Number.isFinite(sweep)||+now-sweep>7*day);
    await run(source,{maxRequests:comunicados.length>4?2:3,
      maxPublicationWrites:Math.max(1,Math.min(4,Math.floor((writesLeft()-llamados.length)/(padrones.length-index)))),
      refreshAfterMs:probes.get(source[0])?.structureChanged?0:weeklyWindow,
      folderUpdates:probes.get(source[0])?.changedFolders,refreshCurrentFolders});
  }
  for(const source of llamados)
    await run(source,{maxRequests:2,maxPublicationWrites:1,refreshAfterMs:dailyWindow});
  // Borrow unused reservations for pending work, rotating boards. Source errors
  // are not retried; ambiguous receiver errors already throw and stop the run.
  const pendingOrder=rotate(sources);
  let idle=0;
  for(let step=0;step<80&&pendingOrder.length&&idle<pendingOrder.length;step++){
    const requestsLeft=25-sourceRequests;
    const writesLeft=20-results.reduce((n,result)=>n+result.publicationAttempts,0);
    if(requestsLeft<1||writesLeft<1)break;
    const source=pendingOrder[step%pendingOrder.length];
    if(fairBoards&&((boardRequests.get(source[2])||0)>=boardLimit(source[2])||(boardWrites.get(source[2])||0)>=5)){idle++;continue;}
    const current=results.at(-1).health.find(row=>row.root_id===source[0]);
    const probe=results.at(-1).health.find(row=>row.root_id===`probe:${source[0]}`);
    const fullPending=current?.status==='PARTIAL'&&!current.error_code;
    const probePending=source[1]==='Padrones'&&probe?.status==='PARTIAL'&&!probe.error_code;
    if(!fullPending&&!probePending){idle++;continue;}
    const priorRequests=sourceRequests,priorWrites=20-writesLeft;
    await run(source,{maxRequests:1,maxPublicationWrites:source[1]==='Padrones'?Math.max(1,Math.min(4,Math.floor(writesLeft/pendingOrder.length))):1,rootOnly:probePending&&(!fullPending||step%2===0),refreshAfterMs:source[1]==='Padrones'?weeklyWindow:dailyWindow});
    idle=sourceRequests===priorRequests&&results.reduce((n,r)=>n+r.publicationAttempts,0)===priorWrites?idle+1:0;
  }
  const health=results.at(-1)?.health || [];
  const unacknowledged=new Set(),currentCoverage=new Map();
  for(const source of sources.filter(s=>s[1]==='Padrones')){
    const read=async id=>options.db.prepare("SELECT state_json,status,last_success_at FROM juntas_import_checkpoint WHERE root_id=?").bind(id).first();
    const full=await read(source[0]),probe=await read(`probe:${source[0]}`);
    const versions=full?JSON.parse(full.state_json).folderVersions||{}:{};
    const updates=probe?JSON.parse(probe.state_json).folderUpdates||{}:{};
    if(Object.values(updates).some(folder=>versions[folder.id]!==folderSignature(folder)))unacknowledged.add(source[0]);
    const error=health.some(row=>[source[0],`probe:${source[0]}`].includes(row.root_id)&&row.error_code);
    const pendingCurrent=Object.values(updates).some(folder=>versions[folder.id]!==folderSignature(folder)&&padronWorkScope(folder,now)!=='history');
    currentCoverage.set(source[0],padronCurrentCoverage(full,probe,now,{error,unacknowledged:pendingCurrent}));
  }
  const coverage=sources.map(([rootId,category,junta])=>{
    const full=health.find(row=>row.root_id===rootId),probe=health.find(row=>row.root_id===`probe:${rootId}`);
    const complete=full?.status==='OK' && (category!=='Padrones'||probe?.status==='OK'&&!unacknowledged.has(rootId));
    return {rootId,category,junta,status:complete?'OK':'PARTIAL',lastCompleteAt:full?.last_success_at||null,
      lastRootCheckAt:probe?.last_success_at||null,error:probe?.error_code||full?.error_code||null,
      ...(category==='Padrones'?currentCoverage.get(rootId):{})};
  });
  // Category health must include a failed root probe, not only the older deep scan.
  const oldHealth=(await options.db.prepare("SELECT source,sync_status,last_successful_sync_at,error_code FROM sync_state WHERE source IN ('Padrones','Comunicados','Llamados abiertos')").bind().all()).results;
  for(const category of new Set(sources.map(source=>source[1]))){
    const expected=JUNTA_EXTERNAL_SOURCES.filter(source=>source[1]===category);
    const selected=coverage.filter(source=>source.category===category);
    const complete=selected.length===expected.length&&selected.every(source=>source.status==='OK');
    const status=complete?'OK':'PARTIAL',error=selected.some(source=>source.error)?'JUNTAS_PARTIAL_SOURCE':null;
    const previous=oldHealth.find(source=>source.source===category);
    const success=complete?selected.map(source=>source.lastCompleteAt).sort()[0]:previous?.last_successful_sync_at||null;
    if(previous?.sync_status===status&&previous?.last_successful_sync_at===success&&(previous?.error_code||null)===error)continue;
    await options.db.prepare(`INSERT INTO sync_state(source,synced_at,item_count,last_attempt_at,last_successful_sync_at,sync_status,error_code)
      VALUES(?,'',0,?,?,?,?) ON CONFLICT(source) DO UPDATE SET
      last_attempt_at=excluded.last_attempt_at,last_successful_sync_at=excluded.last_successful_sync_at,
      sync_status=excluded.sync_status,error_code=excluded.error_code`).bind(category,now.toISOString(),success,status,error).run();
  }
  return {completed:coverage.length>0&&coverage.every(s=>s.status==='OK'),coverage,
    ...(fairBoards?{boardRequests:Object.fromEntries(boardRequests),boardWrites:Object.fromEntries(boardWrites)}:{}),
    sourceRequests,cachedDocumentReads,sourceChecks,httpTrace:transport.metrics().trace,requestBudgetUsed:sourceRequests,
    checkpointRequestSteps:results.reduce((n,r)=>n+r.sourceRequests,0),publicationAttempts:results.reduce((n,r)=>n+r.publicationAttempts,0),
    created:results.reduce((n,r)=>n+r.created,0),updated:results.reduce((n,r)=>n+r.updated,0),unchanged:results.reduce((n,r)=>n+r.unchanged,0),
    skippedUnchanged:results.reduce((n,r)=>n+r.skippedUnchanged,0),failures:results.flatMap(r=>r.failures),results};
}
