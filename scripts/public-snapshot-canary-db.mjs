import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const CANARY_DATABASE = Object.freeze({
  worker: 'docentetuc-web-juntas-canary-1-2',
  name: 'docentetuc-sources-canary-1-2',
  id: '0979f2c2-0e96-4b5c-811b-adcccc2dbd6d',
});

export function validateCanaryTarget(config, internalIdentity) {
  assert.equal(config.name, CANARY_DATABASE.worker, 'Unexpected Worker');
  assert.deepEqual(config.d1_databases, [{ binding: 'DB', database_name: CANARY_DATABASE.name, database_id: CANARY_DATABASE.id }]);
  assert.equal(config.vars?.JUNTAS_CANARY_DATABASE_ID, CANARY_DATABASE.id);
  assert.deepEqual(internalIdentity, { database_name: CANARY_DATABASE.name, database_id: CANARY_DATABASE.id });
}

export async function runCanarySql({ config, internalIdentity, phase, execute }) {
  validateCanaryTarget(config, internalIdentity);
  assert.equal(typeof execute, 'function');
  const file = phase === 'migrations' ? null : phase === 'fixture'
    ? 'scripts/public-snapshot-canary-fixture.sql' : phase === 'restore'
      ? 'scripts/public-snapshot-canary-restore.sql' : undefined;
  assert.notEqual(file, undefined, 'Unknown Canary SQL phase');
  const statements = phase === 'migrations'
    ? ['migrations/0032_fdci_import_checkpoint.sql', 'migrations/0101_public_snapshot_revision.sql']
      .flatMap(path => splitSql(readFileSync(path, 'utf8')))
    : splitSql(readFileSync(file, 'utf8'));
  const completed = [];
  const manifest = [];
  for (const statement of statements) {
    try { await execute(statement, CANARY_DATABASE.id); }
    catch (cause) {
      const error = new Error(`Canary SQL outcome ambiguous after ${completed.length} confirmed statements; inspect D1 before continuing.`);
      error.cause = cause;
      error.completed = [...completed];
      throw error;
    }
    completed.push(statement);
    manifest.push({ phase, sequence: completed.length, sql: statement });
  }
  return { statements: completed.length, manifest };
}

// These controlled SQL files contain no trigger bodies; migration SQL is split
// only at semicolons outside quoted strings. Execution is sequential and stops
// at the first rejected statement. Earlier D1 statements are not claimed atomic.
export function splitSql(sql) {
  const statements = []; let part = '', quote = null, lineComment = false, blockComment = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i], next = sql[i + 1];
    if (lineComment) { if (c === '\n') { lineComment = false; part += '\n'; } continue; }
    if (blockComment) { if (c === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (!quote && c === '-' && next === '-') { lineComment = true; i++; continue; }
    if (!quote && c === '/' && next === '*') { blockComment = true; i++; continue; }
    part += c;
    if (quote) { if (c === quote && next === quote) { part += next; i++; } else if (c === quote) quote = null; }
    else if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === ';') { if (part.slice(0, -1).trim()) statements.push(part.slice(0, -1).trim()); part = ''; }
  }
  if (part.trim()) statements.push(part.trim());
  return statements;
}
