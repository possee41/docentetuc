import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { canaryFetch, PublicSnapshot } from '../lib/public-snapshot-canary.ts';

const databaseId = '0979f2c2-0e96-4b5c-811b-adcccc2dbd6d';
const secret = 'synthetic-canary-secret';
const request = (path = '/api/public-app', method = 'GET', token = secret) =>
  new Request('https://canary.invalid' + path, { method, headers: { 'X-DT-Canary-Secret': token } });

test('fixture, integrated cold/prepared response, isolated close and exact restoration', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(readFileSync('lib/fixtures/juntas-production-schema-20261121.sql', 'utf8'));
    sqlite.prepare('INSERT INTO import_gateway_identity VALUES (1, ?, ?)').run('docentetuc-sources-canary-1-2', databaseId);
    sqlite.exec(`WITH RECURSIVE existing(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM existing WHERE n<248)
      INSERT INTO publications(id,source,external_id,kind,category,title,official_url,content_hash)
      SELECT 'existing:'||n,'Padrones y Comunicados','existing:'||n,'junta','Canary histórico',
        'Publicación existente '||n,'https://example.invalid/existing/'||n,'existing:'||n FROM existing`);
    sqlite.exec(readFileSync('migrations/0032_fdci_import_checkpoint.sql', 'utf8'));
    sqlite.exec(readFileSync('migrations/0101_public_snapshot_revision.sql', 'utf8'));
    sqlite.exec(readFileSync('scripts/public-snapshot-canary-fixture.sql', 'utf8'));
    assert.equal(sqlite.prepare('SELECT count(*) n FROM publications').get().n, 400);
    assert.equal(sqlite.prepare('SELECT revision FROM public_snapshot_revision').get().revision, 152);
    let queries = 0;
    const db = { prepare(sql) {
      queries++;
      const statement = sqlite.prepare(sql);
      return { first: async () => statement.get() || null,
        all: async () => ({ results: statement.all() }),
        raw: async () => statement.all().map(Object.values) };
    } };
    const values = new Map();
    let deleted = false;
    const storage = { get: async key => values.get(key), put: async (key, value) => values.set(key, value),
      delete: async key => values.delete(key), transaction: async fn => fn(storage),
      deleteAlarm: async () => {}, deleteAll: async () => { deleted = true; values.clear(); } };
    const env = { DB: db, PUBLIC_SNAPSHOT_CANARY_SECRET: secret, JUNTAS_CANARY_DATABASE_ID: databaseId,
      PUBLIC_SNAPSHOT_ENABLED: 'true', PUBLIC_SNAPSHOT_CANARY_ENABLED: 'true',
      PUBLIC_SNAPSHOT_CANARY_MAX_GETS: '2',
      PUBLIC_SNAPSHOT_CANARY_UNTIL: new Date(Date.now() + 60_000).toISOString() };
    const object = new PublicSnapshot({ storage }, env);
    const cold = await object.fetch(request());
    assert.equal(cold.status, 200);
    assert.equal(queries, 6);
    const body = await cold.json();
    assert.equal(body.publications.length, 400);
    assert.equal(body.publications.filter(row => row.normalized_status === 'UPCOMING').length, 76);
    assert.equal(body.publications.filter(row => row.normalized_status === 'ACTIVE').length, 76);
    assert.equal(body.publications.filter(row => row.source === 'Capacitación Docente').length, 152);
    assert.equal((await object.fetch(request())).status, 200);
    assert.equal(queries, 6);
    assert.equal((await object.fetch(request('/__fdci_public_snapshot_canary_close', 'POST', 'wrong'))).status, 403);
    assert.equal(deleted, false);
    const wrongIdentity = { ...env, DB: { prepare: () => ({ first: async () =>
      ({ database_name: 'docentetuc-db', database_id: 'production' }) }) } };
    assert.equal((await new PublicSnapshot({ storage }, wrongIdentity)
      .fetch(request('/__fdci_public_snapshot_canary_close', 'POST'))).status, 403);
    assert.equal(deleted, false);
    assert.equal((await object.fetch(request('/__fdci_public_snapshot_canary_close', 'POST'))).status, 202);
    env.PUBLIC_SNAPSHOT_CANARY_UNTIL = new Date(Date.now() - 1).toISOString();
    assert.equal((await object.fetch(request('/__fdci_public_snapshot_canary_close', 'POST'))).status, 200);
    assert.equal(deleted, true);
    assert.equal(values.size, 0);
    const forwarded = async () => new Response('integrated');
    assert.equal((await canaryFetch(request(), env, forwarded)).status, 404);
    assert.equal((await canaryFetch(request('/api/public-app?fresh=1'), env, forwarded)).status, 404);
    assert.equal((await canaryFetch(request('/api/public-app', 'GET', 'wrong'), env, forwarded)).status, 404);
    assert.equal((await canaryFetch(request(), { ...env, PUBLIC_SNAPSHOT_CANARY_ENABLED: 'false' }, forwarded)).status, 404);
    assert.equal((await canaryFetch(request(), { ...env, PUBLIC_SNAPSHOT_CANARY_UNTIL: new Date(Date.now() - 1).toISOString() }, forwarded)).status, 404);
    assert.equal((await canaryFetch(request('/__fdci_public_snapshot_canary_close', 'POST', 'wrong'), env, forwarded)).status, 403);
    let selectedName;
    const closeEnv = { ...env, PUBLIC_SNAPSHOT_CANARY_UNTIL: new Date(Date.now() - 1).toISOString(),
      PUBLIC_SNAPSHOT: { idFromName: name => { selectedName = name; return 'authorized-object'; },
        get: id => { assert.equal(id, 'authorized-object'); return { fetch: next => object.fetch(next) }; } } };
    assert.equal((await canaryFetch(request('/__fdci_public_snapshot_canary_close', 'POST'), closeEnv, forwarded)).status, 200);
    assert.equal(selectedName, 'public-app-v1');
    assert.equal((await canaryFetch(request('/__fdci_public_snapshot_canary_close', 'POST'), wrongIdentity, forwarded)).status, 403);
    sqlite.exec(readFileSync('scripts/public-snapshot-canary-restore.sql', 'utf8'));
    assert.equal(sqlite.prepare('SELECT count(*) n FROM publications').get().n, 248);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM sqlite_master WHERE name IN ('public_snapshot_revision','fdci_import_checkpoint')").get().n, 0);
  } finally { sqlite.close(); }
});

test('fixture cannot insert into a database with production identity', () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(readFileSync('lib/fixtures/juntas-production-schema-20261121.sql', 'utf8'));
    sqlite.prepare('INSERT INTO import_gateway_identity VALUES (1, ?, ?)').run('docentetuc-db', 'production');
    sqlite.exec(readFileSync('scripts/public-snapshot-canary-fixture.sql', 'utf8'));
    assert.equal(sqlite.prepare('SELECT count(*) n FROM publications').get().n, 0);
  } finally { sqlite.close(); }
});
