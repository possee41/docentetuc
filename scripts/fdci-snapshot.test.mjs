import test from "node:test";
import assert from "node:assert/strict";
import { deltaFixture } from "./fdci-delta-local-fixture.mjs";
import { fdciDelta } from "../workers/fdci-delta.mjs";

test("two pending candidates: batched snapshot preserves hashes, revision, payloads and audit", async t => {
  const f = await deltaFixture(2, 2); t.after(() => f.sqlite.close());
  await fdciDelta({ op: "stage", revision: 0, items: f.data.items }, f.db, f.owner);
  const queue = f.queue(), state = f.state(), changes = f.sqlite.prepare("SELECT total_changes() n").get().n;
  const response = await fdciDelta({ op: "snapshot", after: "", queuedAfter: "" }, f.db, f.owner);
  const result = await response.json();
  assert.equal(response.status, 200); assert.equal(result.state.revision, state.revision);
  assert.deepEqual(result.queued.map(x => [x.id, x.content_hash]), queue.map(x => [x.publication_id, x.content_hash]));
  assert.equal(result.confirmed.length, 2); assert.equal(result.confirmedMore, false); assert.equal(result.queuedMore, false);
  assert.deepEqual(f.queue(), queue); assert.deepEqual(f.state(), state);
  assert.equal(f.sqlite.prepare("SELECT total_changes() n").get().n, changes);
});

test("null queue cursor skips the batch and preserves confirmed-only pagination", async t => {
  const f = await deltaFixture(201, 0); t.after(() => f.sqlite.close());
  const db = { ...f.db, batch() { throw Error("must not batch when queue is exhausted"); } };
  const result = await (await fdciDelta({ op: "snapshot", after: "", queuedAfter: null }, db, f.owner)).json();
  assert.equal(result.confirmed.length, 200); assert.equal(result.confirmedMore, true); assert.deepEqual(result.queued, []);
});

test("snapshot batch failure changes no candidate, cursor or publication", async t => {
  const f = await deltaFixture(2, 2); t.after(() => f.sqlite.close());
  await fdciDelta({ op: "stage", revision: 0, items: f.data.items }, f.db, f.owner);
  const queue = f.queue(), state = f.state(); f.controls.failBatch = true;
  const result = await fdciDelta({ op: "snapshot", after: "", queuedAfter: "" }, f.db, f.owner);
  assert.equal(result.status, 503); assert.deepEqual(f.queue(), queue); assert.deepEqual(f.state(), state);
});
