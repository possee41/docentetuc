import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { prepareFdciImports } from "../lib/fdci-import.ts";
import { fdciFixtureSql } from "./fdci-local-fixture.mjs";
import { runGatewayImport } from "./import-via-gateway.mjs";

// Same installed runtime used by the existing isolated D1 checks; no downloads.
const require = createRequire(import.meta.url);
const { Miniflare } = require("../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare");
const { build } = require("../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild");

test("gateway real en Workerd y D1 efímera: propietario, escritura y repetición sin cambios", async () => {
  const bundle = await build({ entryPoints: ["workers/source-import-gateway.mjs"], bundle: true,
    write: false, format: "esm", platform: "browser", target: "es2022" });
  const secret = "synthetic_local_fdci_secret_1234567890";
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text,
    d1Databases: ["DB"], d1Persist: false, compatibilityDate: "2026-05-15", bindings: {
      IMPORT_DATABASE_NAME: "synthetic-canary", IMPORT_DATABASE_ID: "synthetic-id",
      IMPORT_GATE_ENABLED: "false", IMPORT_GATE_LEASE_REQUIRED: "true", IMPORT_GATE_ALLOWED_SOURCE: "fdci",
      FDCI_EXTERNAL_ENABLED: "true", FDCI_IMPORT_SECRET: secret,
    } });
  try {
    const db = await mf.getD1Database("DB");
    for(const text of fdciFixtureSql()) for(const sql of text.replace(/^--.*$/gm, "").split(";").map(x=>x.trim()).filter(Boolean)) await db.prepare(sql).run();
    await db.prepare("INSERT INTO import_gateway_identity VALUES(1,'synthetic-canary','synthetic-id')").run();
    const post = (path, body, owner = "local-a") => mf.dispatchFetch(`https://local.test/api/internal/${path}`, {
      method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json", "x-import-gate-owner": owner },
      body: JSON.stringify(body) });
    const control = (action, owner = "local-a") => post("import-gate", { source: "fdci", action, owner, ttlSeconds: 600 });
    assert.equal((await post("import-gate", { source: "constructor", action: "open", owner: "local-a" })).status, 400);
    const openings = await Promise.all([control("open"), control("open", "local-b")]);
    assert.deepEqual(openings.map(r => r.status).sort(), [200, 409]);
    const owner = (await db.prepare("SELECT opened_by FROM import_gate_lease").first()).opened_by;
    const [item] = await prepareFdciImports([{ capacitacion_id: 42, nombre: "Ficticio", token: "ficticio", slug: "ficticio" }],
      [{ id: 9001, capacitacion_id: 42, fecha_apertura_preinscripcion: "2026-10-17 23:00:00", fecha_cierre_preinscripcion: "2026-10-19 08:00:00" }]);
    const body = { mode: "batch", items: [item] };
    assert.equal((await post("fdci-import", body, "loser")).status, 409);
    const first = await post("fdci-import", body, owner);
    assert.equal(first.status, 200);
    const created = await first.json();
    assert.equal(created.created, 1);
    const repeat = await post("fdci-import", body, owner);
    assert.equal(repeat.status, 200);
    const unchanged = await repeat.json();
    assert.equal(unchanged.unchanged, 1);
    assert.equal(unchanged.rowsWritten, 0);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM publications").first()).n, 1);
    assert.equal((await control("close", "loser")).status, 409);
    assert.equal((await control("close", owner)).status, 200);
    assert.equal((await post("fdci-import", body, owner)).status, 503);
    assert.equal((await control("open", owner)).status, 200);
    const target={source:"fdci",origin:"https://local.test",endpoint:"https://local.test/api/internal/fdci-import",secret,id:"synthetic-id",name:"synthetic-canary"};
    const config={FDCI_SCOPE:"active",FDCI_MAX_REQUESTS:"6",FDCI_MAX_PUBLICATIONS:"5",FDCI_PAUSE_MS:"400",IMPORT_GATE_RUN_ID:owner};
    const parent={capacitacion_id:100,nombre:"Curso ficticio",token:"ficticio",slug:"ficticio"};
    const commissions=Array.from({length:30},(_,i)=>({id:10000+i,capacitacion_id:100,fecha_apertura_preinscripcion:"2026-10-17 23:00:00",fecha_cierre_preinscripcion:"2026-10-19 08:00:00"}));
    const source=async url=>Response.json(String(url).endsWith("getCapaActivas")?commissions:String(url).endsWith("getRestoCapas")?[parent]:{comisiones:commissions});
    const publicationAcks=[];
    const receiver=async(url,init)=>{const r=await mf.dispatchFetch(url,init);if(String(url).endsWith("fdci-import"))publicationAcks.push(await r.clone().json());return r;};
    const cycles=[];
    for(let cycle=0;cycle<2;cycle++) {
      const results=[];
      do{results.push(await runGatewayImport(target,config,source,receiver));assert.ok(results.length<=6);}while(!results.at(-1).cycleComplete);
      assert.equal(results.length,6);cycles.push(results);
    }
    assert.equal(cycles[0].reduce((s,x)=>s+x.created,0),30);
    assert.equal(cycles[1].reduce((s,x)=>s+x.unchanged,0),30);
    assert.ok(publicationAcks.slice(30).every(x=>x.rowsWritten===0));
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM publications").first()).n,31);
    assert.equal((await control("close", owner)).status,200);
    console.log(JSON.stringify({runtime:"local-workerd",firstCycleRuns:6,secondCycleRuns:6,publications:31,repeatPublicationWrites:0,cpuMs:null}));
    console.log(JSON.stringify({ runtime: "local-workerd", receiver: { first: created, repeat: unchanged }, cpuMs: null }));
  } finally { await mf.dispose(); }
});
