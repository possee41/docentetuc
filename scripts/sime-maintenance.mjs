// Node only: bounded verification of pending records absent from the current listing.
import { fetchSourceJson } from '../lib/source-fetch.ts';
import { normalizeSimeVacancy, applySimeDetail, validSimeDetail } from '../lib/sime-publications.ts';
import { parseOfficialDate, readMetadata, officialMetadata, withOfficial } from '../lib/official-publication.ts';

export const SIME_BOARD_NAMES = ['Inicial y Primaria','Secundaria','Técnica, Agrotécnica y No Formal','Superior, Especial y Artística'];
export const emptyBoardCursors = () => Object.fromEntries(SIME_BOARD_NAMES.map((_,i)=>[i+1,'']));
export function rotateSimeRows(rows, after = '') {
  const sorted = [...rows].sort((a,b)=>Number(a.id.slice(5))-Number(b.id.slice(5)));
  const floor = after ? Number(after.slice(5)) : -1;
  return [...sorted.filter(r=>Number(r.id.slice(5))>floor),...sorted.filter(r=>Number(r.id.slice(5))<=floor)];
}

export async function resolveSimeDeferred(queue, currentIds, cursors, fetcher, now, boards, previous = new Map()) {
  const items=[],errors=[],next={...emptyBoardCursors(),...cursors};
  for (let board=1;board<=4;board++) {
    if (boards && boards[board] !== true) continue;
    const row=rotateSimeRows(Object.values(queue).filter(r=>r.junta===SIME_BOARD_NAMES[board-1]&&!currentIds.has(r.id)),next[board])[0];
    if (!row) continue;
    if (!/^sime:\d{1,15}$/.test(row.id)||row.externalId!==row.id.slice(5)) throw Error('SIME_DEFERRED_IDENTITY_INVALID');
    next[board]=row.id; // A failed historical read must not starve its siblings tomorrow.
    const pendingMetadata=readMetadata(row.metadata),currentMetadata=readMetadata(previous.get(row.id)?.metadata);
    const metadata={...pendingMetadata,...currentMetadata};
    const cached=currentMetadata.simeVacancy;
    if(cached && (cached.id!==Number(row.externalId)||cached.codigo!==pendingMetadata.simeVacancy?.codigo))throw Error('SIME_DEFERRED_IDENTITY_MISMATCH');
    const raw=cached||pendingMetadata.simeVacancy;
    if (!raw||raw.id!==Number(row.externalId)||typeof raw.codigo!=='string'||typeof raw.cargos!=='string'||typeof raw.caracter!=='string'||typeof raw.abierto!=='boolean')
      throw Error('SIME_DEFERRED_CACHE_INVALID');
    let response;
    try { response=await fetchSourceJson(`https://sime.educaciontuc.gov.ar/Vacantes/ObtenerVacante/${row.externalId}?origen=&postulante=`,{source:'SIME',fetcher,signal:AbortSignal.timeout(15000),headers:{Accept:'application/json'}}); }
    catch { errors.push({id:row.id,board,code:'SIME_DEFERRED_READ_FAILED'});continue; }
    const v=response?.vacante;
    if (!v || typeof v.id!=='number' || typeof v.codigo!=='string') { errors.push({id:row.id,board,code:'SIME_DEFERRED_NOT_VERIFIABLE'});continue; }
    if (v?.id!==raw.id||v?.codigo!==raw.codigo) throw Error('SIME_DEFERRED_IDENTITY_MISMATCH');
    const open=typeof v.fechaPublicacionInicio==='string'?parseOfficialDate(v.fechaPublicacionInicio):null;
    const close=typeof v.fechaPublicacionFin==='string'?parseOfficialDate(v.fechaPublicacionFin):null;
    if (!validSimeDetail(response)||open?.precision!=='datetime'||close?.precision!=='datetime'||
        Date.parse(open.value)>Date.parse(close.value)||Date.parse(close.value)>now.getTime()) {
      errors.push({id:row.id,board,code:'SIME_DEFERRED_NOT_CONFIRMED_CLOSED'});continue;
    }
    // Title/scope come from the preserved official snapshot; dates/detail are freshly verified.
    // Never infer a new opening from an absent list record or persist personal "designado" fields.
    const refreshed={...raw,fechaPublicacionInicio:v.fechaPublicacionInicio,fechaPublicacionFin:v.fechaPublicacionFin};
    let item=normalizeSimeVacancy(refreshed,row.junta,board,JSON.stringify(metadata),now);
    applySimeDetail(item,v,now.toISOString());
    item=normalizeSimeVacancy(refreshed,row.junta,board,item.metadata,now);
    const m=officialMetadata(item);
    m.issues.push('Publicación histórica: no figura en el listado vigente; fechas y detalle verificados por ID y código.');
    item.metadata=withOfficial(item.metadata,m);
    items.push(item);
  }
  return {items,errors,cursors:next};
}
