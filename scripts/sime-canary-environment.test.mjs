import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyCanaryEnvironment } from './sime-canary-environment.mjs';

globalThis.fetch=()=>{throw Error('REMOTE_HTTP_FORBIDDEN');};
const sha='a'.repeat(40), repo='possee41/docentetuc', branch='pilot/sime-fair-canary';
const base='https://api.github.com/repos/'+repo, envPath='/environments/canary-sime';
const workflow=readFileSync(new URL('../.github/workflows/sime-import.yml',import.meta.url));
const config={GITHUB_REPOSITORY:repo,GITHUB_REF:'refs/heads/'+branch,GITHUB_EVENT_NAME:'workflow_dispatch',
  GITHUB_RUN_ATTEMPT:'1',GITHUB_RUN_ID:'123',GITHUB_SHA:sha,SIME_CANARY_APPROVED_SHA:sha,
  IMPORT_GATEWAY_TARGET:'canary',SIME_IMPORT_JUNTAS:'1,2,3,4',SIME_IMPORT_LIMIT:'50',SIME_IMPORT_RESUME_AFTER:'',
  SIME_CANARY_OWNER_ID:'42',SIME_CANARY_ENVIRONMENT_ID:'77',GH_TOKEN:'synthetic_readonly_fixture'};
function responses(){return {
  '':{full_name:repo,owner:{type:'User',login:'possee41',id:42}},
  '/actions/runs/123':{id:123,run_attempt:1,event:'workflow_dispatch',head_sha:sha,head_branch:branch,
    repository:{full_name:repo},actor:{id:42},triggering_actor:{id:42},path:'.github/workflows/sime-import.yml'},
  ['/git/ref/heads/'+branch]:{ref:'refs/heads/'+branch,object:{type:'commit',sha}},
  ['/contents/.github/workflows/sime-import.yml?ref='+sha]:{encoding:'base64',content:workflow.toString('base64')},
  [envPath]:{name:'canary-sime',id:77,url:base+envPath,can_admins_bypass:false,
    protection_rules:[{type:'required_reviewers',prevent_self_review:false,reviewers:[{type:'User',reviewer:{id:42,login:'possee41'}}]}],
    deployment_branch_policy:{protected_branches:false,custom_branch_policies:true}},
  [envPath+'/deployment-branch-policies?per_page=100']:{total_count:1,branch_policies:[{id:1,name:branch,type:'branch'}]},
};}
function api(data,responsesOverride={}){const calls=[];return{calls,fetch:async(url,init)=>{
  assert.equal(init.method,'GET');assert.equal(init.body,undefined);assert.equal(init.redirect,'error');
  assert.equal(init.headers.Authorization,'Bearer synthetic_readonly_fixture');
  const path=String(url).slice(base.length);assert.equal(String(url),base+path);assert(Object.hasOwn(data,path),'Unexpected API path');calls.push(path);
  return Response.json(data[path],{status:responsesOverride[path]??200});
}};}

test('Environment existente: solo GET, propietario, reviewer, rama y SHA aprobados',async()=>{
  const a=api(responses()),r=await verifyCanaryEnvironment(config,sha,a.fetch);
  assert.equal(r.ready,true);assert.equal(r.environmentId,77);assert.equal(a.calls.length,6);assert(!JSON.stringify(r).includes(config.GH_TOKEN));
});

for(const [name,status] of Object.entries({missing:404,denied:403,unauthorized:401,server:500}))
  test('Environment '+name+': no resultado ready ni reintento',async()=>{
    const a=api(responses(),{[envPath]:status});await assert.rejects(verifyCanaryEnvironment(config,sha,a.fetch),new RegExp('HTTP_'+status));
    assert.equal(a.calls.filter(x=>x===envPath).length,1);assert.equal(a.calls.length,5);
  });

