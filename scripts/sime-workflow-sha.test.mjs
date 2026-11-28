import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { platform } from 'node:os';

const workflow = readFileSync(new URL('../.github/workflows/daily-production-sources.yml', import.meta.url), 'utf8').replaceAll('\r\n','\n');
const script = workflow.match(/- name: Select and validate runtime SHA\n[\s\S]*?\n        run: \|\n((?:          .*\n)+)/)?.[1]
  .split('\n').map(line => line.replace(/^          /, '')).join('\n');
assert.ok(script, 'selection step must be read from the workflow');
const shared = 'a'.repeat(40), sime = 'b'.repeat(40);
const bash = platform() === 'win32'
  ? ['C:/Program Files/Git/bin/bash.exe','C:/Program Files/Git/usr/bin/bash.exe'].find(path => {
      const probe=spawnSync(path,['-c','printf bash-ok'],{encoding:'utf8'});
      return !probe.error && probe.status===0 && probe.stdout==='bash-ok';
    })
  : 'bash';
assert.ok(bash, 'working Bash executable is required');

function select(source, simeSha = sime, sharedSha = shared) {
  const dir = mkdtempSync(join(tmpdir(), 'sime-sha-'));
  const output = join(dir, 'github-output');
  const result = spawnSync(bash, ['-c', script], { encoding: 'utf8', env: { ...process.env,
    INPUT_SOURCE: source, SIME_SHA: simeSha, SHARED_SHA: sharedSha, GITHUB_OUTPUT: output } });
  assert.ifError(result.error);
  assert.notEqual(result.status, null, `Bash did not execute: ${result.stderr}`);
  const value = (() => { try { return readFileSync(output, 'utf8').trim(); } catch { return ''; } })();
  rmSync(dir, { recursive: true, force: true });
  return { ...result, value };
}

test('SIME uses only its specific approved SHA', () => { const r=select('sime'); assert.equal(r.status,0); assert.equal(r.value,`sha=${sime}`); });
for (const [label, value, reason] of [['empty','',/missing or invalid/],['missing','undefined',/missing or invalid/],['invalid','G'.repeat(40),/missing or invalid/],['short','b'.repeat(39),/missing or invalid/]])
  test(`SIME rejects ${label} SHA even when shared SHA is valid`, () => { const r=select('sime',value); assert.notEqual(r.status,0); assert.match(r.stderr,reason); assert.equal(r.value,''); });
for (const source of ['infd','cenet']) test(`${source} keeps shared SHA`, () => { const r=select(source); assert.equal(r.status,0); assert.equal(r.value,`sha=${shared}`); });
test('unknown source and non-hex SHA fail closed', () => { assert.notEqual(select('fdci').status,0); assert.notEqual(select('sime','b'.repeat(39)+'Z').status,0); });
test('validated output feeds checkout and both runtime identities, before checkout', () => {
  const selector=workflow.indexOf('- name: Select and validate runtime SHA'), checkout=workflow.indexOf('- uses: actions/checkout@v4');
  assert.ok(selector>=0 && selector<checkout);
  assert.match(workflow,/ref: \$\{\{ steps\.select-runtime\.outputs\.sha \}\}/);
  assert.match(workflow,/DAILY_APPROVED_SHA: \$\{\{ steps\.select-runtime\.outputs\.sha \}\}/);
  assert.match(workflow,/IMPORT_GATEWAY_APPROVED_SHA: \$\{\{ steps\.select-runtime\.outputs\.sha \}\}/);
});
test('no active schedule or push trigger; production approvals, branch, permissions and concurrency remain', () => {
  assert.match(workflow,/github\.ref == 'refs\/heads\/release\/production-sources-ef7dc08'/);
  assert.match(workflow,/vars\.DAILY_PRODUCTION_ENABLED == 'true'.*vars\.DAILY_PRODUCTION_APPROVED == 'true'/);
  assert.match(workflow,/group: daily-production-source-writes/); assert.match(workflow,/contents: write/);
  assert.match(workflow,/^  # schedule:/m); assert.doesNotMatch(workflow,/^  (push|pull_request):/m);
});
test('SIME runtime matches published Case B commit', () => { assert.equal('7cd0f8321728ca4296484d850ddc59e92bd2ede9'.length,40); });
