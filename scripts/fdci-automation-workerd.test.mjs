import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fdciFixtureSql } from "./fdci-local-fixture.mjs";
import { prepareFdciImports } from "../lib/fdci-import.ts";
const require = createRequire(import.meta.url);
const { Miniflare } = require("../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare");
const { build } = require("../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild");

test("real local Workerd/D1: atomic grants, server quota, sticky halt and untouched publication dedupe", async () => {
  const bundle = await build({ entryPoints: ["workers/source-import-gateway.mjs"], bundle: true, format: "esm", platform: "browser", target: "es2022", write: false });
  const secret = "synthetic_workerd_automation_secret_123456";
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-05-15", d1Databases: ["DB"], d1Persist: false,
    bindings: { IMPORT_DATABASE_NAME: "synthetic-canary", IMPORT_DATABASE_ID: "synthetic-id", IMPORT_GATE_ALLOWED_SOURCE: "fdci",
      IMPORT_GATE_ENABLED: "false", IMPORT_GATE_LEASE_REQUIRED: "false", FDCI_EXTERNAL_ENABLED: "false",
      FDCI_AUTOMATION_ENABLED: "true", FDCI_AUTOMATION_SECRET: secret } });
  try {
    const db = await mf.getD1Database("DB");
    for (const text of [...fdciFixtureSql(), readFileSync("migrations/0033_fdci_automation_control.sql", "utf8")])
      for (const sql of text.replace(/^--.*$/gm, "").split(";").map(x => x.trim()).filter(Boolean)) await db.prepare(sql).run();
    await db.prepare("INSERT INTO import_gateway_identity VALUES(1,'synthetic-canary','synthetic-id')").run();
    const from = Math.floor(Date.now() / 7_200_000) * 7_200_000, sha = "a".repeat(40);
    await db.prepare("UPDATE fdci_automation_control SET status='IDLE',approved_sha=?,not_before=?,not_after=?")
      .bind(sha, new Date(from).toISOString(), new Date(from + 86_400_000).toISOString()).run();
    const post = (op, body, owner) => mf.dispatchFetch("http://local.test/api/internal/fdci-automation/" + op, {
      method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json", "x-import-gate-owner": owner, "x-fdci-automation-sha": sha }, body: JSON.stringify(body),
    });
    const opens = await Promise.all(["100-1", "101-1"].map(owner => post("start", { source: "fdci", action: "open", owner, ttlSeconds: 600 }, owner)));
    assert.deepEqual(opens.map(x => x.status).sort(), [200, 409]);
    const state = await db.prepare("SELECT * FROM fdci_automation_control").first(), owner = state.owner;
    const [item] = await prepareFdciImports([{ capacitacion_id: 42, nombre: "Ficticio", token: "ficticio", slug: "ficticio" }],
      [{ id: 9001, capacitacion_id: 42, fecha_apertura_preinscripcion: "2026-10-17 23:00:00", fecha_cierre_preinscripcion: "2099-10-19 08:00:00" }]);
    assert.equal((await post("import", { mode: "batch", items: [item] }, owner)).status, 200);
    const repeated = await post("import", { mode: "batch", items: [item] }, owner);
    assert.equal(repeated.status, 200);assert.equal((await repeated.json()).rowsWritten, 0);
    assert.equal((await post("import", { mode: "batch", items: [item] }, owner)).status, 409);
    assert.equal((await db.prepare("SELECT status FROM fdci_automation_control").first()).status, "HALTED");
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM publications").first()).n, 1);
    assert.equal((await post("checkpoint", { op: "get" }, owner)).status, 503);
  } finally { await mf.dispose(); }
});
