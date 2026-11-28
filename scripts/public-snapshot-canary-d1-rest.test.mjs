import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createCanaryD1RestAdapter } from './public-snapshot-canary-d1-rest.mjs';
import { CANARY_DATABASE, canarySqlForPhase, runCanarySql } from './public-snapshot-canary-db.mjs';

const token = 'synthetic-token-must-not-leak';
const meta = { rows_read: 1, rows_written: 0, duration: 0.2, served_by: 'miniflare' };
const response = (result, status = 200) => new Response(JSON.stringify({ success: true, errors: [], result: [{ success: true, results: result, meta }] }), { status });

test('fixed endpoint, authorized reads, and raw D1 result metadata are preserved', async () => {
  const calls = [];
  const adapter = createCanaryD1RestAdapter({ token, phase: 'baseline', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return response([{ database_name: CANARY_DATABASE.name, database_id: CANARY_DATABASE.id }]);
  } });
  const identity = await adapter.prepare(canarySqlForPhase('baseline')[0]).first();
  assert.equal(identity.database_id, CANARY_DATABASE.id);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.cloudflare.com/client/v4/accounts/6bbc3dae7e111660f0c835677ceffb69/d1/database/0979f2c2-0e96-4b5c-811b-adcccc2dbd6d/query');
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(calls[0].options.headers.authorization, `Bearer ${token}`);
  assert.deepEqual(JSON.parse(calls[0].options.body), { sql: canarySqlForPhase('baseline')[0], params: [] });

  const allAdapter = createCanaryD1RestAdapter({ token, phase: 'baseline', fetchImpl: async () => response([]) });
  const all = await allAdapter.prepare(canarySqlForPhase('baseline')[1]).all();
  assert.deepEqual(all.meta, meta);
  assert.deepEqual(all.results, []);
});

test('phase whitelist rejects arbitrary SQL and disallowed adapter methods before transport', async () => {
  let calls = 0;
  const adapter = createCanaryD1RestAdapter({ token, phase: 'migrations', fetchImpl: async () => { calls++; return response([]); } });
  assert.throws(() => adapter.prepare('DROP TABLE publications'), /not authorized/);
  await assert.rejects(adapter.prepare(canarySqlForPhase('migrations')[0]).run(), /run\(\) is not authorized/);
  assert.throws(() => createCanaryD1RestAdapter({ token, phase: 'anything' }), /Unsupported/);
  assert.equal(calls, 0);
});

test('runCanarySql drives only the fixed REST phase without rewriting D1 results', async () => {
  const calls = [];
  const adapter = createCanaryD1RestAdapter({ token, phase: 'migrations', fetchImpl: async (_url, options) => {
    const sql = JSON.parse(options.body).sql;
    calls.push(sql);
    const rows = sql.startsWith('SELECT database_name,')
      ? [{ database_name: CANARY_DATABASE.name, database_id: CANARY_DATABASE.id }] : [];
    return response(rows);
  } });
  const emptyHash = createHash('sha256').update('[]').digest('hex');
  const baseline = { databaseName: CANARY_DATABASE.name, databaseId: CANARY_DATABASE.id,
    objectHash: emptyHash, objects: [], publicationCount: 0, publicationHash: emptyHash, migrationObjects: [] };
  const result = await runCanarySql({
    config: { name: CANARY_DATABASE.worker, d1_databases: [{ binding: 'DB', database_name: CANARY_DATABASE.name, database_id: CANARY_DATABASE.id }],
      vars: { JUNTAS_CANARY_DATABASE_ID: CANARY_DATABASE.id } },
    database: adapter, phase: 'migrations', baseline,
  });
  assert.equal(result.statements, 10);
  assert.equal(calls.length, 23);
  assert.equal(calls.filter(sql => sql.startsWith('CREATE') || sql.startsWith('INSERT')).length, 10);
});

test('redirects, malformed envelopes, and unsuccessful statements stop without retries or token leakage', async () => {
  let calls = 0;
  const sql = canarySqlForPhase('migrations').find(statement => /^CREATE TABLE/.test(statement));
  const adapter = createCanaryD1RestAdapter({ token, phase: 'migrations', fetchImpl: async (_url, options) => {
    calls++;
    assert.equal(options.redirect, 'manual');
    return new Response('redirect', { status: 307, headers: { location: 'https://attacker.invalid' } });
  } });
  await assert.rejects(adapter.prepare(sql).run(), error => !error.message.includes(token) && /unexpected HTTP response/.test(error.message));
  assert.equal(calls, 1);
  const unexpectedStatus = createCanaryD1RestAdapter({ token, phase: 'migrations', fetchImpl: async () => response([], 201) });
  await assert.rejects(unexpectedStatus.prepare(sql).run(), /unexpected HTTP response/);

  for (const body of [
    { success: false, errors: [], result: [] },
    { success: true, errors: [], result: [{ success: false, results: [], meta }] },
    { success: true, errors: [], result: [{ success: true, meta }] },
  ]) {
    const malformed = createCanaryD1RestAdapter({ token, phase: 'migrations', fetchImpl: async () => new Response(JSON.stringify(body)) });
    await assert.rejects(malformed.prepare(sql).run());
  }
});

test('transport failures are surfaced as ambiguous and never retried', async () => {
  let calls = 0;
  const sql = canarySqlForPhase('restore').find(statement => statement.startsWith('DROP TRIGGER'));
  const adapter = createCanaryD1RestAdapter({ token, phase: 'restore', fetchImpl: async () => { calls++; throw new Error(token); } });
  await assert.rejects(adapter.prepare(sql).run(), error => !error.message.includes(token) && /ambiguous/.test(error.message));
  assert.equal(calls, 1);
});
