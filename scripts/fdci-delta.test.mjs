import assert from "node:assert/strict";
import test from "node:test";
import { deltaFixture } from "./fdci-delta-local-fixture.mjs";
import { deltaRequest } from "./fdci-delta.mjs";
import { runGatewayImport } from "./import-via-gateway.mjs";
import { runFdciAutomation } from "./fdci-automation.mjs";
import { readFileSync } from "node:fs";

test("unchanged catalog uses paged hashes, no per-publication calls and no publication writes", async t => {
  const f = await deltaFixture(1000, 0); t.after(() => f.sqlite.close());
  const before = f.sqlite.prepare("SELECT total_changes() AS n").get().n;
  const r = await f.run();
  assert.equal(r.examined, 1000); assert.equal(r.queued, 0); assert.equal(r.processed, 0);
  assert.equal(f.metrics.publicationRequests, 0); assert.equal(f.queue().length, 0);
  assert.equal(f.metrics.gatewayRequests, 10); // Two state reads, six confirmed pages, queued page and scan acknowledgement.
  assert.equal(f.sqlite.prepare("SELECT total_changes() AS n").get().n - before, 1);
});

test("ten changes are durable; only two applied per run, FIFO drains without repeated publication writes", async t => {
  const f = await deltaFixture(259, 10); t.after(() => f.sqlite.close());
  const results = [];
  for (let i = 0; i < 5; i++) results.push(await f.run());
  assert.deepEqual(results.map(r => r.pending), [8, 6, 4, 2, 0]);
  assert.equal(results.reduce((s, r) => s + r.updated, 0), 10);
  assert.equal(f.metrics.publicationRequests, 10);
  const repeated = await f.run(); assert.equal(repeated.queued, 0); assert.equal(repeated.processed, 0);
});

