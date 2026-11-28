// Offline only. Produces a reviewed CAS proposal; never writes GitHub or D1.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { validateDailyState, sealDailyState, SIME_JUNTAS } from './daily-sync-state.mjs';

// Offline identity upgrade of a clean ledger. It never clears suspension or a consumed recovery run.
export function upgradeSimeRuntime(state, oldSha, newSha) {
  validateDailyState(state,'sime',oldSha);
  const d=state.data;
  if(!/^[a-f0-9]{40}$/.test(newSha)||newSha===oldSha||d.environment!=='production'||d.owner!==null||d.expiresAt!==null||d.inFlight!==null||d.halted)
    throw Error('SIME_RUNTIME_UPGRADE_REVIEW_REQUIRED');
  return sealDailyState({...structuredClone(d),codeSha:newSha,generation:d.generation+1,
    runtimeReview:{previousCodeSha:oldSha,previousChecksum:state.sha256}});
}

export function prepareSimeRecovery(state, oldSha, newSha, receipt, now = new Date()) {
  validateDailyState(state, 'sime', oldSha);
  const d = structuredClone(state.data), checkedAt = Date.parse(receipt?.at);
  if (!/^[a-f0-9]{40}$/.test(newSha) || newSha === oldSha || d.environment !== 'production' ||
      d.owner !== null || d.expiresAt !== null || d.pending !== Object.keys(d.queue).length ||
      receipt?.databaseId !== 'baaf5886-0123-4948-96da-aa7106424549' ||
      !Number.isFinite(checkedAt) || checkedAt > now.getTime() || now.getTime()-checkedAt > 1_800_000 ||
      !Array.isArray(receipt.result) || receipt.result.length !== 1 || !receipt.result[0].success ||
      receipt.result[0].meta?.rows_written !== 0 || receipt.result[0].meta?.changes !== 0)
    throw Error('SIME_RECOVERY_EVIDENCE_INVALID');
  if (!d.halted || d.inFlight?.mode !== 'batch' || !d.queue[d.inFlight.id]) throw Error('SIME_RECOVERY_REVIEW_REQUIRED');
  const row = d.queue[d.inFlight.id], rows = receipt.result[0].results;
  if (rows.length !== 1 || rows[0].id !== row.id || rows[0].source !== 'SIME' || rows[0].content_hash !== row.contentHash ||
      rows[0].removed_at !== null || !SIME_JUNTAS.includes(row.junta)) throw Error('SIME_RECOVERY_NOT_CONFIRMED');
  const simeCursors = d.simeCursors || Object.fromEntries(SIME_JUNTAS.map((_,i)=>[i+1,'']));
  simeCursors[SIME_JUNTAS.indexOf(row.junta)+1] = row.id;
  d.confirmed[row.id] = row.contentHash; delete d.queue[row.id];
  return sealDailyState({ ...d, codeSha:newSha, generation:d.generation+1, pending:Object.keys(d.queue).length,
    cursor:row.id, simeCursors, inFlight:null, halted:false,
    recoveryReview:{previousChecksum:state.sha256,previousCodeSha:oldSha,resolvedId:row.id,evidenceAt:receipt.at} });
}

export function prepareSimeAbsentRecovery(state, oldSha, newSha, receipt, now = new Date()) {
  validateDailyState(state, 'sime', oldSha);
  const d = structuredClone(state.data), checkedAt = Date.parse(receipt?.at);
  if (!/^[a-f0-9]{40}$/.test(newSha) || newSha === oldSha || d.environment !== 'production' ||
      d.owner !== null || d.expiresAt !== null || d.pending !== Object.keys(d.queue).length ||
      receipt?.databaseId !== 'baaf5886-0123-4948-96da-aa7106424549' ||
      !Number.isFinite(checkedAt) || checkedAt > now.getTime() || now.getTime() - checkedAt > 1_800_000 ||
      !Array.isArray(receipt.result) || receipt.result.length !== 3 ||
      receipt.result.some(r => !r?.success || r.meta?.rows_written !== 0 || r.meta?.changes !== 0 || !Array.isArray(r.results)))
    throw Error('SIME_RECOVERY_EVIDENCE_INVALID');
  if (!d.halted || d.inFlight?.mode !== 'batch' || typeof d.inFlight?.id !== 'string' || !d.queue[d.inFlight.id])
    throw Error('SIME_RECOVERY_REVIEW_REQUIRED');
  const row = d.queue[d.inFlight.id];
  if (!SIME_JUNTAS.includes(row.junta) || d.confirmed[row.id] === row.contentHash)
    throw Error('SIME_RECOVERY_REVIEW_REQUIRED');
  if (receipt.targetId !== row.id || receipt.expectedContentHash !== row.contentHash)
    throw Error('SIME_RECOVERY_HASH_MISMATCH');
  const [identityRows, leaseRows, pubRows] = receipt.result.map(r => r.results);
  if (identityRows.length !== 1 || identityRows[0].id !== 1 ||
      identityRows[0].database_name !== 'docentetuc-db' ||
      identityRows[0].database_id !== 'baaf5886-0123-4948-96da-aa7106424549')
    throw Error('SIME_RECOVERY_EVIDENCE_INVALID');
  if (leaseRows.length !== 0) throw Error('SIME_RECOVERY_ACTIVE_LEASE');
  if (pubRows.length !== 0) throw Error('SIME_RECOVERY_UNEXPECTEDLY_PRESENT');
  return sealDailyState({
    ...d,
    codeSha: newSha,
    generation: d.generation + 1,
    inFlight: null,
    halted: false,
    recoveryReview: {
      previousChecksum: state.sha256,
      previousCodeSha: oldSha,
      resolvedId: row.id,
      outcome: 'absent',
      expectedContentHash: row.contentHash,
      evidenceAt: receipt.at,
    },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args=process.argv.slice(2);
  const mode=args[0]==='upgrade'||args[0]==='absent'?args[0]:'confirmed';
  const [statePath,receiptPath,oldSha,newSha,output]=mode==='upgrade'?[args[1],null,args[2],args[3],args[4]]:mode==='absent'?args.slice(1):args;
  if (!output) throw Error('SIME_RECOVERY_LOCAL_OUTPUT_REQUIRED');
  const state = JSON.parse(readFileSync(statePath,'utf8'));
  const result = mode==='upgrade' ? upgradeSimeRuntime(state,oldSha,newSha)
    : mode==='absent' ? prepareSimeAbsentRecovery(state,oldSha,newSha,JSON.parse(readFileSync(receiptPath,'utf8')))
    : prepareSimeRecovery(state,oldSha,newSha,JSON.parse(readFileSync(receiptPath,'utf8')));
  writeFileSync(output,JSON.stringify(result)+'\n',{flag:'wx'});
  console.log(JSON.stringify({localOnly:true,generation:result.data.generation,confirmed:Object.keys(result.data.confirmed).length,
    pending:result.data.pending,...(mode==='upgrade'?{runtimeUpgradeOnly:true}:{resolvedId:result.data.recoveryReview.resolvedId,outcome:result.data.recoveryReview.outcome||'confirmed'}),checksum:result.sha256}));
}
