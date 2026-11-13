import {readFileSync,appendFileSync,existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export function simeDailySummary(result) {
  const data=result.lastRun||result;
  const count=n=>Number.isSafeInteger(n)&&n>=0?n:'—';
  const status=result.failed?'ERROR':data.completed===true?'OK':'PARTIAL';
  const lines=[`### SIME — ${status}`,'','| Junta | Altas | Actualizadas | Sin cambios |','|---|---:|---:|---:|'];
  for(let i=1;i<=4;i++){const r=data.byJunta?.[i]||{};lines.push(`| ${i} | ${count(r.created)} | ${count(r.updated)} | ${count(r.unchanged)} |`);}
  lines.push('',`ACK: ${count(data.processed)}. Pendientes: ${count(data.pending)}.`,
    `Históricos verificados: ${count(result.maintenance?.historicalVerified)}. Diferidos no resueltos: ${count(result.deferred)}.`,
    `Solicitudes oficiales: ${count(result.maintenance?.sourceRequests??result.sourceRequests)} / 24.`,
    `D1 de batches: ${count(data.rowsRead)} lecturas; ${count(data.rowsWritten)} escrituras. No incluye consultas auxiliares.`,
    `Cierre confirmado: ${result.closed===true?'SÍ':'NO VERIFICADO'}. CPU nativa individual: NO MEDIDA.`,
    `Errores de comprobación histórica: ${count(result.maintenance?.deferredErrors?.length)}.`);
  if(result.maintenance?.boards) lines.push(`Juntas comprobadas: ${Object.entries(result.maintenance.boards).filter(([,ok])=>ok).map(([board])=>board).join(', ')||'ninguna'}.`);
  for(const error of result.maintenance?.boardErrors||[])if([1,2,3,4].includes(error.board)&&/^[A-Z0-9_]+$/.test(error.code))lines.push(`Junta ${error.board}: ${error.code}.`);
  if(result.code&&/^[A-Z0-9_]+$/.test(result.code))lines.push(`Error: ${result.code}.`);
  return lines.join('\n')+'\n';
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(!process.env.GITHUB_STEP_SUMMARY)throw Error('SIME_SUMMARY_PATH_REQUIRED');
  const report=existsSync('sime-production-result.json')?simeDailySummary(JSON.parse(readFileSync('sime-production-result.json','utf8'))):'### SIME — NO VERIFICADO\nNo se generó resultado del ejecutor. Revisar el job; no reintentar una escritura ambigua.\n';
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,report);
}