test("new identifiers are queued and created without treating existing rows as additions", async t => {
  const f = await deltaFixture(30, 0); t.after(() => f.sqlite.close());
  const item = { ...f.data.items[0], id: "fdci:commission:12000", externalId: "12000", contentHash: "b".repeat(64) };
  item.metadata = JSON.stringify({ ...JSON.parse(item.metadata), commissionId: 12000 });
  f.data.items.push(item);
  const r = await f.run(); assert.equal(r.created, 1); assert.equal(r.updated, 0); assert.equal(r.pending, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM publications").get().n, 31);
});

test("a pending change reverted to confirmed D1 content is acknowledged without republishing", async t => {
  const f = await deltaFixture(30, 10); t.after(() => f.sqlite.close()); await f.run();
  f.data.items[2] = structuredClone(f.data.baseline[2]);
  const r = await f.run(); assert.equal(r.confirmedFromD1, 1); assert.equal(r.updated, 1);
  assert.equal(r.pending, 6); assert.equal(f.metrics.publicationRequests, 3);
});

test("lost publication ACK retains queue; recovery trusts D1 and does not resend committed publication", async t => {
  const f = await deltaFixture(30, 2); t.after(() => f.sqlite.close()); f.controls.lostOp = "import";
  await assert.rejects(f.run(), /IMPORT_RESULT_UNCERTAIN/); assert.equal(f.queue().length, 2);
  const recovered = await f.run(); assert.equal(recovered.confirmedFromD1, 1); assert.equal(recovered.updated, 1);
  assert.equal(f.metrics.publicationRequests, 2); assert.equal(f.queue().length, 0);
});

test("lost queue ACK is reconciled by D1 without a second publication request", async t => {
  const f = await deltaFixture(30, 2); t.after(() => f.sqlite.close()); f.controls.lostOp = "ack";
  await assert.rejects(f.run(), error => {
    assert.equal(error.result.updated, 1); assert.equal(error.result.processed, 0); assert.equal(error.result.uncertain, 1);
    return error.message === "FDCI_DELTA_UNCERTAIN";
  }); assert.equal(f.queue().length, 1);
  const recovered = await f.run(); assert.equal(recovered.processed, 1); assert.equal(f.queue().length, 0);
  assert.equal(f.metrics.publicationRequests, 2);
});

test("lost stage ACK keeps acknowledged D1 progress; partial collection never clears queued or historical data", async t => {
  const f = await deltaFixture(30, 10); t.after(() => f.sqlite.close()); f.controls.lostOp = "stage";
  await assert.rejects(f.run(), /FDCI_DELTA_UNCERTAIN/); assert.equal(f.queue().length, 2);
  assert.equal(f.state().last_complete_scan_at, null);
  const queue = f.queue(), state = f.state();
  await assert.rejects(f.run(async () => ({ items: [], failures: 1 })), /COLLECTION_INCOMPLETE/);
  assert.deepEqual(f.queue(), queue); assert.deepEqual(f.state(), state);
  const recovered = await f.run(); assert.equal(recovered.queued, 8); assert.equal(recovered.pending, 8);
});

test("stage transaction rollback, CAS concurrency and expiry do not falsely confirm work", async t => {
  const f = await deltaFixture(30, 2); t.after(() => f.sqlite.close());
  const call = body => deltaRequest(f.target, f.owner, body, f.fetcher);
  f.controls.failBatch = true;
  await assert.rejects(call({ op: "stage", revision: 0, items: f.data.items.slice(0, 2) }), /UNCERTAIN/);
  assert.equal(f.state().revision, 0); assert.equal(f.queue().length, 0);
  const requests = [0, 1].map(i => call({ op: "stage", revision: 0, items: [f.data.items[i]] }));
  const r = await Promise.allSettled(requests);
  assert.equal(r.filter(x => x.status === "fulfilled").length, 1); assert.equal(f.queue().length, 1);
  const before = f.state(); f.sqlite.exec("UPDATE import_gate_lease SET expires_at='2000-01-01T00:00:00Z'");
  await assert.rejects(call({ op: "scan-complete", revision: before.revision }), /UNCERTAIN/);
  assert.deepEqual(f.state(), before);
});

test("coalescing preserves queue order; stale confirmation and unknown/missing records cannot delete pending data", async t => {
  const f = await deltaFixture(30, 10); t.after(() => f.sqlite.close()); await f.run();
  const row = f.queue()[0], item = f.data.items.find(x => x.id === row.publication_id);
  item.summary = "Otra novedad sintética"; item.contentHash = "a".repeat(64);
  await deltaRequest(f.target, f.owner, { op: "stage", revision: f.state().revision, items: [item] }, f.fetcher);
  assert.equal(f.queue()[0].seq, row.seq); assert.equal(f.queue()[0].version, row.version + 1);
  await assert.rejects(deltaRequest(f.target, f.owner, { op: "ack", revision: f.state().revision,
    id: row.publication_id, hash: row.content_hash, version: row.version }, f.fetcher), /409/);
  const remaining = f.queue().length;
  f.data.items = []; const empty = await f.run(); assert.equal(empty.processed, 0); assert.equal(f.queue().length, remaining);
});

test("new route is opt-in, authenticated, source- and owner-isolated", async t => {
  const f = await deltaFixture(); t.after(() => f.sqlite.close());
  const call = (secret, owner = f.owner) => f.fetcher(`${f.target.origin}/api/internal/fdci-delta`, {
    method: "POST", headers: { authorization: `Bearer ${secret}`, "x-import-gate-owner": owner, "content-type": "application/json" },
    body: JSON.stringify({ op: "state" }),
  });
  f.env.FDCI_DELTA_ENABLED = "false"; assert.equal((await call(f.target.secret)).status, 503); assert.equal(f.metrics.queries, 0);
  f.env.FDCI_DELTA_ENABLED = "true"; assert.equal((await call("incorrect_secret_1234567890123456789012")).status, 401);
  assert.equal(f.metrics.queries, 0);
  assert.equal((await call(f.target.secret, "previous-owner")).status, 409); assert.equal(f.metrics.changedSqlRows, 0);
  f.env.IMPORT_GATE_ALLOWED_SOURCE = "sime"; assert.equal((await call(f.target.secret)).status, 503);
});

test("protected existing rows and a full queue fail closed without discarding work", async t => {
  const f = await deltaFixture(30, 2); t.after(() => f.sqlite.close());
  const call = () => deltaRequest(f.target, f.owner, { op: "stage", revision: 0, items: [f.data.items[0]] }, f.fetcher);
  f.sqlite.prepare("UPDATE publications SET normalized_status='UNKNOWN' WHERE id=?").run(f.data.items[0].id);
  await assert.rejects(call(), /422/); assert.equal(f.state().revision, 0);
  f.sqlite.prepare("UPDATE publications SET normalized_status='ACTIVE' WHERE id=?").run(f.data.items[0].id);
  const insert = f.sqlite.prepare("INSERT INTO fdci_delta_queue(publication_id,content_hash,payload) VALUES(?,?,?)");
  for (let i = 0; i < 1000; i++) {
    const item = { ...f.data.items[0], id: `fdci:commission:${12000 + i}`, externalId: String(12000 + i) };
    item.metadata = JSON.stringify({ ...JSON.parse(item.metadata), commissionId: 12000 + i });
    insert.run(item.id, item.contentHash, JSON.stringify(item));
  }
  await assert.rejects(call(), /409/); assert.equal(f.queue().length, 1000); assert.equal(f.state().revision, 0);
});

test("real collector is reused; request-budget exhaustion cannot certify or reconcile an incomplete catalogue", async t => {
  const f = await deltaFixture(); t.after(() => f.sqlite.close());
  const config = { FDCI_SCOPE: "active", FDCI_MAX_REQUESTS: "6", FDCI_MAX_PUBLICATIONS: "2",
    FDCI_PAUSE_MS: "400", IMPORT_GATE_RUN_ID: f.owner, FDCI_DELTA_ENABLED: "true" };
  const courses = Array.from({ length: 5 }, (_, i) => ({ capacitacion_id: 100 + i, nombre: "Actualización sintética",
    token: `synthetic${i}`, slug: `synthetic-${i}` }));
  const commissions = courses.map((c, i) => ({ id: 9000 + i, capacitacion_id: c.capacitacion_id,
    fecha_apertura_preinscripcion: "2026-01-01 08:00:00", fecha_cierre_preinscripcion: "2099-12-01 08:00:00" }));
  let calls = 0;
  const source = async (url, init) => {
    calls++;
    if (String(url).endsWith("getCapaActivas")) return Response.json(commissions);
    if (String(url).endsWith("getRestoCapas")) return Response.json(courses);
    const course = courses.find(c => c.token === JSON.parse(init.body).token);
    return Response.json({ comisiones: commissions.filter(c => c.capacitacion_id === course.capacitacion_id) });
  };
  await assert.rejects(runGatewayImport(f.target, config, source, f.fetcher), /COLLECTION_INCOMPLETE/);
  assert.equal(calls, 6); assert.equal(f.queue().length, 0); assert.equal(f.metrics.changedSqlRows, 0);
  assert.equal(f.state().last_complete_scan_at, null);
});

test("opt-in automation reuses secret/SHA/lease facade, keeps two attempts, and missing CPU still halts", async t => {
  const f = await deltaFixture(30, 2); t.after(() => f.sqlite.close());
  const sha = "a".repeat(40), secret = "synthetic_delta_auto_secret_123456789012345";
  const name = "docentetuc-web-canary-1-2-local", id = "00000000-0000-4000-8000-000000000012";
  f.sqlite.exec(readFileSync("migrations/0033_fdci_automation_control.sql", "utf8"));
  f.sqlite.prepare("UPDATE import_gateway_identity SET database_name=?,database_id=?").run(name, id);
  f.sqlite.exec("DELETE FROM import_gate_lease");
  const from = Math.floor(Date.now() / 7_200_000) * 7_200_000;
  f.sqlite.prepare("UPDATE fdci_automation_control SET status='IDLE',approved_sha=?,not_before=?,not_after=?")
    .run(sha, new Date(from).toISOString(), new Date(from + 86_400_000).toISOString());
  Object.assign(f.env, { IMPORT_DATABASE_NAME: name, IMPORT_DATABASE_ID: id, FDCI_AUTOMATION_ENABLED: "true", FDCI_AUTOMATION_SECRET: secret });
  const config = { SYNC_SOURCE: "fdci", IMPORT_GATEWAY_ENABLED: "true", FDCI_AUTOMATION_ENABLED: "true", FDCI_DELTA_ENABLED: "true",
    IMPORT_GATEWAY_ORIGIN: f.target.origin, IMPORT_GATEWAY_DATABASE_NAME: name, IMPORT_GATEWAY_DATABASE_ID: id,
    IMPORT_GATEWAY_APPROVED_SHA: sha, FDCI_AUTOMATION_SECRET: secret, IMPORT_GATE_RUN_ID: "100-1",
    FDCI_MAX_PUBLICATIONS: "2", FDCI_MAX_REQUESTS: "6", FDCI_PAUSE_MS: "400", FDCI_SCOPE: "active" };
  const courses = [{ capacitacion_id: 100, nombre: "Nueva versión sintética", token: "synthetic", slug: "synthetic" }];
  const commissions = [9000, 9001, 9002].map(id => ({ id, capacitacion_id: 100,
    fecha_apertura_preinscripcion: "2026-01-01 08:00:00", fecha_cierre_preinscripcion: "2099-12-01 08:00:00" }));
  const source = async url => Response.json(String(url).endsWith("getCapaActivas") ? commissions :
    String(url).endsWith("getRestoCapas") ? courses : { comisiones: commissions });
  const r = await runFdciAutomation(config, sha, source, f.fetcher);
  assert.equal(r.code, "CPU_EVIDENCE_UNAVAILABLE"); assert.equal(r.automationSuspended, true);
  assert.equal(r.updated, 2); assert.equal(f.queue().length, 1);
  const state = f.sqlite.prepare("SELECT status,publication_attempts FROM fdci_automation_control WHERE id=1").get();
  assert.equal(state.status, "HALTED"); assert.equal(state.publication_attempts, 2);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM import_gate_lease WHERE julianday(expires_at)>julianday('now')").get().n, 0);
});
