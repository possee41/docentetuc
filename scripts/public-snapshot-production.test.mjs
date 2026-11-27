import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SnapshotCoordinator, TTL } from '../lib/public-snapshot-coordinator.mjs';
import { PublicSnapshot, publicSnapshotApi } from '../lib/public-snapshot.ts';

function harness(version = 'code-a') {
  const values = new Map();
  let now = Date.now(), builds = 0, deletes = 0;
  const storage = { get: async key => values.get(key), put: async (key, value) => values.set(key, value),
    delete: async key => values.delete(key), transaction: async fn => fn(storage),
    getAlarm: async () => { throw new Error('UNNECESSARY_ALARM_READ'); },
    setAlarm: async () => { throw new Error('ALARM_FORBIDDEN'); },
    deleteAlarm: async () => deletes++,
  };
  const source = { revision: async () => 1, build: async () => { builds++; return { body: '{"publications":[]}', boundary: Infinity }; } };
  const create = v => new SnapshotCoordinator(storage, source, () => now, { alarms: false, version: v });
  return { create, storage, source, core: create(version), advance: () => now += TTL,
    builds: () => builds, deletedAlarms: () => deletes };
}
const request = () => new Request('https://local.invalid/api/public-app');

test('production TTL refresh and cold reload never read or create an alarm', async () => {
  const h = harness();
  assert.equal((await h.core.fetch(request())).status, 200);
  assert.equal((await h.core.fetch(request())).status, 200);
  h.advance();
  assert.equal((await h.core.fetch(request())).status, 200);
  assert.equal(h.builds(), 1);
  assert.equal((await h.create('code-a').fetch(request())).status, 200);
  await h.core.alarm();
  assert.equal(h.deletedAlarms(), 1);
  assert.equal(h.builds(), 1);
});
test('new code/cache version invalidates persistent bytes even inside TTL', async () => {
  const h = harness(); await h.core.fetch(request());
  h.source.build = async () => ({ body: '{"publications":["new-code"]}', boundary: Infinity });
  const response = await h.create('code-b').fetch(request());
  assert.equal(await response.text(), '{"publications":["new-code"]}');
  assert.equal((await h.storage.get('manifest')).version, 'code-b');
});
test('only explicitly enabled public GET uses the object; private routes and other methods retain handlers', () => {
  for (const path of ['/api/app', '/api/auth/status', '/api/admin', '/api/boards', '/']) {
    assert.equal(publicSnapshotApi(new Request('https://local.invalid' + path), { PUBLIC_SNAPSHOT_ENABLED: 'true' }), null);
  }
  assert.equal(publicSnapshotApi(request(), { PUBLIC_SNAPSHOT_ENABLED: 'false' }), null);
  assert.equal(publicSnapshotApi(request(), {}), null);
  assert.equal(publicSnapshotApi(new Request(request().url, { method: 'POST' }), { PUBLIC_SNAPSHOT_ENABLED: 'true' }), null);
});
test('disabled cache forces BYPASS and never forwards private headers or a client-selected object', async () => {
  let forwarded;
  const namespace = { idFromName: name => { assert.equal(name, 'public-app-v1'); return 'fixed'; },
    get: id => { assert.equal(id, 'fixed'); return { fetch: async r => { forwarded = r; return new Response('ok'); } }; } };
  const r = new Request(request().url, { headers: { Cookie: 'synthetic-private', Authorization: 'synthetic-private', 'X-Object-ID': 'other' } });
  assert.equal((await publicSnapshotApi(r, { PUBLIC_SNAPSHOT_ENABLED: 'true', PUBLIC_APP_CACHE_ENABLED: 'false', PUBLIC_SNAPSHOT: namespace })).status, 200);
  assert.ok(new URL(forwarded.url).search);
  assert.equal([...forwarded.headers].length, 0);
});
test('missing/unavailable namespace fails closed without an HTTP D1 fallback', async () => {
  assert.equal((await publicSnapshotApi(request(), { PUBLIC_SNAPSHOT_ENABLED: 'true' })).status, 503);
  const namespace = { idFromName: () => 1, get: () => ({ fetch: async () => { throw Error('UNAVAILABLE'); } }) };
  assert.equal((await publicSnapshotApi(request(), { PUBLIC_SNAPSHOT_ENABLED: 'true', PUBLIC_SNAPSHOT: namespace })).status, 503);
});
test('actual production class disables alarms and rejects mutations without accessing D1', async () => {
  const h = harness();
  const worker = new PublicSnapshot({ storage: h.storage }, { DB: { prepare: () => { throw Error('NO_D1'); } }, PUBLIC_APP_CACHE_VERSION: 'approved-code' });
  assert.equal(worker.coordinator.alarms, false);
  assert.equal(worker.coordinator.version, 'local-unbundled:approved-code');
  assert.equal((await worker.fetch(new Request(request().url, { method: 'POST' }))).status, 404);
  await worker.alarm(); assert.equal(h.deletedAlarms(), 1);
});
test('production D1 counter matches the validated additive prototype, with no 0100 execution', () => {
  const normalize = path => readFileSync(path, 'utf8').split('\n').filter(line => !line.startsWith('--')).join('\n').trim();
  assert.equal(normalize('migrations/0101_public_snapshot_revision.sql'), normalize('prototypes/public-snapshot/revision.sql'));
});
