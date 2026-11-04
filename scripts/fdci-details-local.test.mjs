import assert from "node:assert/strict";
import test from "node:test";
import { deltaFixture } from "./fdci-delta-local-fixture.mjs";
import { collectFdciDeltaSlice } from "./collect-fdci-delta.mjs";
import { deltaRequest, runDeltaFdci } from "./fdci-delta.mjs";

test("detail cursor survives staged ACK loss and source reordering; new courses wait fairly for the next cycle", async t => {
  const f = await deltaFixture(30, 0); t.after(() => f.sqlite.close());
  const courses = Array.from({ length: 5 }, (_, i) => ({ capacitacion_id: 100 + i,
    nombre: "Versión sintética nueva", token: `synthetic${i}`, slug: `synthetic-${i}` }));
  const commissions = courses.map((c, i) => ({ id: 9000 + i, capacitacion_id: c.capacitacion_id,
    fecha_apertura_preinscripcion: "2026-01-01 08:00:00", fecha_cierre_preinscripcion: "2099-12-01 08:00:00" }));
  let calls = 0;
  const source = async (url, init) => {
    assert.ok(++calls <= 6);
    if (String(url).endsWith("getCapaActivas")) return Response.json([...commissions].reverse());
    if (String(url).endsWith("getRestoCapas")) return Response.json([...courses].reverse());
    const course = courses.find(c => c.token === JSON.parse(init.body).token);
    return Response.json({ comisiones: commissions.filter(c => c.capacitacion_id === course.capacitacion_id) });
  };
  const run = () => {
    calls = 0;
    return runDeltaFdci(f.target, { maxPublications: 2, owner: f.owner }, f.fetcher,
      (_, context) => collectFdciDeltaSlice(source, context));
  };
  f.controls.lostOp = "stage";
  await assert.rejects(run(), /UNCERTAIN/);
  assert.equal(f.state().detail_after, ""); assert.equal(f.queue().length, 2);
  const first = await run(); assert.equal(first.cycleComplete, false);
  assert.equal(f.state().detail_after, "000000000103");
  for (const [courseId, commissionId] of [[99, 9100], [105, 9105]]) {
    courses.push({ capacitacion_id: courseId, nombre: "Alta sintética", token: `synthetic${courseId}`, slug: `synthetic-${courseId}` });
    commissions.push({ ...commissions[0], id: commissionId, capacitacion_id: courseId });
  }
  f.controls.lostOp = "scan-complete";
  await assert.rejects(run(), /UNCERTAIN/); assert.equal(f.state().detail_cycle, 2);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM publications WHERE id IN ('fdci:commission:9100','fdci:commission:9105')").get().n, 0);
  for (let jobs = 0; jobs < 12 && (f.state().detail_cycle < 3 || f.queue().length); jobs++) await run();
  assert.ok(f.state().detail_cycle >= 3); assert.equal(f.queue().length, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM publications").get().n, 32);
});

test("a revision change between snapshot pages aborts before collecting or staging anything", async t => {
  const f = await deltaFixture(1000, 2); t.after(() => f.sqlite.close());
  let collected = false, injected = false;
  const transport = (url, init) => {
    const body = JSON.parse(init.body);
    if (!injected && body.op === "snapshot" && body.after) {
      injected = true; f.sqlite.exec("UPDATE fdci_delta_state SET revision=revision+1");
    }
    return f.fetcher(url, init);
  };
  await assert.rejects(runDeltaFdci(f.target, { maxPublications: 2, owner: f.owner }, transport,
    async () => { collected = true; return { items: f.data.items, failures: 0 }; }), /CONCURRENT_CHANGE/);
  assert.equal(collected, false); assert.equal(f.queue().length, 0); assert.equal(f.metrics.publicationRequests, 0);
});

test("source network failure cannot advance the detail cursor or drain an old observation", async t => {
  const f = await deltaFixture(30, 2); t.after(() => f.sqlite.close());
  f.controls.lostOp = "stage"; await assert.rejects(f.run(), /UNCERTAIN/);
  const before = f.state(), queue = f.queue();
  await assert.rejects(runDeltaFdci(f.target, { maxPublications: 2, owner: f.owner }, f.fetcher,
    () => { throw new Error("FDCI_NETWORK_ERROR"); }), /NETWORK_ERROR/);
  assert.deepEqual(f.state(), before); assert.deepEqual(f.queue(), queue);
});

test("invalid durable cursor is rejected before any source request", async () => {
  let calls = 0;
  await assert.rejects(collectFdciDeltaSlice(() => { calls++; throw new Error("UNEXPECTED_NETWORK"); },
    { state: { detail_after: "invalid", detail_upper: "" }, queued: new Map() }), /CURSOR_INVALID/);
  assert.equal(calls, 0);
});

test("a new execution resumes durable queue; the previous lease owner cannot write or acknowledge it", async t => {
  const f = await deltaFixture(30, 10); t.after(() => f.sqlite.close());
  f.controls.lostOp = "stage"; await assert.rejects(f.run(), /UNCERTAIN/);
  f.sqlite.exec("UPDATE import_gate_lease SET opened_by='new-execution'");
  await assert.rejects(f.run(), /409/);
  const r = await runDeltaFdci(f.target, { maxPublications: 2, owner: "new-execution" }, f.fetcher,
    async () => ({ items: f.data.items, failures: 0 }));
  assert.equal(r.updated, 2); assert.equal(r.pending, 8);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM publications").get().n, 30);
});

test("read retry consumes the same six-request budget; remaining details stay behind the durable cursor", async () => {
  const courses = Array.from({ length: 5 }, (_, i) => ({ capacitacion_id: 100 + i, nombre: "Ficticio", token: `s${i}`, slug: `s-${i}` }));
  const active = courses.map((c, i) => ({ id: 9000 + i, capacitacion_id: c.capacitacion_id }));
  let calls = 0, failOnce = true;
  const source = async (url, init) => {
    if (calls === 6) throw new Error("FDCI_PROBE_REQUEST_LIMIT"); calls++;
    if (String(url).endsWith("getCapaActivas")) return Response.json(active);
    if (String(url).endsWith("getRestoCapas")) return Response.json(courses);
    if (failOnce) { failOnce = false; return new Response(null, { status: 500 }); }
    const course = courses.find(c => c.token === JSON.parse(init.body).token);
    return Response.json({ comisiones: active.filter(c => c.capacitacion_id === course.capacitacion_id) });
  };
  const first = await collectFdciDeltaSlice(source, { state: { detail_after: "", detail_upper: "" }, queued: new Map() });
  assert.equal(calls, 6); assert.equal(first.detail.after, "000000000102"); assert.equal(first.detail.complete, false);
  calls = 0;
  const next = await collectFdciDeltaSlice(source, { state: { detail_after: first.detail.after, detail_upper: first.detail.upper }, queued: new Map() });
  assert.equal(calls, 4); assert.equal(next.detail.complete, true);
  assert.equal(new Set([...first.items, ...next.items].map(x => x.id)).size, 5);
});

test("full queue pagination never returns more than 200 combined hashes and still applies at most two", async t => {
  const f = await deltaFixture(1000, 1000); t.after(() => f.sqlite.close());
  for (let i = 0; i < 1000; i += 2)
    await deltaRequest(f.target, f.owner, { op: "stage", revision: f.state().revision, items: f.data.items.slice(i, i + 2) }, f.fetcher);
  let pages = 0;
  const transport = async (url, init) => {
    const response = await f.fetcher(url, init);
    if (JSON.parse(init.body).op === "snapshot") {
      const body = await response.clone().json(); pages++;
      assert.ok(body.confirmed.length + body.queued.length <= 200);
    }
    return response;
  };
  const r = await runDeltaFdci(f.target, { maxPublications: 2, owner: f.owner }, transport,
    async () => ({ items: f.data.items, failures: 0 }));
  assert.equal(pages, 10); assert.equal(r.updated, 2); assert.equal(r.pending, 998);
});
