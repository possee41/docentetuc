import assert from 'node:assert/strict';
import { copyFileSync, existsSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const config = JSON.parse(await (await import('node:fs/promises')).readFile('wrangler.1.2-public-snapshot-canary.jsonc', 'utf8'));
assert.equal(config.name, 'docentetuc-web-juntas-canary-1-2');
assert.equal(config.main, 'dist/server/public-snapshot-canary-entry.mjs');
assert.deepEqual(config.d1_databases, [{ binding: 'DB', database_name: 'docentetuc-sources-canary-1-2',
  database_id: '0979f2c2-0e96-4b5c-811b-adcccc2dbd6d' }]);
assert.deepEqual(config.durable_objects?.bindings, [{ name: 'PUBLIC_SNAPSHOT', class_name: 'PublicSnapshot' }]);
assert.deepEqual(config.migrations, [{ tag: 'public-snapshot-canary-v1', new_sqlite_classes: ['PublicSnapshot'] }]);
assert.deepEqual(config.triggers?.crons, []);
assert.equal(config.vars.PUBLIC_SNAPSHOT_CANARY_ENABLED, 'false');
assert.equal(config.observability?.traces?.enabled, true);
assert.equal(config.routes, undefined);
assert.equal(config.route, undefined);
assert.equal(existsSync('dist/server/worker-entry.mjs'), true, 'Build the integrated Worker first');
const require = createRequire(realpathSync('node_modules/wrangler/package.json'));
await require('esbuild').build({ entryPoints: ['lib/public-snapshot-canary.ts'],
  outfile: 'dist/server/public-snapshot-canary.mjs', bundle: true, format: 'esm',
  platform: 'browser', target: 'es2022', external: ['node:buffer'],
  define: { __PUBLIC_SNAPSHOT_BUILD__: JSON.stringify(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()) } });
copyFileSync('scripts/public-snapshot-canary-entry.mjs', config.main);
console.log('Prepared closed Canary bundle locally; no remote action.');
