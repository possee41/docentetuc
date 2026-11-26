import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SnapshotCoordinator, forwardPublic, nextBoundary, TTL } from './coordinator.mjs';

class Storage {
  values = new Map(); alarm = null;
  async get(key) { return structuredClone(this.values.get(key)); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async delete(key) { this.values.delete(key); }
  async transaction(fn) {
    const before = structuredClone(this.values);
    try { return await fn(this); } catch (error) { this.values = before; throw error; }
  }
  async getAlarm() { return this.alarm; }
  async setAlarm(time) { this.alarm = time; }
}
const request = search => new Request('https://public.invalid/api/public-app' + (search || ''));
function fixture() {
  let now = Date.parse('2026-11-26T12:00:00Z');
  const source = { version: 1, builds: 0, checks: 0, body: '{"publications":[]}',
    async revision() { this.checks++; return this.version; },
    async build() { this.builds++; return { body: this.body, boundary: Infinity }; } };
  const storage = new Storage();
  return { source, storage, clock: () => now, advance: n => now += n,
    coordinator: new SnapshotCoordinator(storage, source, () => now) };
}

test('representative production bytes survive preparation, chunk storage and cold object reload', async () => {
  const f = fixture();
  const recorded = new URL('../../../DocenteTuc-juntas-production-reconciled/.wrangler/juntas-publication/public-app-response.json', import.meta.url);
  // Use the existing public capture when available; never commit its records.
  const body = existsSync(recorded) ? readFileSync(recorded) : Buffer.from(JSON.stringify({
    profile: null, publicProfile: null, publications: [{ metadata: 'á'.repeat(970_000) }],
    saved: [], notifications: [], reminders: [], designations: [], manualEvents: [], sync: [],
  }));
  assert.ok(body.length > 1_900_000);
  f.source.body = body;
  const response = await f.coordinator.fetch(request());
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), body);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(f.storage.values.get('manifest').chunks, Math.ceil(body.length / 65536));
  const cold = new SnapshotCoordinator(f.storage, f.source, f.clock);
  assert.deepEqual(Buffer.from(await (await cold.fetch(request())).arrayBuffer()), body);
  assert.equal(f.source.builds, 1);
});
test('hot request performs no D1 checks or JSON preparation; alarm renews unchanged bytes', async () => {
  const f = fixture(); await f.coordinator.fetch(request());
  await f.coordinator.fetch(request());
  assert.equal(f.source.checks, 2); assert.equal(f.source.builds, 1);
  f.advance(TTL); await f.coordinator.alarm();
  assert.equal(f.source.checks, 3); assert.equal(f.source.builds, 1);
});
test('expired copy cannot hide a public mutation, and BYPASS rebuilds even within TTL', async () => {
  const f = fixture(); await f.coordinator.fetch(request());
  f.source.version++; f.source.body = '{"publications":[1]}'; f.advance(TTL);
  assert.equal(await (await f.coordinator.fetch(request())).text(), f.source.body);
  await f.coordinator.fetch(request('?fresh=1'));
  assert.equal(f.source.builds, 3);
});
test('concurrent cold requests prepare once', async () => {
  const f = fixture();
  const responses = await Promise.all(Array.from({ length: 5 }, () => f.coordinator.fetch(request())));
  assert.ok(responses.every(r => r.status === 200)); assert.equal(f.source.builds, 1);
});
test('failed validation cannot publish mixed generations or serve expired data', async () => {
  const f = fixture(); await f.coordinator.fetch(request()); f.advance(TTL);
  f.source.version++;
  f.source.build = async () => { f.source.version++; return { body: 'wrong', boundary: Infinity }; };
  assert.equal((await f.coordinator.fetch(request())).status, 503);
  assert.equal(f.storage.values.get('manifest').revision, 1);
  f.source.revision = async () => { throw new Error('D1_UNAVAILABLE'); };
  assert.equal((await f.coordinator.fetch(request())).status, 503);
});
test('time-dependent ordering requires regeneration even with unchanged revision', async () => {
  const f = fixture();
  f.source.build = async () => { f.source.builds++; return { body: '{}', boundary: f.clock() + TTL }; };
  await f.coordinator.fetch(request()); f.advance(TTL);
  await f.coordinator.fetch(request()); assert.equal(f.source.builds, 2);
});
test('boundary calculation preserves SQLite TEXT comparison rather than inventing ISO timezone semantics', () => {
  const now = Date.parse('2026-11-26T12:00:00Z');
  assert.equal(nextBoundary(['2026-11-26T23:00:00-03:00'], now), Date.parse('2026-11-27T00:00:00Z'));
  assert.equal(nextBoundary(['2026-11-26 13:00:00'], now), Date.parse('2026-11-26T13:00:01Z'));
  assert.equal(nextBoundary(['unknown'], now), now);
});
test('public forwarder never copies session headers or parses response bytes', async () => {
  let forwarded;
  const namespace = { idFromName: n => { assert.equal(n, 'public-app-v1'); return 1; },
    get: () => ({ fetch: async r => { forwarded = r; return new Response('bytes'); } }) };
  const response = await forwardPublic(new Request(request().url, { headers: { Cookie: 'private', Authorization: 'private' } }), namespace);
  assert.equal([...forwarded.headers].length, 0); assert.equal(await response.text(), 'bytes');
  assert.equal((await fixture().coordinator.fetch(new Request('https://public.invalid/api/admin'))).status, 404);
});
test('local SQLite counter invalidates all public/sync writes transactionally, excluding private writes', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE publications(id TEXT PRIMARY KEY, updated_at TEXT); CREATE TABLE sync_state(source TEXT PRIMARY KEY); CREATE TABLE profiles(id TEXT);');
  db.exec(readFileSync(new URL('./revision.sql', import.meta.url), 'utf8'));
  const revision = () => db.prepare('SELECT revision FROM public_snapshot_revision').get().revision;
  db.exec("INSERT INTO publications VALUES('a','same-second'); UPDATE publications SET updated_at='same-second'; DELETE FROM publications; INSERT INTO sync_state VALUES('sime'); UPDATE sync_state SET source='infd'; DELETE FROM sync_state;");
  assert.equal(revision(), 6);
  db.exec("INSERT INTO profiles VALUES('private'); BEGIN; INSERT INTO publications VALUES('rollback','same-second'); ROLLBACK;");
  assert.equal(revision(), 6); db.close();
});
