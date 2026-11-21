// Manual local browser check: node scripts/check-agenda-local.mjs (after npm run build).
// Real Agenda components + existing POST route + ephemeral D1.
// The identity adapter and SELECT reader exist only in this test; no application auth is changed.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dirname,"..");
const require = createRequire(import.meta.url);
const {build} = require("../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild");
const {Miniflare} = require("../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare");
let playwright;
try { playwright = require("playwright"); } catch {
  playwright = require(join(homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
}
const output = join(root,".wrangler/agenda-ui-review"); mkdirSync(output,{recursive:true});
const cssDir = join(root,"dist/client/_next/static/css");
const css = readdirSync(cssDir).filter(f=>f.endsWith(".css")).map(f=>readFileSync(join(cssDir,f),"utf8")).join("\n");
assert.ok(css.includes("agenda-ui-card"),"Run npm run build before this browser check.");
const client = await build({stdin:{resolveDir:root,loader:"tsx",contents:`
import React,{useEffect,useState} from 'react';import{createRoot}from'react-dom/client';
import{Agenda,ManualEventDialog}from'./components/teacher-agenda';import{Toaster}from'./components/ui/sonner';
function App(){const[events,setEvents]=useState([]),[dialog,setDialog]=useState(null),[focus,setFocus]=useState('');
async function load(){const response=await fetch('/api/app');setEvents((await response.json()).manualEvents);}
useEffect(()=>{void load()},[]);
return <main className="mobile-content" style={{maxWidth:920,margin:'auto',padding:'16px',paddingBottom:100}}>
<p style={{fontSize:12,marginBottom:12}}>PRUEBA LOCAL AISLADA · DATOS SINTÉTICOS</p>
<Agenda publications={[]} savedMap={new Map()} manualEvents={events} focusAt={focus} onOpen={()=>{}}
onNewEvent={date=>setDialog({event:null,date})} onEditEvent={event=>setDialog({event,date:''})}/>
{dialog&&<ManualEventDialog event={dialog.event} initialDate={dialog.date} headers={()=>({'content-type':'application/json','x-agenda-test':'allowed'})}
onClose={()=>setDialog(null)} onSaved={async at=>{if(at)setFocus(at);setDialog(null);await load()}}/>}<Toaster/></main>}
createRoot(document.getElementById('root')).render(<App/>);`},bundle:true,write:false,format:"esm",platform:"browser",jsx:"automatic",
  alias:{"@":root},define:{"process.env.NODE_ENV":'"production"'}});
const adapters = {
  "@/db":"export const getD1=()=>globalThis.__agendaD1;",
  "@/lib/current-user":`export async function currentUser(r){if(r.headers.get('x-agenda-test')!=='allowed')throw Error('UNAUTHENTICATED');return{userId:'agenda-local-synthetic'};}export const authError=e=>e.message==='UNAUTHENTICATED';`,
  "@/lib/auth-session":"export const getAuthenticatedAccount=async()=>null;",
};
const worker = await build({stdin:{resolveDir:root,loader:"ts",contents:`import{POST}from'./app/api/app/route.ts';export default{fetch(r,env){globalThis.__agendaD1=env.DB;return POST(r)}}`},
  bundle:true,write:false,format:"esm",platform:"browser",alias:{"@":root},plugins:[{name:"test-only-identity",setup(b){
    b.onResolve({filter:/^@\/(db|lib\/current-user|lib\/auth-session)$/},a=>({path:a.path,namespace:"fixture"}));
    b.onLoad({filter:/.*/,namespace:"fixture"},a=>({contents:adapters[a.path],loader:"js"}));
  }}]});
const mf = new Miniflare({modules:true,script:worker.outputFiles[0].text,d1Databases:["DB"],
  outboundService:()=>{throw Error("REMOTE_REQUEST_FORBIDDEN");}});
let browser, server;
try {
  const db = await mf.getD1Database("DB");
  for(const file of ["drizzle/0000_docentetuc.sql","migrations/0006_manual_events.sql","migrations/0007_manual_event_recurrence.sql"])
    for(const sql of readFileSync(join(root,file),"utf8").replace(/^--.*$/gm,"").split(";").map(s=>s.trim()).filter(Boolean)) await db.prepare(sql).run();
  await db.prepare(`INSERT INTO manual_events(id,user_id,title,notes,category,starts_at,reminder_at,reminder_notified,recurrence,reminder_minutes)
    VALUES('previous','agenda-local-synthetic','Evento previo sintético','No modificar este registro','Escuela','2030-10-31T14:30:45.123Z','2030-10-31T14:00:45.123Z',1,'weekly',30)`).run();
  const before = await db.prepare("SELECT * FROM manual_events WHERE id='previous'").first();
  const denied = await mf.dispatchFetch("http://local/api/app",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"save_event",title:"denied",startsAt:"2030-10-31T12:00:00Z"})});
  assert.equal(denied.status,401);
  let posts = 0;
  server = createServer(async(req,res)=>{try{
    if(req.url==="/api/app"){
      res.setHeader("Content-Type","application/json");
      if(req.method==="GET"){res.end(JSON.stringify({manualEvents:(await db.prepare("SELECT * FROM manual_events WHERE user_id='agenda-local-synthetic' ORDER BY starts_at").all()).results}));return;}
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      posts++;const r=await mf.dispatchFetch("http://local/api/app",{method:"POST",headers:{"content-type":"application/json","x-agenda-test":req.headers["x-agenda-test"]||""},body:Buffer.concat(chunks)});
      res.statusCode=r.status;res.end(await r.text());return;
    }
    if(req.url==="/app.js"){res.setHeader("Content-Type","application/javascript");res.end(client.outputFiles[0].text);return;}
    if(req.url==="/style.css"){res.setHeader("Content-Type","text/css");res.end(css);return;}
    res.setHeader("Content-Type","text/html");res.end('<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
  }catch{res.statusCode=500;res.end('{"error":"LOCAL_FIXTURE_FAILED"}');}});
  await new Promise(r=>server.listen(0,"127.0.0.1",r));const url=`http://127.0.0.1:${server.address().port}`;
  browser=await playwright.chromium.launch({channel:"msedge",headless:true,args:["--disable-background-networking"]});
  const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:"America/Argentina/Buenos_Aires"});
  await context.route("**/*",route=>new URL(route.request().url()).origin===url?route.continue():route.abort());
  const page=await context.newPage();const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto(url);await page.getByRole("heading",{name:"Agenda docente",exact:true}).waitFor();
  await page.getByRole("button",{name:"Evento",exact:true}).click();
  await page.getByLabel("Descripción / notas").fill("Conservar descripción ante errores");
  await page.getByRole("button",{name:"Guardar evento",exact:true}).click();
  await page.getByRole("alert").filter({hasText:"Escribí un título"}).waitFor();
  assert.equal(await page.getByLabel("Descripción / notas").inputValue(),"Conservar descripción ante errores");
  await page.getByLabel("Título",{exact:true}).fill("PRUEBA LOCAL — Reunión de docentes");
  await page.getByLabel("Fecha y hora · Argentina").fill("2030-10-31T09:15");
  await page.getByRole("combobox",{name:"Recordarme",exact:true}).click();await page.getByRole("option",{name:"30 minutos antes",exact:true}).click();
  let failOnce=true;const ids=[];
  await page.route("**/api/app",async route=>{
    if(route.request().method()!=="POST"){await route.continue();return;}
    ids.push(route.request().postDataJSON().id);
    if(failOnce){failOnce=false;await route.fulfill({status:500,contentType:"application/json",body:'{"error":"Error de guardado sintético; conservá el formulario."}'});}
    else{await new Promise(r=>setTimeout(r,150));await route.continue();}
  });
  await page.getByRole("button",{name:"Guardar evento",exact:true}).click();await page.getByRole("alert").filter({hasText:"Error de guardado sintético"}).waitFor();
  assert.equal(await page.getByLabel("Título",{exact:true}).inputValue(),"PRUEBA LOCAL — Reunión de docentes");
  await page.locator("form").evaluate(f=>{f.requestSubmit();f.requestSubmit();});
  await page.getByRole("button",{name:"Ver evento: PRUEBA LOCAL — Reunión de docentes",exact:true}).waitFor();
  assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);assert.equal(posts,1);
  const records=(await db.prepare("SELECT * FROM manual_events ORDER BY id").all()).results;assert.equal(records.length,2);
  const created=records.find(e=>e.id!=="previous");assert.equal(created.starts_at,"2030-10-31T12:15:00.000Z");assert.equal(created.reminder_at,"2030-10-31T11:45:00.000Z");
  assert.equal(await page.locator(".agenda-ui-count").filter({hasText:/^2$/}).count(),1);
  for(const tab of ["Semana","Agenda","Mes"]){await page.getByRole("button",{name:tab,exact:true}).click();assert.equal(await page.getByRole("button",{name:"Ver evento: PRUEBA LOCAL — Reunión de docentes",exact:true}).count(),1);}
  await page.getByRole("button",{name:"Mes siguiente",exact:true}).click();assert.equal(await page.getByRole("button",{name:"Ver evento: PRUEBA LOCAL — Reunión de docentes",exact:true}).count(),1);
  await page.getByRole("button",{name:"Mes anterior",exact:true}).click();
  const screenshot=async(name)=>{
    // The application has 180ms color transitions; capture the settled theme.
    await page.waitForTimeout(250);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Horizontal overflow: ${name}`);
    await page.screenshot({path:join(output,`${name}.png`),fullPage:await page.getByRole("dialog").count()===0,animations:"disabled"});
  };
  await screenshot("month-mobile-light");
  await page.getByRole("button",{name:"Ver evento: PRUEBA LOCAL — Reunión de docentes",exact:true}).click();await page.getByRole("heading",{name:"Detalle del evento",exact:true}).waitFor();
  assert.ok(await page.getByRole("dialog").innerText().then(t=>t.includes("09:15")&&t.includes("Recordatorio configurado")));
  await page.getByRole("button",{name:"Editar evento",exact:true}).click();await page.getByLabel("Título",{exact:true}).fill("No guardar este cambio");await page.getByRole("button",{name:"Cancelar",exact:true}).click();
  assert.equal((await db.prepare("SELECT title FROM manual_events WHERE id=?").bind(created.id).first()).title,created.title);
  await page.getByRole("button",{name:"Ver evento: PRUEBA LOCAL — Reunión de docentes",exact:true}).click();await page.getByRole("button",{name:"Editar evento",exact:true}).click();
  assert.equal(await page.getByRole("combobox",{name:"Recordarme",exact:true}).innerText(),"30 minutos antes");
  await page.getByLabel("Título",{exact:true}).fill("PRUEBA LOCAL — Reunión actualizada");await page.getByLabel("Fecha y hora · Argentina").fill("2030-10-31T09:45");
  await page.evaluate(()=>{document.documentElement.classList.add("dark");document.documentElement.dataset.theme="dark";});await screenshot("form-mobile-dark");
  await page.getByRole("button",{name:"Guardar evento",exact:true}).click();await page.getByRole("button",{name:"Ver evento: PRUEBA LOCAL — Reunión actualizada",exact:true}).waitFor();
  const updated=await db.prepare("SELECT * FROM manual_events WHERE id=?").bind(created.id).first();assert.equal(updated.starts_at,"2030-10-31T12:45:00.000Z");assert.equal(updated.reminder_at,"2030-10-31T12:15:00.000Z");
  await screenshot("month-mobile-dark");await page.setViewportSize({width:1440,height:1000});await screenshot("month-desktop-dark");
  await page.evaluate(()=>{document.documentElement.classList.remove("dark");document.documentElement.dataset.theme="light";});await screenshot("month-desktop-light");
  await page.reload();await page.getByRole("button",{name:"Agenda",exact:true}).click();await page.getByRole("button",{name:"Ver evento: PRUEBA LOCAL — Reunión actualizada",exact:true}).waitFor();
  assert.equal(await page.locator(".agenda-ui-card").count(),2);
  assert.deepEqual(await db.prepare("SELECT * FROM manual_events WHERE id='previous'").first(),before);
  assert.equal((await db.prepare("SELECT count(*) n FROM notifications").first()).n,0);
  assert.equal((await db.prepare("SELECT count(*) n FROM manual_event_push_queue").first()).n,0);
  assert.deepEqual(errors,[]);
  const result={ok:true,viewport:["390x844","1440x1000"],mode:["Mes","Semana","Agenda"],themes:["light","dark"],persistenceAfterReload:true,created:1,updated:1,existingRecordPreserved:true,doubleSubmitPrevented:true,notificationWrites:0,pushQueueWrites:0,postRequests:posts,productionAccess:false};
  writeFileSync(join(output,"result.json"),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));await mf.dispose();}
