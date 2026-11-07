import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createFdciPersonalHarness } from './fdci-personal-local-harness.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const dir=resolve('.wrangler/fdci-personal-evidence'); mkdirSync(dir,{recursive:true});
const h=await createFdciPersonalHarness();
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking']});
const context=await browser.newContext({viewport:{width:1365,height:900},serviceWorkers:'block'});
const page=await context.newPage(), errors=[], calls=[];
page.on('pageerror', e=>errors.push(e.message));
await context.route('**/*',async route=>{
 const r=route.request(),u=new URL(r.url());
 if(u.hostname==='raw.githubusercontent.com'||u.hostname==='possee41.github.io') {const res=await h.fetch(r.url()); return route.fulfill({status:res.status,contentType:'application/json',body:await res.text()});}
 if(u.hostname!=='127.0.0.1'&&u.hostname!=='localhost') return route.abort();
 if(u.pathname==='/api/app') {const result=await h.request(r.method(),r.postDataJSON()??undefined,'a',u.origin);calls.push({method:r.method(),status:result.status,action:r.method()==='POST'?r.postDataJSON()?.action:null});return route.fulfill({status:result.status,contentType:'application/json',body:JSON.stringify(result.body)});}
 if(u.pathname==='/api/public-app')return route.fulfill({json:{publications:[],sync:[],sourceHealth:[],stats:{},communityPosts:[]}});
 if(u.pathname==='/api/installations/credential')return route.fulfill({json:{status:'ready',deviceId:'11111111-1111-4111-8111-111111111111'}});
 if(u.pathname==='/api/auth/status')return route.fulfill({json:{configured:true,authenticated:true,isAdmin:false}});
 if(u.pathname.startsWith('/api/'))return route.fulfill({json:{items:[],notifications:[],unreadCount:0}});
 return route.continue();
});
try{
 await page.goto('http://localhost:5187/?section=capacitaciones&fdciCatalogTest=1');
 await page.getByRole('button',{name:'Guardar',exact:true}).first().waitFor({timeout:60000});
 await page.getByRole('button',{name:'Guardar',exact:true}).first().click();
 await page.waitForFunction(()=>document.body.innerText.includes('Guardada'));
 assert.equal(h.count('saved_publications'),1);
 await page.reload();await page.getByRole('button',{name:'Guardada',exact:true}).first().waitFor();
 await page.getByRole('button',{name:'Guardada',exact:true}).first().scrollIntoViewIfNeeded();
 await page.screenshot({path:join(dir,'desktop-guardada.png'),fullPage:true});
 await page.getByRole('button',{name:'Ver',exact:true}).first().click();
 await page.getByRole('button',{name:'Agregar a mi agenda',exact:true}).click();
 await page.getByRole('button',{name:'Quitar de mi agenda',exact:true}).waitFor();
 assert.equal(h.raw.prepare('SELECT in_agenda FROM saved_publications').get().in_agenda,1);
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Recordarme',exact:true}).first().click();
 await page.getByRole('button',{name:/Activar.*aviso/}).click();
 await page.getByRole('button',{name:'Aviso activo',exact:true}).first().waitFor();
 assert(h.count('training_reminders')>0);
 await page.getByRole('button',{name:'Aviso activo',exact:true}).first().click();
 await page.getByRole('button',{name:'Cancelar aviso',exact:true}).click();
 await page.getByRole('button',{name:'Recordarme',exact:true}).first().waitFor();
 assert.equal(h.count('training_reminders'),0);
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>{document.documentElement.dataset.theme='dark';});
 await page.getByRole('button',{name:'Recordarme',exact:true}).first().scrollIntoViewIfNeeded();
 await page.screenshot({path:join(dir,'mobile-dark.png'),fullPage:true});
 await page.getByRole('button',{name:'Ver',exact:true}).first().click();
 await page.getByRole('button',{name:'Quitar de mi agenda',exact:true}).click();
 await page.getByRole('button',{name:'Agregar a mi agenda',exact:true}).waitFor();await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Guardada',exact:true}).first().click();
 await page.getByRole('button',{name:'Guardar',exact:true}).first().waitFor();
 assert.equal(h.count('saved_publications'),0);assert.equal(h.count('training_reminders'),0);
 h.env.FDCI_PERSONAL_ACTIONS_ENABLED='false';await page.reload();
 await page.getByText(/CATÁLOGO EXTERNO — solo consulta/i).first().waitFor({timeout:10000});
 assert.equal(await page.getByRole('button',{name:'Guardar',exact:true}).count(),0);
 assert.deepEqual(errors,[]); assert(calls.every(c=>c.status===200));
 const receipt={result:'PASS',calls,rows:{publications:h.count('publications'),saved:h.count('saved_publications'),reminders:h.count('training_reminders')},catalogFetches:h.requests.length,errors};
 writeFileSync(join(dir,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
}catch(e){console.log((await page.locator('body').innerText()).slice(-8000));await page.screenshot({path:join(dir,'failure.png'),fullPage:true});throw e;}
finally{await browser.close();h.close();}
