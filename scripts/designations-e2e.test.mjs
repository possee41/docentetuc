import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {createFdciPersonalHarness} from './fdci-personal-local-harness.mjs';
import {normalizeSimeVacancy,applySimeDetail} from '../lib/sime-publications.ts';
import {officialMetadata,officialLifecycle,withOfficial} from '../lib/official-publication.ts';
import {simeDesignationView,designationCatalog} from '../lib/designation-catalog.ts';
import {publicationForMatch} from '../lib/personalized-catalog.ts';
import {profileMatch,isEligibleMatchResult} from '../lib/matching.ts';
import {boardItems} from '../lib/board-view.ts';
const now=new Date('2026-11-13T17:00:00Z'),boards=['Inicial y Primaria','Secundaria','Técnica, Agrotécnica y No Formal','Superior, Especial y Artística'];
const {build}=createRequire(import.meta.url)('../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild');
const bundle=await build({entryPoints:['app/api/boards/route.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',plugins:[{name:'local-read-only-db',setup(b){
  b.onLoad({filter:/app[\\/]api[\\/]boards[\\/]route\.ts$/},a=>({loader:'ts',resolveDir:resolve('app/api/boards'),contents:readFileSync(a.path,'utf8').replace('const now = new Date();',`const now = new Date('${now.toISOString()}');`)}));
  b.onResolve({filter:/^@\/db$/},()=>({path:'db',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const getD1=()=>globalThis.__designationDB;'}));
  b.onResolve({filter:/^@\//},a=>({path:resolve(a.path.slice(2)+'.ts')}));
}}]});
const route=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
function fixture(id=9001,board=2,date='24/11/2026 10:00') {
  const raw={id,codigo:`LOCAL-${id}`,caracter:'SUPLENTE',fechaPublicacionInicio:'01/11/2026 08:00',fechaPublicacionFin:'11/11/2026 08:00',cargos:'[9000306/00] ESCUELA LOCAL - PROFESOR DE MATEMÁTICA [TURNO MAÑANA]',abierto:false};
  let item=normalizeSimeVacancy(raw,boards[board-1],board,undefined,now);
  applySimeDetail(item,{fechaDesignacion:date,descripcion:'Inscripción online por SIME.\nLUGAR: JUNTA LOCAL'},now.toISOString());
  item=normalizeSimeVacancy(raw,boards[board-1],board,item.metadata,now);
  return {id:item.id,source:item.source,external_id:item.externalId,kind:item.kind,category:item.category,title:item.title,summary:item.summary,level:item.level,area:item.area,junta:item.junta,location:item.location,shift:item.shift,character:item.character,
    starts_at:item.startsAt,ends_at:item.endsAt,status:item.status,official_url:item.officialUrl,metadata:item.metadata,normalized_status:'CLOSED',content_hash:'LOCAL_HASH',first_seen_at:now.toISOString(),updated_at:now.toISOString()};
}
function patch(item,fn){const m=structuredClone(officialMetadata(item));fn(m);return{...item,metadata:withOfficial(item.metadata,m)};}
function seed(h,item){h.raw.prepare('INSERT INTO publications(id,source,external_id,kind,category,title,summary,level,area,junta,location,shift,character,starts_at,ends_at,status,official_url,content_hash,metadata,normalized_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...['id','source','external_id','kind','category','title','summary','level','area','junta','location','shift','character','starts_at','ends_at','status','official_url','content_hash','metadata','normalized_status'].map(k=>item[k]));}

test('cuatro juntas: acto distinto de inscripción cerrada; conserva id, hash, fecha, fuente y fila original',()=>{
  for(let board=1;board<=4;board++){const row=fixture(9000+board,board),before=structuredClone(row),act=simeDesignationView(row,now);
    assert.equal(act.id,row.id);assert.equal(act.content_hash,row.content_hash);assert.equal(act.kind,'vacante');assert.equal(act.ends_at,null);assert.equal(act.registration_close_at,null);
    assert.equal(officialLifecycle(act,now),'UPCOMING');assert.equal(act.starts_at,'2026-11-24T10:00:00-03:00');assert.equal(officialMetadata(act).facts.location.value,'JUNTA LOCAL');assert.equal(act.location,row.location);assert.equal(act.official_url,row.official_url);assert.deepEqual(row,before);
    assert.equal(designationCatalog([row,row],now).length,1);
    assert.equal(boardItems([row],'actos',now).length,1);
    const legacy={...act,id:`acto:${row.id}`,kind:'junta'};
    assert.deepEqual(boardItems([legacy,row],'actos',now).map(x=>x.id),[row.id]);
  }
});
test('sin fecha, evidencia ajena, fixture privado, retirado o fecha textual no crean actos públicos',()=>{
  const row=fixture();for(const invalid of [patch(row,m=>delete m.facts.designation),patch(row,m=>delete m.facts.designation.evidence),patch(row,m=>m.facts.designation.evidence=[]),patch(row,m=>m.facts.designation.value='2026-02-30'),patch(row,m=>m.facts.designation.evidence[0].url='https://example.invalid/falso'),patch(row,m=>m.facts.designation.precision='text'),{...row,removed_at:now.toISOString()}, {...row,metadata:JSON.stringify({...JSON.parse(row.metadata),preview:true})},{...row,metadata:JSON.stringify({...JSON.parse(row.metadata),catalogOnly:true})}])assert.equal(designationCatalog([invalid],now).length,0);
});
test('fecha provisional/conflicto, detalle fallido o viejo: solo consulta histórica; nunca vigente confirmada',()=>{
  const row=fixture();for(const invalid of [patch(row,m=>m.facts.designation.status='provisional'),patch(row,m=>m.facts.designation.status='conflict'),patch(row,m=>m.detailStatus='STALE'),patch(row,m=>m.detailCheckedAt='2026-11-08T00:00:00Z'),patch(row,m=>m.detailCheckedAt='2026-11-14T00:00:00Z')]){
    assert.equal(designationCatalog([invalid],now).length,0);assert.equal(designationCatalog([invalid],now,true).length,1);
    assert.equal(boardItems([invalid],'actos',now).length,0);
  }
  assert.equal(officialLifecycle(simeDesignationView(patch(row,m=>m.detailStatus='STALE'),now),now),'UNKNOWN');
});
test('fechas sin hora y cambio de día Tucumán: no inventa hora; vencido no es adjudicación',()=>{
  const row=fixture(9001,2,'13/11/2026');assert.equal(simeDesignationView(row,now).starts_at,null);
  assert.equal(designationCatalog([row],new Date('2026-11-14T02:59:00Z')).length,1);
  assert.equal(designationCatalog([row],new Date('2026-11-14T03:00:00Z')).length,0);
  assert(!simeDesignationView(row,now).status.includes('OBTENIDO'));
});
test('Para mí reutiliza matching: junta, cargo y turno; Todas no exige perfil',()=>{
  const rows=boards.map((_,i)=>fixture(9000+i,i+1)),all=designationCatalog(rows,now);
  assert.equal(all.length,4);const profile={boards:['Secundaria'],roles:['PROFESOR DE MATEMÁTICA'],shifts:['MAÑANA']};
  const selected=all.filter(x=>isEligibleMatchResult(profileMatch(publicationForMatch(x),profile),85));
  assert.deepEqual(selected.map(x=>x.junta),['Secundaria']);
});
test('matching territorial: conserva localidad y circuito del cargo; no usa el lugar del acto como escuela',()=>{
  const row={...fixture(),location:'San Miguel de Tucumán',circuit:'I',source_circuit_raw:'Circuito I',circuit_inference_source:'explicit'};
  const act=simeDesignationView(row,now),profile={boards:['Secundaria'],roles:['PROFESOR DE MATEMÁTICA'],subjects:['MATEMÁTICA'],locality:'San Miguel de Tucumán',circuits:['I'],shifts:['MAÑANA']};
  assert.equal(isEligibleMatchResult(profileMatch(publicationForMatch(act),profile),85),true);
  assert.equal(isEligibleMatchResult(profileMatch(publicationForMatch(act),{...profile,circuits:['V']}),85),false);
  assert.equal(act.location,row.location);assert.equal(officialMetadata(act).facts.location.value,'JUNTA LOCAL');
});
test('HTTP real + SQLite: supera 400, paginación sin duplicados, filtros y entradas inválidas, cero escrituras',async()=>{
  const h=await createFdciPersonalHarness();h.env.FDCI_PERSONAL_ACTIONS_ENABLED='false';globalThis.__designationDB=h.db;
  try{
    for(let i=0;i<405;i++)seed(h,fixture(9000+i,(i%4)+1));
    seed(h,{...fixture(9998),metadata:'{invalid'});seed(h,{...fixture(9999),metadata:JSON.stringify({...JSON.parse(fixture(9999).metadata),preview:true})});
    let cursor='',seen=new Set(),pages=0;h.sql=[];
    for(;;){const response=await route.GET(new Request('https://local.invalid/api/boards?view=actos&junta=todas&cursor='+encodeURIComponent(cursor)));assert.equal(response.status,200);const page=await response.json();
      assert(page.items.length<=20);for(const row of page.items){assert(!seen.has(row.id));seen.add(row.id);assert.equal(row.kind,'vacante');}pages++;if(!page.nextCursor)break;assert(page.nextCursor>cursor);cursor=page.nextCursor;assert(pages<30);
    }
    assert.equal(seen.size,405);assert(pages>1);assert(h.sql.every(x=>x.operation==='all'&&x.sql.startsWith('SELECT')));
    const res=await route.GET(new Request('https://local.invalid/api/boards?view=actos&junta=secundaria&q=ESCUELA'));const page=await res.json();assert(page.items.every(x=>x.junta==='Secundaria'));assert(page.items.length>0);
    assert.equal((await route.GET(new Request('https://local.invalid/api/boards?view=actos&junta=invalid'))).status,400);
    assert.equal((await route.GET(new Request('https://local.invalid/api/boards?view=actos&q='+('x'.repeat(101))))).status,400);
    const injection=await route.GET(new Request('https://local.invalid/api/boards?view=actos&q='+encodeURIComponent("x%' OR 1=1 --")));assert.equal(injection.status,200);assert.equal((await injection.json()).items.length,0);
    const previousErrors=console.error;console.error=()=>{};h.failOnce='SELECT';
    try{assert.equal((await route.GET(new Request('https://local.invalid/api/boards?view=actos'))).status,503);}finally{console.error=previousErrors;}
  }finally{delete globalThis.__designationDB;h.close();}
});
test('handlers personales reales: OBTENIDO/NO OBTENIDO, repetición, aislamiento y actualización no borran seguimiento',async()=>{
  const h=await createFdciPersonalHarness();h.env.FDCI_PERSONAL_ACTIONS_ENABLED='false';
  try{
    const row=fixture();seed(h,row);const action={action:'save_designation',publicationId:simeDesignationView(row,now).id,status:'OBTENIDO',notes:'Nota privada local'};
    for(const result of await Promise.all([h.post(action),h.post(action),h.post(action)]))assert.equal(result.status,200);
    assert.equal(h.raw.prepare('SELECT count(*) n FROM designation_tracking').get().n,1);
    assert.equal((await h.request('GET')).body.designations[0].status,'OBTENIDO');assert.equal((await h.request('GET',undefined,'b')).body.designations.length,0);
    assert.equal((await h.post({...action,status:'NO OBTENIDO',userId:'test-a'},'b')).status,200);
    assert.equal((await h.request('GET')).body.designations[0].status,'OBTENIDO');assert.equal((await h.request('GET',undefined,'b')).body.designations[0].status,'NO OBTENIDO');
    assert.equal((await h.post(action,null)).status,401);assert.equal((await h.post({...action,publicationId:'arbitrary'})).status,400);
    h.raw.prepare('UPDATE publications SET status=?,metadata=? WHERE id=?').run('cerrada',patch(row,m=>m.facts.designation.value='2026-11-25').metadata,row.id);
    assert.equal((await h.request('GET')).body.designations[0].notes,'Nota privada local');assert.equal(h.count('publications'),1);assert.equal(h.count('notifications'),0);
  }finally{h.close();}
});
