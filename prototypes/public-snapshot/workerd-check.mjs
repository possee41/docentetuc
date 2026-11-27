// Local runtime check; no remote URLs, bindings or credentials.
import { createRequire } from 'node:module';
import { realpathSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const dependencyRoot = process.env.SNAPSHOT_DEPENDENCIES || '../DocenteTuc-juntas-public-miss';
const require = createRequire(realpathSync(resolve(dependencyRoot, 'node_modules/wrangler/package.json')));
const { Miniflare } = require('miniflare');
const { build } = require('esbuild');
const dir = resolve('.wrangler/public-snapshot-prototype');
mkdirSync(dir, { recursive: true });
await build({ entryPoints: [resolve('prototypes/public-snapshot/worker.ts')],
  outfile: resolve(dir, 'adapter.mjs'), bundle: true, format: 'esm', platform: 'browser', external: ['node:buffer'] });
writeFileSync(resolve(dir, 'entry.mjs'), `
import { SnapshotCoordinator, forwardPublic } from '../../prototypes/public-snapshot/coordinator.mjs';
export class PublicSnapshot {
 constructor(state) {
  this.core = new SnapshotCoordinator(state.storage, {
   revision: async () => 1,
   build: async () => ({body: JSON.stringify({publications:[{metadata:'á'.repeat(970000)}]}), boundary:Infinity}),
  });
 }
 fetch(request) { return this.core.fetch(request); }
 alarm() { return this.core.alarm(); }
}
export default {fetch(request, env) {return forwardPublic(request, env.SNAPSHOT);}};
`);
await build({ entryPoints: [resolve(dir, 'entry.mjs')], outfile: resolve(dir, 'worker.mjs'), bundle: true, format: 'esm', platform: 'browser' });
const options = { modules: true, scriptPath: resolve(dir, 'worker.mjs'), compatibilityDate: '2026-05-01',
  durableObjects: { SNAPSHOT: { className: 'PublicSnapshot', useSQLite: true } },
  durableObjectsPersist: resolve(dir, 'storage'), outboundService: () => { throw new Error('NETWORK_FORBIDDEN'); } };
let mf;
try {
  mf = new Miniflare(options);
  const cold = await mf.dispatchFetch('https://local.invalid/api/public-app');
  assert.equal(cold.status, 200);
  const bytes = new Uint8Array(await cold.arrayBuffer());
  assert.ok(bytes.length > 1_900_000);
  const hot = await mf.dispatchFetch('https://local.invalid/api/public-app');
  assert.deepEqual(new Uint8Array(await hot.arrayBuffer()), bytes);
  await mf.dispose();
  mf = new Miniflare(options);
  const restart = await mf.dispatchFetch('https://local.invalid/api/public-app');
  assert.deepEqual(new Uint8Array(await restart.arrayBuffer()), bytes);
  console.log(JSON.stringify({ runtime: 'local workerd + SQLite Durable Object', bytes: bytes.length,
    cold: cold.status, hot: hot.status, restart: restart.status, remoteRequests: 0, nativeCloudflareCPU: 'NOT_MEASURED' }));
} finally { await mf?.dispose(); }
