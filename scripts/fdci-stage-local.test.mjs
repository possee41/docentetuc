import assert from "node:assert/strict";
import test from "node:test";
import { deltaFixture } from "./fdci-delta-local-fixture.mjs";
import { deltaRequest } from "./fdci-delta.mjs";
import { automationRequest } from "../workers/fdci-automation.mjs";

test("full queue rejects new IDs but accepts replacement of existing IDs without changing FIFO", async t => {
  const f = await deltaFixture(2, 2); t.after(() => f.sqlite.close());
  f.sqlite.exec(`WITH RECURSIVE n(i) AS (SELECT 9000 UNION ALL SELECT i+1 FROM n WHERE i<9999)
    INSERT INTO fdci_delta_queue(publication_id,content_hash,payload) SELECT 'fdci:commission:'||i,'${"a".repeat(64)}','{}' FROM n`);
  const call = items => deltaRequest(f.target, f.owner, { op: "stage", revision: f.state().revision, items }, f.fetcher);
  const added = { ...f.data.items[0], id: "fdci:commission:12000", externalId: "12000" };
  added.metadata = JSON.stringify({ ...JSON.parse(added.metadata), commissionId: 12000 });
  const before = f.state(), queue = f.queue();
  await assert.rejects(call([added]), /HTTP_409/);
  assert.deepEqual(f.state(), before); assert.deepEqual(f.queue(), queue);
  await call(f.data.items);
  assert.equal(f.queue().length, 1000);
  assert.deepEqual(f.queue().slice(0, 2).map(x => [x.seq, x.version]), [[1, 2], [2, 2]]);
  const repeat = f.queue(); await call(f.data.items); assert.deepEqual(f.queue(), repeat);
});

test("foreign and UNKNOWN publications remain protected before queue writes", async t => {
  const f = await deltaFixture(2, 2); t.after(() => f.sqlite.close());
  for (const sql of ["UPDATE publications SET source='Foreign'", "UPDATE publications SET source='Capacitación Docente',normalized_status='UNKNOWN'"]) {
    f.sqlite.exec(sql); const state = f.state();
    await assert.rejects(deltaRequest(f.target, f.owner, { op: "stage", revision: state.revision, items: f.data.items }, f.fetcher), /HTTP_422/);
    assert.deepEqual(f.state(), state); assert.equal(f.queue().length, 0);
  }
});

test("admission read failure cannot advance revision, queue or publication hashes", async t => {
  const f = await deltaFixture(2, 2); t.after(() => f.sqlite.close());
  const state = f.state(), rows = f.sqlite.prepare("SELECT id,content_hash FROM publications ORDER BY id").all();
  f.env.DB = { ...f.db, prepare(sql) { if (sql.includes("AS protected_record")) throw new Error("synthetic read failure"); return f.db.prepare(sql); } };
  await assert.rejects(deltaRequest(f.target, f.owner, { op: "stage", revision: state.revision, items: f.data.items }, f.fetcher), /UNCERTAIN/);
  assert.deepEqual(f.state(), state); assert.equal(f.queue().length, 0);
  assert.deepEqual(f.sqlite.prepare("SELECT id,content_hash FROM publications ORDER BY id").all(), rows);
});

test("automation forwards the bounded original JSON, including split UTF-8, while retaining validation", async () => {
  const owner = "100-1", sha = "a".repeat(40), secret = "synthetic_stage_forward_secret_123456789";
  const from = Math.floor(Date.now() / 7_200_000) * 7_200_000;
  const state = { approved_sha: sha, owner, status: "RUNNING", not_before: new Date(from).toISOString(),
    not_after: new Date(from + 7_200_000).toISOString(), lease_until: new Date(Date.now() + 600_000).toISOString() };
  const env = { FDCI_AUTOMATION_ENABLED: "true", FDCI_DELTA_ENABLED: "true", FDCI_AUTOMATION_SECRET: secret,
    IMPORT_GATE_ALLOWED_SOURCE: "fdci", DB: { prepare: () => ({ first: async () => state }) } };
  const raw = ' { "op" : "state", "note" : "á🙂", "escaped" : "a\\/b" }\n';
  const bytes = new TextEncoder().encode(raw);
  const make = data => new Request("http://local.test/api/internal/fdci-automation/delta", { method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}`, "x-import-gate-owner": owner, "x-fdci-automation-sha": sha },
    body: new ReadableStream({ start(c) { for (let i = 0; i < data.length; i++) c.enqueue(data.slice(i, i + 1)); c.close(); } }), duplex: "half" });
  let forwarded = 0;
  const delegate = async (request, scoped) => {
    forwarded++; assert.equal(await request.text(), raw); assert.equal(new URL(request.url).pathname, "/api/internal/fdci-delta");
    assert.equal(scoped.IMPORT_GATE_LEASE_REQUIRED, "true"); assert.equal(scoped.FDCI_IMPORT_SECRET, secret);
    return Response.json({ ok: true });
  };
  const authorized = async (header, token) => header === `Bearer ${secret}` && token === secret;
  assert.equal((await automationRequest(make(bytes), env, authorized, delegate)).status, 200);
  assert.equal((await automationRequest(make(new TextEncoder().encode("{bad")), env, authorized, delegate)).status, 400);
  assert.equal((await automationRequest(make(new Uint8Array(150_001)), env, authorized, delegate)).status, 413);
  assert.equal(forwarded, 1);
});
