// Offline packaging of the inspected active receiver and default-branch workflow.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
export function patchSimeReceiver(bundle) {
  const hash=createHash('sha256').update(bundle).digest('hex');
  if(hash!=='b94a784bcfa78dacc4b32dc071dda66c5fd8cdc8badd17320f279c03b6ecdafc') throw Error('SIME_ACTIVE_BUNDLE_CHANGED');
  const first=bundle.indexOf('var fields = {'),last=bundle.indexOf('};',first)+2,part=bundle.slice(first,last);
  if(first<0||!part.includes('externalId: 40')||(part.match(/metadata: 16e3/g)||[]).length!==1)throw Error('SIME_BUNDLE_LAYOUT_CHANGED');
  let result=bundle.slice(0,first)+part.replace('metadata: 16e3','metadata: 32e3')+bundle.slice(last);
  const start=result.indexOf('var dailyGateway = { async fetch(request, env) {');
  if(start<0)throw Error('SIME_GATEWAY_LAYOUT_CHANGED');
  const prefix=result.slice(0,start),tail=result.slice(start);
  const marker='  if (url.pathname === "/api/internal/import-gate") {';
  const guard='  if (env.SIME_IMPORT_ENABLED !== "true" && (url.pathname === "/api/internal/sime-import" || url.pathname === "/api/internal/import-identity" && url.searchParams.get("source") === "sime")) return Response.json({error:"SIME_DISABLED"},{status:503});\n';
  const parsed='      const body2 = JSON.parse(text2 + decoder2.decode());';
  const closeGuard='\n      if (body2.source === "sime" && body2.action !== "close" && env.SIME_IMPORT_ENABLED !== "true") return Response.json({error:"SIME_DISABLED"},{status:503});';
  if(tail.split(marker).length!==2||tail.split(parsed).length!==2)throw Error('SIME_GATEWAY_LAYOUT_CHANGED');
  result=prefix+tail.replace(marker,guard+marker).replace(parsed,parsed+closeGuard);
  if(result.replace(guard,'').replace(closeGuard,'').replace('metadata: 32e3','metadata: 16e3')!==bundle)throw Error('SIME_PATCH_NOT_ISOLATED');
  return result;
}
export function patchSimeWorkflow(workflow, approvedSha) {
  if(!/^[a-f0-9]{40}$/.test(approvedSha||'')||approvedSha==='e7fc12fe3454f865b53c0c45f36b5568653dc02c')throw Error('SIME_NEW_RUNTIME_SHA_REQUIRED');
  const sime="(inputs.source == 'sime' || github.event.schedule == '7 9 * * *')";
  const pin=`${sime} && '${approvedSha}' || 'e7fc12fe3454f865b53c0c45f36b5568653dc02c'`;
  const replace=(a,b)=>{if(workflow.split(a).length!==2)throw Error('SIME_WORKFLOW_BASELINE_CHANGED');workflow=workflow.replace(a,b);};
  replace('permissions:\n  contents: read\n',"      confirm_sime_recovery:\n        type: boolean\n        default: false\n        description: 'Confirmar una sola recuperación productiva SIME'\npermissions:\n  contents: read\n");
  replace("(((github.event_name == 'schedule' && github.event.schedule == '7 9 * * *') || (github.event_name == 'workflow_dispatch' && inputs.source == 'sime')) && vars.DAILY_PRODUCTION_SIME_ENABLED == 'true')",
    "((github.event_name == 'schedule' && github.event.schedule == '7 9 * * *' && vars.DAILY_PRODUCTION_SIME_ENABLED == 'true') || (github.event_name == 'workflow_dispatch' && inputs.source == 'sime' && inputs.confirm_sime_recovery && github.actor_id == '296786704' && vars.SIME_PRODUCTION_RECOVERY_ENABLED == 'true'))");
  replace('DAILY_APPROVED_SHA: ${{ vars.DAILY_PRODUCTION_APPROVED_SHA }}',`DAILY_APPROVED_SHA: \u0024{{ ${pin} }}`);
  replace('IMPORT_GATEWAY_APPROVED_SHA: ${{ vars.DAILY_PRODUCTION_APPROVED_SHA }}',`IMPORT_GATEWAY_APPROVED_SHA: \u0024{{ ${pin} }}`);
  replace('ref: e7fc12fe3454f865b53c0c45f36b5568653dc02c',`ref: \u0024{{ ${pin} }}`);
  replace('      DAILY_SOURCES_ENABLED:',"      SIME_PRODUCTION_APPROVED_SHA: ${{ vars.DAILY_PRODUCTION_SIME_APPROVED_SHA }}\n      SIME_PRODUCTION_DAILY_ENABLED: ${{ vars.DAILY_PRODUCTION_SIME_ENABLED }}\n      SIME_PRODUCTION_RECOVERY_ENABLED: ${{ vars.SIME_PRODUCTION_RECOVERY_ENABLED }}\n      SIME_PRODUCTION_RECOVERY_CONFIRM: ${{ inputs.confirm_sime_recovery && 'true' || 'false' }}\n      DAILY_SOURCES_ENABLED:");
  replace("if (process.env.DAILY_APPROVED_SHA !== 'e7fc12fe3454f865b53c0c45f36b5568653dc02c')", `if (source === 'sime' ? process.env.DAILY_APPROVED_SHA !== '${approvedSha}' || process.env.SIME_PRODUCTION_APPROVED_SHA !== '${approvedSha}' : process.env.DAILY_APPROVED_SHA !== 'e7fc12fe3454f865b53c0c45f36b5568653dc02c')`);
  workflow+="\n      - uses: actions/upload-artifact@v4\n        if: always() && env.SYNC_SOURCE == 'sime'\n        with:\n          name: sime-production-result-${{ github.run_id }}\n          path: sime-production-result.json\n          if-no-files-found: ignore\n          retention-days: 30\n";
  return workflow;
}
export function patchSimeMaintenanceWorkflow(workflow, approvedSha) {
  const old='301bd106a94ae7354f37bab66ee6dcf9f30c3ce8';
  if(!/^[a-f0-9]{40}$/.test(approvedSha||'')||[old,'e7fc12fe3454f865b53c0c45f36b5568653dc02c'].includes(approvedSha)||workflow.split(old).length!==6||
      !workflow.includes('group: daily-production-source-writes')||!workflow.includes("github.actor_id == '296786704'"))throw Error('SIME_MAINTENANCE_WORKFLOW_BASELINE');
  const next=workflow.replaceAll(old,approvedSha);
  return next+"\n      - name: Report SIME progress without exposing source payloads\n        if: always() && env.SYNC_SOURCE == 'sime'\n        run: node scripts/sime-daily-summary.mjs\n";
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv[2]==='maintenance'){
    const [,workflowPath,approvedSha,output]=process.argv.slice(2);if(!output)throw Error('SIME_LOCAL_OUTPUT_REQUIRED');
    writeFileSync(output,patchSimeMaintenanceWorkflow(readFileSync(workflowPath,'utf8'),approvedSha),{flag:'wx'});
    console.log(JSON.stringify({localOnly:true,workflow:output,codeSha:approvedSha}));
  }else{
  const [bundlePath,workflowPath,out,approvedSha]=process.argv.slice(2);if(!out)throw Error('SIME_LOCAL_OUTPUT_REQUIRED');
  const bundle=patchSimeReceiver(readFileSync(bundlePath,'utf8')),workflow=patchSimeWorkflow(readFileSync(workflowPath,'utf8'),approvedSha);mkdirSync(out,{recursive:true});
  writeFileSync(out+'/daily-source-gateway.js',bundle,{flag:'wx'});
  writeFileSync(out+'/daily-production-sources.yml',workflow,{flag:'wx'});
  console.log(JSON.stringify({localOnly:true,files:['daily-source-gateway.js','daily-production-sources.yml']}));
  }
}
