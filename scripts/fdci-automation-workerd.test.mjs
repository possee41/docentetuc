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

test("local Workerd resumes HALTED canary candidates with idempotent staging, lost-ACK recovery and completed cursor", async () => {
  const bundle = await build({ entryPoints: ["workers/source-import-gateway.mjs"], bundle: true, format: "esm", platform: "browser", target: "es2022", write: false });
  const secret = "synthetic_workerd_stage_secret_1234567890", sha = "a".repeat(40), owner = "100-1";
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-05-15", d1Databases: ["DB"], d1Persist: false,
    bindings: { IMPORT_DATABASE_NAME: "synthetic-canary", IMPORT_DATABASE_ID: "synthetic-id", IMPORT_GATE_ALLOWED_SOURCE: "fdci",
      IMPORT_GATE_ENABLED: "false", IMPORT_GATE_LEASE_REQUIRED: "false", FDCI_EXTERNAL_ENABLED: "false",
      FDCI_AUTOMATION_ENABLED: "true", FDCI_DELTA_ENABLED: "true", FDCI_AUTOMATION_SECRET: secret } });
  try {
    const db = await mf.getD1Database("DB");
    for (const text of [...fdciFixtureSql(), ...["0033_fdci_automation_control.sql", "0034_fdci_delta_queue.sql"].map(f => readFileSync(`migrations/${f}`, "utf8"))])
      for (const sql of text.replace(/^--.*$/gm, "").split(";").map(x => x.trim()).filter(Boolean)) await db.prepare(sql).run();
    const from = Math.floor(Date.now() / 7_200_000) * 7_200_000;
    await db.prepare("INSERT INTO import_gateway_identity VALUES(1,'synthetic-canary','synthetic-id')").run();
    const items = await prepareFdciImports([{ capacitacion_id: 100, nombre: "Canary FDCI sintético — NO OFICIAL", token: "synthetic", slug: "synthetic" }],
      [9000, 9001].map((id, i) => ({ id, capacitacion_id: 100, cupo: 21 + i, fecha_apertura_preinscripcion: "2026-01-01 08:00:00", fecha_cierre_preinscripcion: "2099-12-01 08:00:00" })),
      new Date("2026-11-05T11:00:00Z"));
    const evidence = JSON.parse(readFileSync("docs/evidence/2026-11-05-fdci-functional-canary-cpu.json", "utf8"));
    assert.deepEqual(items.map(x => [x.id, x.contentHash]), evidence.finalSynthetic.queue.map(x => [x.publication_id, x.content_hash]));
    // Local reproduction of the preserved canary, not a remote recovery/reset.
    await db.batch([
      ...items.map(item => db.prepare("INSERT INTO fdci_delta_queue(publication_id,content_hash,payload) VALUES(?,?,?)")
        .bind(item.id, item.contentHash, JSON.stringify(item))),
      db.prepare("UPDATE fdci_delta_state SET revision=1,last_staged_id='fdci:commission:9001' WHERE id=1"),
      db.prepare("UPDATE fdci_automation_control SET status='HALTED',last_slot=?,approved_sha=?,not_before=?,not_after=?,halt_reason='CANARY_TEST_FINISHED' WHERE id=1")
        .bind(Math.floor(from / 7_200_000) - 1, sha, new Date(from).toISOString(), new Date(from + 7_200_000).toISOString()),
    ]);
    const preserved = (await db.prepare("SELECT seq,publication_id,content_hash,payload,version FROM fdci_delta_queue ORDER BY seq").all()).results;
    const post = async (op, body, expected = 200) => {
      const response = await mf.dispatchFetch(`http://local.test/api/internal/fdci-automation/${op}`, { method: "POST",
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json", "x-import-gate-owner": owner, "x-fdci-automation-sha": sha }, body: JSON.stringify(body) });
      assert.equal(response.status, expected); return response.json();
    };
    assert.equal((await post("start", { source: "fdci", action: "open", owner, ttlSeconds: 600 }, 503)).error, "AUTOMATION_HALTED");
    // Explicit operator authorization of a NEW local window; never an automatic unhalt.
    await db.prepare("UPDATE fdci_automation_control SET status='IDLE',approved_sha=?,not_before=?,not_after=?,halt_reason=NULL WHERE id=1 AND status='HALTED'")
      .bind(sha, new Date(from).toISOString(), new Date(from + 7_200_000).toISOString()).run();
    assert.deepEqual((await db.prepare("SELECT seq,publication_id,content_hash,payload,version FROM fdci_delta_queue ORDER BY seq").all()).results, preserved);
    await post("start", { source: "fdci", action: "open", owner, ttlSeconds: 600 });
    const snapshot = await post("delta", { op: "snapshot", after: "", queuedAfter: "" });
    assert.equal(snapshot.state.revision, 1); assert.equal(snapshot.queued.length, 2); assert.equal(snapshot.confirmed.length, 0);
    let state = (await post("delta", { op: "stage", revision: snapshot.state.revision, items })).state;
    assert.deepEqual((await db.prepare("SELECT seq,publication_id,content_hash,payload,version FROM fdci_delta_queue ORDER BY seq").all()).results, preserved);
    // Treat stage ACK as lost and recover its committed revision from D1, without resending stage.
    const recovered = await post("delta", { op: "snapshot", after: "", queuedAfter: "" });
    assert.equal(recovered.state.revision, 2); assert.deepEqual(recovered.state, state);
    state = (await post("delta", { op: "scan-complete", revision: recovered.state.revision,
      detail: { after: "000000000100", upper: "000000000100", complete: true } })).state;
    for (const item of items) {
      await post("import", { mode: "batch", items: [item], delta: { version: 1, revision: state.revision } });
      const confirmed = await post("delta", { op: "snapshot", after: "", queuedAfter: "" });
      assert.equal(confirmed.confirmed.find(x => x.id === item.id).content_hash, item.contentHash);
      state = (await post("delta", { op: "ack", revision: state.revision, id: item.id, hash: item.contentHash, version: 1 })).state;
    }
    assert.equal(state.revision, 5); assert.equal(state.detail_cycle, 2);
    assert.equal(state.detail_after, ""); assert.equal(state.detail_upper, ""); assert.ok(state.last_complete_scan_at);
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM fdci_delta_queue").first()).n, 0);
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM publications").first()).n, 2);
    assert.equal((await db.prepare("SELECT publication_attempts FROM fdci_automation_control").first()).publication_attempts, 2);
    const finalSnapshot = await post("delta", { op: "snapshot", after: "", queuedAfter: "" });
    assert.equal(finalSnapshot.queued.length, 0);
    assert.deepEqual(finalSnapshot.confirmed.map(x => [x.id, x.content_hash]), items.map(x => [x.id, x.contentHash]));
    await post("close", { source: "fdci", action: "close", owner });
    assert.equal((await post("finish", { success: false, reason: "LOCAL_TEST_FINISHED" })).halted, true);
  } finally { await mf.dispose(); }
});