const mutations={
  owner:d=>d[''].owner.id=99,
  actor:d=>d['/actions/runs/123'].actor.id=99,
  wrongRun:d=>d['/actions/runs/123'].id=124,
  wrongRunSha:d=>d['/actions/runs/123'].head_sha='b'.repeat(40),
  wrongHead:d=>d['/git/ref/heads/'+branch].object.sha='b'.repeat(40),
  recreatedEnvironment:d=>d[envPath].id=78,
  noReviewers:d=>d[envPath].protection_rules=[],
  otherReviewer:d=>d[envPath].protection_rules[0].reviewers[0].reviewer.id=99,
  extraReviewer:d=>d[envPath].protection_rules[0].reviewers.push({type:'User',reviewer:{id:99,login:'other'}}),
  bypass:d=>d[envPath].can_admins_bypass=true,
  bypassUnknown:d=>delete d[envPath].can_admins_bypass,
  selfReviewBlocked:d=>d[envPath].protection_rules[0].prevent_self_review=true,
  unrestrictedBranches:d=>d[envPath].deployment_branch_policy=null,
  wildcardBranch:d=>d[envPath+'/deployment-branch-policies?per_page=100'].branch_policies[0].name='*',
  tagPolicy:d=>d[envPath+'/deployment-branch-policies?per_page=100'].branch_policies[0].type='tag',
  extraBranches:d=>d[envPath+'/deployment-branch-policies?per_page=100'].total_count=2,
  excessiveWorkflowPermissions:d=>d['/contents/.github/workflows/sime-import.yml?ref='+sha].content=Buffer.from(workflow.toString().replace('actions: read','actions: write')).toString('base64'),
};
for(const [name,change] of Object.entries(mutations))test('rechazo de metadatos: '+name,async()=>{
  const d=responses();change(d);await assert.rejects(verifyCanaryEnvironment(config,sha,api(d).fetch));
});

for(const patch of [{GH_TOKEN:''},{SIME_CANARY_OWNER_ID:''},{SIME_CANARY_ENVIRONMENT_ID:''},
  {IMPORT_GATEWAY_TARGET:'production'},{SIME_IMPORT_LIMIT:'51'},{SIME_IMPORT_RESUME_AFTER:'sime:1000'},
  {GITHUB_EVENT_NAME:'schedule'},{GITHUB_RUN_ATTEMPT:'2'},{SIME_CANARY_APPROVED_SHA:'b'.repeat(40)}])
  test('contexto incompleto falla antes del GET: '+Object.keys(patch)[0],async()=>{
    await assert.rejects(verifyCanaryEnvironment({...config,...patch},sha,()=>assert.fail('No HTTP expected')));
  });

test('timeout o respuesta ilegible no tiene fallback',async()=>{
  let calls=0;await assert.rejects(verifyCanaryEnvironment(config,sha,async()=>{calls++;throw Error('TIMEOUT');}));assert.equal(calls,1);
  await assert.rejects(verifyCanaryEnvironment(config,sha,async()=>({status:200,json:async()=>{throw Error('INVALID');}})),/RESPONSE_INVALID/);
});

test('recheck exige la misma identidad y fingerprint de protección',async()=>{
  const r=await verifyCanaryEnvironment(config,sha,api(responses()).fetch);
  const c={...config,SIME_CANARY_PREFLIGHT_CHECKSUM:r.policyChecksum};
  assert.equal((await verifyCanaryEnvironment(c,sha,api(responses()).fetch)).ready,true);
  const changed=responses();changed[envPath].protection_rules.push({type:'wait_timer',wait_timer:1});
  await assert.rejects(verifyCanaryEnvironment(c,sha,api(changed).fetch),/CHANGED_SINCE_PREFLIGHT/);
  await assert.rejects(verifyCanaryEnvironment({...c,SIME_CANARY_PREFLIGHT_CHECKSUM:''},sha,api(responses()).fetch),/CHANGED_SINCE_PREFLIGHT/);
});

test('workflow separa preflight sin Environment y no referencia secretos en ese job',()=>{
  const w=workflow.toString(),before=w.split('\n  import:')[0];
  assert.match(before,/\n  preflight:/);assert.doesNotMatch(before,/^\s*environment:/m);assert.doesNotMatch(before,/secrets\./);
  assert.match(w,/needs: preflight/);assert.match(w,/needs.preflight.result == 'success' && needs.preflight.outputs.ready == 'true'/);
  assert.match(w,/SIME_CANARY_PREFLIGHT_CHECKSUM: \$\{\{ needs.preflight.outputs.policy_checksum \}\}/);
  assert.match(w,/GH_TOKEN: \$\{\{ github.token \}\}/);assert.doesNotMatch(w,/\b(?:contents|actions|deployments|id-token): write\b/);
  assert.doesNotMatch(w,/^\s+[a-z-]+:\s*write\s*$/m);
  assert.doesNotMatch(w,/^\s*schedule:/m);
});
