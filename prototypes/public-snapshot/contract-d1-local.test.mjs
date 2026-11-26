import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { getPublicApp } from '../../lib/public-app.ts';
import { SnapshotCoordinator, TTL } from './coordinator.mjs';

const schemaPath = new URL('../../.wrangler/snapshot-canary/schema-before.json', import.meta.url);
const capturePath = new URL('../../../DocenteTuc-juntas-production-reconciled/.wrangler/juntas-publication/public-app-response.json', import.meta.url);
test('real SQL plus local SQLite triggers reflect a new fixture after TTL without changing remote documents',
  { skip: !existsSync(schemaPath) || !existsSync(capturePath) }, async () => {
    const db = new DatabaseSync(':memory:');
    try {
      const schema = JSON.parse(readFileSync(schemaPath))[0].results;
      const capture = JSON.parse(readFileSync(capturePath));
      for (const name of ['publications', 'sync_state']) {
        db.exec(schema.find(row => row.type === 'table' && row.name === name).sql);
      }
      const insert = (table, row) => {
        const keys = Object.keys(row);
        assert.ok(keys.every(key => /^[a-z_]+$/.test(key)));
        db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...Object.values(row));
      };
      for (const row of capture.publications) insert('publications', row);
      for (const row of capture.sync) insert('sync_state', row);
      db.exec(readFileSync(new URL('./revision.sql', import.meta.url), 'utf8'));
      const d1 = { prepare(sql) {
        const prepared = db.prepare(sql);
        const wrap = params => ({ bind: (...values) => wrap(values),
          raw: async () => prepared.all(...params).map(Object.values),
          all: async () => ({ results: prepared.all(...params) }),
        });
        return wrap([]);
      } };
      let now = Date.now();
      let builds = 0;
      const values = new Map();
      let alarm = null;
      const storage = { get: async key => values.get(key), put: async (key, value) => values.set(key, value),
        delete: async key => values.delete(key), transaction: async fn => fn(storage),
        getAlarm: async () => alarm, setAlarm: async value => alarm = value };
      const source = {
        revision: async () => db.prepare('SELECT revision FROM public_snapshot_revision').get().revision,
        build: async () => {
          builds++;
          const response = await getPublicApp(new Request('https://local.invalid/api/public-app?fresh=1'), () => d1);
          assert.equal(response.status, 200);
          return { body: await response.arrayBuffer(), boundary: Infinity };
        },
      };
      const coordinator = new SnapshotCoordinator(storage, source, () => now);
      const request = () => new Request('https://local.invalid/api/public-app');
      const before = await (await coordinator.fetch(request())).text();
      const fixture = { ...capture.publications.find(row => row.kind === 'vacante'),
        id: 'local-fixture:new-publication', external_id: 'local-fixture:new-publication',
        updated_at: '2099-01-01 00:00:00', starts_at: '2099-01-01 00:00:00', ends_at: '2099-12-31 00:00:00' };
      insert('publications', fixture);
      assert.equal(await source.revision(), 1);
      assert.equal(await (await coordinator.fetch(request())).text(), before);
      now += TTL;
      const after = await (await coordinator.fetch(request())).text();
      assert.ok(JSON.parse(after).publications.some(row => row.id === fixture.id));
      const actual = await getPublicApp(new Request('https://local.invalid/api/public-app?fresh=1'), () => d1);
      assert.equal(after, await actual.text());
      assert.equal(builds, 2);
    } finally { db.close(); }
  });
