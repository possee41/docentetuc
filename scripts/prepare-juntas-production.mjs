// Local packaging only: no Cloudflare/GitHub calls, deployment or SQL execution.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const base='85c4a912c346bb480e5707639e3a82ae48a5b866';
const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
execFileSync('git',['merge-base','--is-ancestor',base,sha]);
if(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim())throw Error('COMMIT_LOCAL_CHANGES_BEFORE_PACKAGING');
const dir='.wrangler/juntas-production-prep';fs.mkdirSync(dir,{recursive:true});
const config=JSON.parse(fs.readFileSync('wrangler.1.2-web-production.jsonc','utf8'));
if(config.name!=='docentetuc'||config.keep_vars!==true||config.d1_databases?.length!==1||config.d1_databases[0].database_id!=='baaf5886-0123-4948-96da-aa7106424549')throw Error('PRODUCTION_CONFIG_CHANGED');
const upload={...config,account_id:'6bbc3dae7e111660f0c835677ceffb69',main:'../../dist/server/worker-entry.mjs',assets:{directory:'../../dist/client'},d1_databases:config.d1_databases.map(({migrations_dir,...binding})=>{void migrations_dir;return binding;})};
// Version upload does not publish route/Cron changes. Traffic-only config omits
// non-versioned settings so versions deploy cannot replace those settings.
delete upload.triggers;delete upload.preview_urls;delete upload.vars;
fs.writeFileSync(dir+'/web-upload.json',JSON.stringify(upload,null,2));
fs.writeFileSync(dir+'/traffic-only.json',JSON.stringify({name:'docentetuc',account_id:upload.account_id},null,2));
for(const file of ['worker-entry.mjs','juntas-shell.mjs','juntas-document.mjs','juntas-public-api.mjs'])if(!fs.existsSync('dist/server/'+file))throw Error('BUILD_REQUIRED');
if(fs.existsSync('dist/server/worker-juntas-readonly-entry.mjs'))throw Error('CANARY_WRAPPER_MUST_NOT_SHIP_TO_PRODUCTION');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const files=['dist/server','dist/client'].flatMap(root=>fs.readdirSync(root,{recursive:true}).map(file=>path.posix.join(root,String(file).replaceAll('\\','/'))).filter(file=>fs.statSync(file).isFile())).sort();
const modified=execFileSync('git',['diff','--name-only',base,sha],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
const sourceHashes=Object.fromEntries(modified.map(file=>[file,crypto.createHash('sha256').update(execFileSync('git',['show',sha+':'+file])).digest('hex')]));
// All production document downloads must survive reconciliation byte for byte.
const preservedDocuments={};
for(const source of execFileSync('git',['ls-tree','-r','--name-only',base,'public/documents'],{encoding:'utf8'}).trim().split('\n').filter(Boolean)){
  const asset=source.replace(/^public\//,'dist/client/');
  const approved=crypto.createHash('sha256').update(execFileSync('git',['show',base+':'+source])).digest('hex');
  if(hash(source)!==approved||hash(asset)!==approved)throw Error('PRODUCTION_DDJJ_ASSET_CHANGED');
  preservedDocuments[asset]=approved;
}
const manifest={codeSha:sha,base,referenceProductionVersion:'6fb7a6a2-1552-4e43-9e2d-9d054e370419',
  referenceDeployment:'19c53725-1c8e-4a71-85e7-0996b8c1dc02',databaseId:config.d1_databases[0].database_id,
  generatedAt:new Date().toISOString(),sourceHashes,preservedDocuments,artifactHashes:Object.fromEntries(files.map(file=>[file,hash(file)])),
  uploadConfigSha256:hash(dir+'/web-upload.json'),trafficConfigSha256:hash(dir+'/traffic-only.json'),remoteOperations:0};
fs.writeFileSync(dir+'/production-package-manifest.json',JSON.stringify(manifest,null,2));
console.log(JSON.stringify({codeSha:sha,sourceFiles:modified.length,artifactFiles:files.length,manifestSha256:hash(dir+'/production-package-manifest.json'),remoteOperations:0}));
