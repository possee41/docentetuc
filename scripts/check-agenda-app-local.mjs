// Full application on localhost, intercepted synthetic APIs, real existing POST + ephemeral D1.
// Start npm run dev first. No application auth/schema/GET materialization is changed or invoked.
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { resolve, join } from "node:path";

const root=resolve(import.meta.dirname,".."),require=createRequire(import.meta.url);
const {build}=require("../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild");
const {Miniflare}=require("../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare");
let playwright;try{playwright=require("playwright");}catch{playwright=require(join(homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));}
const origin="http://localhost:5173",output=join(root,".wrangler/agenda-app-review");mkdirSync(output,{recursive:true});
const bundle=await build({stdin:{resolveDir:root,loader:"ts",contents:`import{POST}from'./app/api/app/route.ts';export default{fetch(r,env){globalThis.__agendaD1=env.DB;return POST(r)}}`},
  bundle:true,write:false,format:"esm",platform:"browser",alias:{"@":root},plugins:[{name:"synthetic-test-only-identity",setup(b){
    b.onResolve({filter:/^@\/(db|lib\/current-user|lib\/auth-session)$/},a=>({path:a.path,namespace:"fixture"}));
    b.onLoad({filter:/.*/,namespace:"fixture"},a=>({loader:"js",contents:{
      "@/db":"export const getD1=()=>globalThis.__agendaD1;",
      "@/lib/current-user":"export const currentUser=async()=>({userId:'agenda-local-synthetic'});export const authError=e=>e.message==='UNAUTHENTICATED';",
      "@/lib/auth-session":"export const getAuthenticatedAccount=async()=>null;",
    }[a.path]}));
  }}]});
const mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,d1Databases:["DB"],outboundService:()=>{throw Error("REMOTE_REQUEST_FORBIDDEN");}});
let browser;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const until=async test=>{const end=Date.now()+30000;while(!test()){if(Date.now()>end)throw Error("LOCAL_CHECK_TIMEOUT");await sleep(50);}};
const empty={profile:null,publications:[],saved:[],notifications:[],reminders:[],designations:[],manualEvents:[],sync:[]};
try{
  const db=await mf.getD1Database("DB");
  for(const f of ["drizzle/0000_docentetuc.sql","migrations/0006_manual_events.sql","migrations/0007_manual_event_recurrence.sql"])
    for(const sql of readFileSync(join(root,f),"utf8").replace(/^--.*$/gm,"").split(";").map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
  await db.prepare(`INSERT INTO manual_events(id,user_id,title,notes,category,starts_at,reminder_at,reminder_notified,recurrence,reminder_minutes)
    VALUES('agenda-integration','agenda-local-synthetic','PRUEBA LOCAL — Evento existente','Descripción sintética guardada','Escuela','2030-10-31T12:00:45.123Z','2030-10-31T11:30:45.123Z',0,'none',30)`).run();
  const before=await db.prepare("SELECT * FROM manual_events").first();
  browser=await playwright.chromium.launch({channel:"msedge",headless:true,args:["--disable-background-networking"]});
  const pageErrors=[],results=[];let writes=0;
  async function scenario({credential="recovery_required",status=200,viewport={width:390,height:844},hold=true}={}){
    const context=await browser.newContext({viewport,serviceWorkers:"block",timezoneId:"America/Argentina/Buenos_Aires"});
    await context.addInitScript(()=>{
      localStorage.setItem("docentetuc-device-id","11111111-1111-4111-8111-111111111111");
      window.__accessHeadings=[];
      new MutationObserver(()=>{for(const h of document.querySelectorAll("h1")){const t=h.textContent;if(!window.__accessHeadings.includes(t))window.__accessHeadings.push(t);}}).observe(document,{childList:true,subtree:true});
    });
    let release;const gate=new Promise(r=>{release=r;});const counts={privateGets:0,credential:0};
    if(!hold)release();
    await context.route("**/*",async route=>{
      const request=route.request(),u=new URL(request.url());
      if(u.origin!==origin)return route.abort();
      if(!u.pathname.startsWith("/api/"))return route.continue();
      let body={},http=200;
      if(u.pathname==="/api/installations/credential"){
        counts.credential++;await sleep(120);body={status:credential,...(credential==="ready"?{deviceId:"11111111-1111-4111-8111-111111111111"}:{})};http=credential==="recovery_required"?409:credential==="unavailable"?503:200;
      }else if(u.pathname==="/api/app"){
        if(request.method()==="POST"){
          const payload=request.postDataJSON();assert.equal(payload.action,"save_event");
          writes++;const response=await mf.dispatchFetch("http://local/api/app",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
          return route.fulfill({status:response.status,contentType:"application/json",body:await response.text()});
        }
        counts.privateGets++;await gate;http=status;
        body=status===200?{...empty,personalPublications:[],manualEvents:(await db.prepare("SELECT * FROM manual_events WHERE user_id='agenda-local-synthetic'").all()).results}:{error:"Synthetic access failure"};
      }else if(u.pathname==="/api/public-app")body=empty;
      else if(u.pathname==="/api/auth/status")body={authenticated:true,image:null};
      else if(u.pathname==="/api/auth/link")body={linked:false};
      else if(u.pathname==="/api/news"||u.pathname==="/api/notices")body={items:[]};
      else if(u.pathname==="/api/ai")body={configured:false};
      else throw Error(`Unexpected local API: ${u.pathname}`);
      return route.fulfill({status:http,contentType:"application/json",body:JSON.stringify(body)});
    });
    const page=await context.newPage();page.on("pageerror",e=>pageErrors.push(e.message));
    await page.goto(`${origin}/?section=agenda`);await until(()=>counts.privateGets>0);
    return {context,page,release,counts,setStatus:value=>{status=value;}};
  }
  // A valid installation, then the exact account/device race seen before the fix.
  for(const credential of ["ready","recovery_required"]){
    const test=await scenario({credential});
    await test.page.getByRole("status").filter({hasText:"Comprobando sesión y acceso"}).waitFor();
    assert.equal(await test.page.getByRole("heading",{name:"Esta instalación necesita recuperación",exact:true}).count(),0);
    test.release();await test.page.getByRole("heading",{name:"Agenda docente",exact:true}).waitFor();
    const headings=await test.page.evaluate(()=>window.__accessHeadings);
    assert.ok(!headings.includes("Esta instalación necesita recuperación"));assert.ok(!headings.includes("No podemos mostrar tus datos privados todavía"));
    results.push({credential,status:200,recoveryFlash:false});
    await test.context.close();
  }
  for(const [credential,status,heading] of [["recovery_required",401,"Esta instalación necesita recuperación"],["recovery_required",503,"No pudimos comprobar el acceso en este momento"],["unavailable",401,"No pudimos comprobar el acceso en este momento"]]){
    const test=await scenario({credential,status});test.release();await test.page.getByRole("heading",{name:heading,exact:true}).waitFor();
    assert.equal(await test.page.getByRole("heading",{name:"Agenda docente",exact:true}).count(),0);
    if(status!==401||credential!=="recovery_required")assert.ok(!(await test.page.evaluate(()=>window.__accessHeadings)).includes("Esta instalación necesita recuperación"));
    if(status===503){test.setStatus(200);await test.page.getByRole("alert").filter({has:test.page.getByRole("heading",{name:heading,exact:true})}).getByRole("button",{name:"Reintentar",exact:true}).click();await test.page.getByRole("heading",{name:"Agenda docente",exact:true}).waitFor();}
    results.push({credential,status,expected:heading});await test.context.close();
  }
  const test=await scenario({hold:false});const p=test.page;await p.getByRole("heading",{name:"Agenda docente",exact:true}).waitFor();
  const shot=async name=>{await sleep(250);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Horizontal overflow: ${name}`);await p.screenshot({path:join(output,`${name}.png`),animations:"disabled"});};
  // Real bottom navigation, header and sidebar, not the isolated Agenda fixture.
  await p.getByRole("button",{name:"Inicio",exact:true}).click();assert.equal(new URL(p.url()).search,"");
  await p.getByRole("button",{name:"Agenda",exact:true}).click();assert.equal(new URL(p.url()).search,"?section=agenda");
  await p.locator(".agenda-ui-tabs").getByRole("button",{name:"Agenda",exact:true}).click();
  await p.getByRole("button",{name:"Ver evento: PRUEBA LOCAL — Evento existente",exact:true}).click();
  const dialog=p.getByRole("dialog");await dialog.getByRole("heading",{name:"Detalle del evento",exact:true}).waitFor();
  const text=await dialog.innerText();assert.ok(text.includes("Descripción sintética guardada")&&text.includes("09:00")&&text.includes("Recordatorio configurado"));
  await p.evaluate(()=>{window.__accessHeadings=[];});
  await dialog.getByRole("button",{name:"Editar evento",exact:true}).click();
  await p.getByLabel("Título",{exact:true}).fill("PRUEBA LOCAL — Evento actualizado");
  await p.getByRole("button",{name:"Guardar evento",exact:true}).click();
  const card=p.getByRole("button",{name:"Ver evento: PRUEBA LOCAL — Evento actualizado",exact:true});await card.waitFor();
  assert.ok(!(await p.evaluate(()=>window.__accessHeadings)).some(h=>h.includes("Comprobando sesión")||h.includes("necesita recuperación")));
  const updated=await db.prepare("SELECT * FROM manual_events").first();assert.equal(updated.starts_at,before.starts_at);assert.equal(updated.reminder_at,before.reminder_at);assert.equal(updated.reminder_minutes,before.reminder_minutes);
  for(const mode of ["Mes","Semana","Agenda"]){await p.locator(".agenda-ui-tabs").getByRole("button",{name:mode,exact:true}).click();assert.equal(await card.count(),1);}
  await p.locator(".agenda-ui-tabs").getByRole("button",{name:"Mes",exact:true}).click();
  await p.locator(".agenda-ui-day[aria-pressed=true]").click();assert.equal(await card.count(),1);
  await card.scrollIntoViewIfNeeded();await shot("mobile-agenda-light");
  await p.getByRole("button",{name:"Usar modo oscuro",exact:true}).click();await shot("mobile-agenda-dark");
  await p.getByRole("button",{name:"Evento",exact:true}).click();assert.equal(await p.getByLabel("Título",{exact:true}).inputValue(),"");
  for(const label of ["Guardar evento","Cancelar"]){const bounds=await p.getByRole("button",{name:label,exact:true}).boundingBox();assert.ok(bounds.y>=16&&bounds.y+bounds.height<=828,`Mobile action outside viewport: ${label}`);}
  await p.getByRole("combobox",{name:"Recordarme",exact:true}).click();await p.getByRole("option",{name:"30 minutos antes",exact:true}).click();
  assert.equal(await p.getByRole("combobox",{name:"Recordarme",exact:true}).innerText(),"30 minutos antes");
  const fieldBounds=await p.locator("[data-agenda-fields]").boundingBox(),helpBounds=await p.locator("[data-agenda-reminder-help]").boundingBox();
  assert.ok(fieldBounds.y+fieldBounds.height<=helpBounds.y,"Fields must not overlap the reminder explanation or actions");
  await shot("mobile-new-event");await p.getByRole("button",{name:"Cancelar",exact:true}).click();assert.equal(writes,1);
  await p.getByRole("button",{name:"Abrir menú",exact:true}).click();await p.getByRole("button",{name:"Cerrar menú",exact:true}).waitFor();await shot("mobile-menu");await p.getByRole("button",{name:"Cerrar menú",exact:true}).click();
  await p.getByRole("button",{name:"Abrir DocenteTuc IA",exact:true}).click();await p.getByRole("button",{name:"Cerrar DocenteTuc IA",exact:true}).waitFor();await shot("mobile-ai");
  await p.getByRole("button",{name:"Maximizar DocenteTuc IA",exact:true}).click();await shot("mobile-ai-expanded");await p.getByRole("button",{name:"Cerrar DocenteTuc IA",exact:true}).click();
  await p.setViewportSize({width:1440,height:1000});await p.getByRole("button",{name:"Inicio",exact:true}).click();await p.getByRole("button",{name:"Agenda",exact:true}).click();
  await p.locator(".agenda-ui-tabs").getByRole("button",{name:"Agenda",exact:true}).click();await shot("desktop-agenda-dark");
  await p.getByRole("button",{name:"Usar modo claro",exact:true}).click();await shot("desktop-agenda-light");
  await p.reload();await p.getByRole("heading",{name:"Agenda docente",exact:true}).waitFor();await p.locator(".agenda-ui-tabs").getByRole("button",{name:"Agenda",exact:true}).click();await card.waitFor();
  assert.equal(await card.count(),1);assert.equal(await p.evaluate(()=>localStorage.getItem("docentetuc-device-id")),"11111111-1111-4111-8111-111111111111");
  assert.ok(!(await p.evaluate(()=>window.__accessHeadings)).includes("Esta instalación necesita recuperación"));
  assert.equal((await db.prepare("SELECT count(*) n FROM notifications").first()).n,0);assert.equal((await db.prepare("SELECT count(*) n FROM manual_event_push_queue").first()).n,0);
  assert.deepEqual(pageErrors,[]);
  writeFileSync(join(output,"result.json"),JSON.stringify({ok:true,accessCases:results,fullAppNavigation:true,f5Persistence:true,localEdits:writes,reminderDatesPreserved:true,productionAccess:false},null,2));
  console.log(JSON.stringify({ok:true,accessCases:results.length,fullAppNavigation:true,f5Persistence:true,localEdits:writes,productionAccess:false}));
}finally{if(browser)await browser.close();await mf.dispose();}
