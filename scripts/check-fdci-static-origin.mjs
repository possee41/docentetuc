// Read-only public cross-origin probe. No login, private APIs or Cloudflare credentials.
import {createRequire} from 'node:module';import {homedir} from 'node:os';import {join} from 'node:path';import {writeFileSync,mkdirSync} from 'node:fs';import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);const {chromium}=require(join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const origin='https://canary.docentetuc.com.ar',url='https://possee41.github.io/docentetuc-fdci-catalog-pilot/catalog.json';
mkdirSync('.wrangler',{recursive:true});let browser;const blocked=[];
try{browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking']});const context=await browser.newContext({serviceWorkers:'block'});
await context.route('**/*',route=>{const r=route.request(),u=new URL(r.url());if(r.method()==='GET'&&(r.url()===url||u.origin===origin&&u.pathname==='/'&&r.resourceType()==='document'))return route.continue();blocked.push({method:r.method(),path:u.pathname});return route.abort();});
const page=await context.newPage();const document=await page.goto(origin,{waitUntil:'domcontentloaded',timeout:30000});assert.equal(document.status(),200);
const result=await page.evaluate(async url=>{const r=await fetch(url,{credentials:'omit',redirect:'error'});const text=await r.text(),c=JSON.parse(text),{sha256,...body}=c;
const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),n=>n.toString(16).padStart(2,'0')).join('');
return {origin:location.origin,http:r.status,responseType:r.type,contentType:r.headers.get('content-type'),count:c.items.length,ids:c.items.map(i=>i.id),synthetic:c.items.every(i=>i.title==='DEMO SINTÉTICA — NO OFICIAL'),version:c.version,checksumValid:await hash(JSON.stringify(body))===sha256,sha256,credentials:'omit'};},url);
assert.equal(result.origin,origin);assert.equal(result.http,200);assert.equal(result.responseType,'cors');assert.equal(result.count,2);assert(result.synthetic&&result.checksumValid);
const report={at:new Date().toISOString(),verified:true,browser:'Playwright Chromium using installed Edge, isolated context',...result,canaryDocumentHttp:200,blockedRequests:blocked,canaryApiRequestsAllowed:0};writeFileSync('.wrangler/fdci-static-browser-origin-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(e){const report={at:new Date().toISOString(),verified:false,status:'NO VERIFICADO',reason:String(e.message).split('\n')[0]};writeFileSync('.wrangler/fdci-static-browser-origin-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));process.exitCode=1;}finally{await browser?.close();}
