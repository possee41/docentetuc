import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { runCanarySql, validateCanaryTarget } from './public-snapshot-canary-db.mjs';

const config = JSON.parse(readFileSync('wrangler.1.2-public-snapshot-canary.jsonc', 'utf8'));
const identity = { database_name: 'docentetuc-sources-canary-1-2', database_id: '0979f2c2-0e96-4b5c-811b-adcccc2dbd6d' };
const fixture = (name = identity.database_name, id = identity.database_id) => ({ database_name: name, database_id: id });

test('only fixed Worker, D1 UUID and matching internal identity pass', () => {
  validateCanaryTarget(config, identity);
  for (const [badConfig, badIdentity] of [
    [{ ...config, d1_databases: [{ ...config.d1_databases[0], database_id: 'production' }] }, identity],
    [{ ...config, vars: { ...config.vars, JUNTAS_CANARY_DATABASE_ID: '' } }, identity],
    [config, fixture('docentetuc-db', 'production')], [config, undefined],
    [{ ...config, name: 'docentetuc' }, identity],
  ]) assert.throws(() => validateCanaryTarget(badConfig, badIdentity));
});

test('migration, fixture and restore fail closed before execution on identity mismatch', async () => {
  for (const phase of ['migrations', 'fixture', 'restore']) {
    let writes = 0;
    await assert.rejects(runCanarySql({ config, internalIdentity: fixture('docentetuc-db', 'production'), phase,
      execute: async () => writes++ }));
    assert.equal(writes, 0);
  }
});

test('partial migration failure stops immediately; successful restoration preserves old rows/triggers', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(readFileSync('lib/fixtures/juntas-production-schema-20261121.sql', 'utf8'));
    db.prepare('INSERT INTO import_gateway_identity VALUES (1, ?, ?)').run(identity.database_name, identity.database_id);
    db.exec("INSERT INTO publications(id,source,external_id,kind,category,title,official_url,content_hash) VALUES ('historic','Padrones y Comunicados','h','junta','h','h','https://example.invalid','h')");
    const before = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name='publications' ORDER BY name").all();
    let attempted = 0;
    await assert.rejects(runCanarySql({ config, internalIdentity: identity, phase: 'migrations', execute: async sql => {
      attempted++; if (attempted === 2) throw Error('synthetic migration fault'); db.exec(sql);
    } }));
    assert.equal(attempted, 2);
    assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='fdci_import_checkpoint'").get().n, 1);
    db.exec(readFileSync('migrations/0101_public_snapshot_revision.sql', 'utf8'));
    db.exec(readFileSync('scripts/public-snapshot-canary-fixture.sql', 'utf8'));
    assert.equal(db.prepare('SELECT count(*) n FROM publications').get().n, 153);
    db.exec(readFileSync('scripts/public-snapshot-canary-restore.sql', 'utf8'));
    assert.equal(db.prepare('SELECT count(*) n FROM publications').get().n, 1);
    assert.deepEqual(db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name='publications' ORDER BY name").all(), before);
    assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name IN ('fdci_import_checkpoint','public_snapshot_revision')").get().n, 0);
  } finally { db.close(); }
});
