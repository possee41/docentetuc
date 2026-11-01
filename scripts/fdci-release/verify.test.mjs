import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const bundle = fileURLToPath(new URL('./import-gate.mjs', import.meta.url));
const env = { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH };
test('disabled CLI rejects before network and runs only one entrypoint', () => {
  const result = spawnSync(process.execPath, [bundle, 'preflight'], { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.trim(), 'GATE_CALL_FAILED GATE_DISABLED');
});
test('CLI preflight reads identity exactly once without opening or importing', () => {
  const loader = `import assert from 'node:assert/strict';let calls=0;globalThis.fetch=async url=>{calls++;assert.equal(new URL(url).pathname,'/api/internal/import-identity');return Response.json({name:'docentetuc-web-canary-1-2',id:'00000000-0000-4000-8000-000000000012'});};process.on('exit',()=>{if(calls!==1)process.exitCode=3});`;
  const result = spawnSync(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(loader), bundle, 'preflight'], {
    encoding: 'utf8', timeout: 10000, env: { ...env,
      IMPORT_GATEWAY_ENABLED: 'true', SYNC_SOURCE: 'fdci', IMPORT_GATEWAY_TARGET: 'canary',
      IMPORT_GATEWAY_ORIGIN: 'http://127.0.0.1', IMPORT_GATEWAY_DATABASE_NAME: 'docentetuc-web-canary-1-2',
      IMPORT_GATEWAY_DATABASE_ID: '00000000-0000-4000-8000-000000000012',
      FDCI_IMPORT_SECRET: 'synthetic_local_only_secret_1234567890123456',
      FDCI_SCOPE: 'active', IMPORT_GATE_RUN_ID: 'local-preflight-only',
      FDCI_MAX_PUBLICATIONS: '2', FDCI_MAX_REQUESTS: '6', FDCI_PAUSE_MS: '400',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, preflight: true });
});
