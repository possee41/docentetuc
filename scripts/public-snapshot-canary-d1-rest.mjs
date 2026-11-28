import assert from 'node:assert/strict';
import { canarySqlForPhase, CANARY_DATABASE } from './public-snapshot-canary-db.mjs';

const ACCOUNT_ID = '6bbc3dae7e111660f0c835677ceffb69';
const DATABASE_ID = '0979f2c2-0e96-4b5c-811b-adcccc2dbd6d';
const ENDPOINT = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`;
const READS = new Set([
  'SELECT database_name,database_id FROM import_gateway_identity WHERE id=1',
  "SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
  'SELECT * FROM publications ORDER BY id',
  "SELECT count(*) AS count FROM publications WHERE id LIKE 'fdci:canary:snapshot:20261127:%'",
]);

export function createCanaryD1RestAdapter({ token, phase, fetchImpl = globalThis.fetch }) {
  assert.equal(CANARY_DATABASE.id, DATABASE_ID);
  assert.equal(typeof token, 'string');
  assert.ok(token.length > 0 && !/[\r\n]/.test(token), 'A valid Cloudflare API token is required');
  assert.equal(typeof fetchImpl, 'function', 'Fetch transport is required');
  const allowed = new Set(canarySqlForPhase(phase).map(sql => sql.trim()));
  const reads = new Set([...allowed].filter(sql => READS.has(sql)));
  const writes = new Set([...allowed].filter(sql => !READS.has(sql)));
  const firstReads = new Set([...reads].filter(sql => sql.startsWith('SELECT database_name,') || sql.startsWith('SELECT count(')));
  const allReads = new Set([...reads].filter(sql => !firstReads.has(sql)));

  async function execute(sql) {
    let response;
    try {
      response = await fetchImpl(ENDPOINT, {
        method: 'POST', redirect: 'manual',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ sql, params: [] }),
      });
    } catch {
      throw new Error('Cloudflare D1 transport failed; outcome may be ambiguous. Inspect before continuing.');
    }
    if (!response || !Number.isInteger(response.status) || response.status !== 200 || response.redirected ||
        (response.url && response.url !== ENDPOINT)) {
      throw new Error(`Cloudflare D1 returned an unexpected HTTP response (${response.status}).`);
    }
    let envelope;
    try { envelope = await response.json(); }
    catch { throw new Error('Cloudflare D1 returned invalid JSON; outcome may be ambiguous. Inspect before continuing.'); }
    if (envelope?.success !== true || !Array.isArray(envelope.errors) || envelope.errors.length !== 0 ||
        !Array.isArray(envelope.result) || envelope.result.length !== 1) {
      throw new Error('Cloudflare D1 response envelope is unsuccessful or ambiguous; inspect before continuing.');
    }
    const result = envelope.result[0];
    if (result?.success !== true || !Array.isArray(result.results) ||
        !result.meta || typeof result.meta !== 'object' || Array.isArray(result.meta)) {
      throw new Error('Cloudflare D1 statement response is unsuccessful or malformed; inspect before continuing.');
    }
    return result;
  }

  return Object.freeze({
    prepare(sql) {
      assert.equal(typeof sql, 'string');
      const statement = sql.trim();
      assert.ok(allowed.has(statement), 'SQL is not authorized for this fixed Canary phase');
      return Object.freeze({
        first: async (...args) => {
          assert.equal(args.length, 0, 'Parameters are not accepted by the Canary adapter');
          assert.ok(firstReads.has(statement), 'first() is not authorized for this Canary query');
          return (await execute(statement)).results[0] ?? null;
        },
        all: async (...args) => {
          assert.equal(args.length, 0, 'Parameters are not accepted by the Canary adapter');
          assert.ok(allReads.has(statement), 'all() is not authorized for this Canary query');
          return execute(statement);
        },
        run: async (...args) => {
          assert.equal(args.length, 0, 'Parameters are not accepted by the Canary adapter');
          assert.ok(writes.has(statement), 'run() is not authorized for this Canary phase');
          return execute(statement);
        },
      });
    },
  });
}
