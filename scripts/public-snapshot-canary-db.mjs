import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const CANARY_DATABASE = Object.freeze({
  worker: 'docentetuc-web-juntas-canary-1-2',
  name: 'docentetuc-sources-canary-1-2',
  id: '0979f2c2-0e96-4b5c-811b-adcccc2dbd6d',
});
const FIXTURE_PREFIX = 'fdci:canary:snapshot:20261127:';
const FIXTURE_HASH = 'fdci-public-snapshot-canary-20261127';
const RESTORE = [
  `DELETE FROM publications WHERE id LIKE '${FIXTURE_PREFIX}%' AND source='Capacitación Docente' AND content_hash='${FIXTURE_HASH}' AND EXISTS (SELECT 1 FROM import_gateway_identity WHERE id=1 AND database_name='${CANARY_DATABASE.name}' AND database_id='${CANARY_DATABASE.id}')`,
  'DROP TRIGGER public_snapshot_pub_insert', 'DROP TRIGGER public_snapshot_pub_update',
  'DROP TRIGGER public_snapshot_pub_delete', 'DROP TRIGGER public_snapshot_sync_insert',
  'DROP TRIGGER public_snapshot_sync_update', 'DROP TRIGGER public_snapshot_sync_delete',
  'DROP TABLE public_snapshot_revision', 'DROP TABLE fdci_import_checkpoint',
];

export function validateCanaryTarget(config) {
  assert.equal(config.name, CANARY_DATABASE.worker, 'Unexpected Worker');
  assert.deepEqual(config.d1_databases, [{ binding: 'DB', database_name: CANARY_DATABASE.name, database_id: CANARY_DATABASE.id }]);
  assert.equal(config.vars?.JUNTAS_CANARY_DATABASE_ID, CANARY_DATABASE.id);
}

async function resultOf(db, sql) {
  const result = await db.prepare(sql).all();
  assert.equal(result?.success, true, `D1 query failed: ${sql}`);
  return result.results;
}

async function effectiveIdentity(db) {
  const row = await db.prepare('SELECT database_name,database_id FROM import_gateway_identity WHERE id=1').first();
  assert.equal(row?.database_name, CANARY_DATABASE.name, 'D1 destination name mismatch');
  assert.equal(row?.database_id, CANARY_DATABASE.id, 'D1 destination ID mismatch');
}

const digest = rows => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
async function inventory(db) {
  return resultOf(db, "SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name");
}
async function publications(db) {
  return resultOf(db, 'SELECT * FROM publications ORDER BY id');
}
async function migrationStatements() {
  return ['migrations/0032_fdci_import_checkpoint.sql', 'migrations/0101_public_snapshot_revision.sql']
    .flatMap(path => splitSql(readFileSync(path, 'utf8')));
}
function createdNames(statements) {
  return statements.flatMap(sql => {
    const match = sql.match(/^\s*CREATE\s+(?:TEMP(?:ORARY)?\s+)?(TABLE|TRIGGER|INDEX|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?([\w]+)/i);
    return match ? [{ type: match[1].toLowerCase(), name: match[2] }] : [];
  });
}

export async function captureCanaryBaseline({ config, database }) {
  validateCanaryTarget(config);
  await effectiveIdentity(database);
  const [objects, rows] = await Promise.all([inventory(database), publications(database)]);
  const forbidden = new Set(createdNames(await migrationStatements()).map(object => object.name));
  assert.ok(objects.every(object => !forbidden.has(object.name)), 'Canary migration objects already exist in baseline');
  assert.ok(rows.every(row => !String(row.id).startsWith(FIXTURE_PREFIX)), 'Canary fixture rows already exist in baseline');
  return { databaseName: CANARY_DATABASE.name, databaseId: CANARY_DATABASE.id,
    objectHash: digest(objects), objects, publicationCount: rows.length, publicationHash: digest(rows) };
}

async function assertBaselineData(database, baseline) {
  await effectiveIdentity(database);
  const rows = await publications(database);
  const historic = rows.filter(row => !String(row.id).startsWith(FIXTURE_PREFIX));
  assert.equal(historic.length, baseline.publicationCount, 'Historical publication count changed');
  assert.equal(digest(historic), baseline.publicationHash, 'Historical publication data changed');
  return rows;
}

async function assertMigrationInventory(database, baseline, statements) {
  const objects = await inventory(database);
  const oldNames = new Set(baseline.objects.map(object => object.name));
  assert.deepEqual(objects.filter(object => oldNames.has(object.name)), baseline.objects, 'Baseline schema changed');
  const expected = createdNames(statements).filter(object => !oldNames.has(object.name)).sort((a,b) => a.name.localeCompare(b.name));
  const added = objects.filter(object => !oldNames.has(object.name)).map(({type,name}) => ({type,name})).sort((a,b) => a.name.localeCompare(b.name));
  assert.deepEqual(added, expected, 'Unexpected/missing Canary schema objects');
}

async function assertFixture(database, baseline, statements) {
  const rows = await assertBaselineData(database, baseline);
  const fixture = rows.filter(row => String(row.id).startsWith(FIXTURE_PREFIX));
  assert.equal(fixture.length, 152, 'Expected all 152 Canary publications');
  assert.ok(fixture.every(row => row.source === 'Capacitación Docente' && row.content_hash === FIXTURE_HASH), 'Unexpected row under Canary fixture prefix');
  await assertMigrationInventory(database, baseline, statements);
}

function assertSuccessful(result, statement) {
  assert.equal(result?.success, true, `D1 did not confirm SQL success: ${statement}`);
}

export async function runCanarySql({ config, database, phase, baseline, closeCanary }) {
  validateCanaryTarget(config);
  assert.ok(database && typeof database.prepare === 'function', 'The configured D1 handle is required');
  await effectiveIdentity(database);
  assert.ok(['migrations', 'fixture', 'restore'].includes(phase), 'Unknown Canary SQL phase');
  assert.equal(baseline?.databaseName, CANARY_DATABASE.name, 'A verified baseline is required');
  assert.equal(baseline?.databaseId, CANARY_DATABASE.id, 'Baseline database identity mismatch');
  const migrations = await migrationStatements();
  const statements = phase === 'migrations' ? migrations : phase === 'fixture'
    ? splitSql(readFileSync('scripts/public-snapshot-canary-fixture.sql', 'utf8')) : RESTORE;

  if (phase === 'migrations') {
    const [objects, rows] = await Promise.all([inventory(database), publications(database)]);
    assert.equal(digest(objects), baseline.objectHash, 'Initial schema no longer matches baseline');
    assert.equal(digest(rows), baseline.publicationHash, 'Initial publication data no longer matches baseline');
  } else if (phase === 'fixture') {
    await assertBaselineData(database, baseline);
    await assertMigrationInventory(database, baseline, migrations);
    assert.equal((await publications(database)).filter(row => String(row.id).startsWith(FIXTURE_PREFIX)).length, 0,
      'Fixture rows already exist; refusing to duplicate');
  } else {
    assert.equal(typeof closeCanary, 'function', 'Verified Durable Object closure is required before restoration');
    await assertFixture(database, baseline, migrations);
    const closed = await closeCanary();
    assert.equal(closed?.status, 200, 'Durable Object close did not return HTTP 200');
    assert.equal((await closed.json()).closed, true, 'Durable Object close was not confirmed');
    await effectiveIdentity(database);
    await assertFixture(database, baseline, migrations);
  }

  const completed = [], manifest = [];
  for (const statement of statements) {
    try {
      await effectiveIdentity(database);
      const result = await database.prepare(statement).run();
      assertSuccessful(result, statement);
    } catch (cause) {
      const error = new Error(`Canary SQL outcome ambiguous after ${completed.length} confirmed statements; inspect D1 before continuing.`);
      error.cause = cause;
      error.completed = [...completed];
      throw error;
    }
    completed.push(statement);
    manifest.push({ phase, sequence: completed.length, sql: statement });
  }
  if (phase === 'fixture') await assertFixture(database, baseline, migrations);
  if (phase === 'restore') {
    const [objects, rows] = await Promise.all([inventory(database), publications(database)]);
    assert.deepEqual(objects, baseline.objects, 'Restored schema differs from baseline');
    assert.equal(rows.length, baseline.publicationCount, 'Restored publication count differs from baseline');
    assert.equal(digest(rows), baseline.publicationHash, 'Restored historical publications differ from baseline');
    assert.equal(rows.filter(row => String(row.id).startsWith(FIXTURE_PREFIX)).length, 0, 'Fixture rows remain after restore');
  }
  return { statements: completed.length, manifest };
}

// Keep CREATE TRIGGER bodies intact: their internal semicolons are not statement boundaries.
export function splitSql(sql) {
  const statements=[]; let part='',quote=null,lineComment=false,blockComment=false,triggerBody=false,caseDepth=0;
  for(let i=0;i<sql.length;){
    const c=sql[i],next=sql[i+1];
    if(lineComment){if(c==='\n'){lineComment=false;part+='\n';}i++;continue;}
    if(blockComment){if(c==='*'&&next==='/'){blockComment=false;i+=2;}else i++;continue;}
    if(!quote&&c==='-'&&next==='-'){lineComment=true;i+=2;continue;}
    if(!quote&&c==='/'&&next==='*'){blockComment=true;i+=2;continue;}
    if(quote){part+=c;if(c===quote&&next===quote){part+=next;i+=2;continue;}if(c===quote)quote=null;i++;continue;}
    if(c==="'"||c==='"'||c==='`'){quote=c;part+=c;i++;continue;}
    if(/[A-Za-z_]/.test(c)){
      let end=i+1;while(/[A-Za-z0-9_]/.test(sql[end]||''))end++;
      const word=sql.slice(i,end);part+=word;i=end;
      if(/^\s*CREATE\s+(?:TEMP(?:ORARY)?\s+)?TRIGGER\b/i.test(part)){
        if(word.toUpperCase()==='BEGIN')triggerBody=true;
        else if(triggerBody&&word.toUpperCase()==='CASE')caseDepth++;
        else if(triggerBody&&word.toUpperCase()==='END'){if(caseDepth)caseDepth--;else triggerBody=false;}
      }
      continue;
    }
    if(c===';'&&!triggerBody){if(part.trim())statements.push(part.trim());part='';caseDepth=0;}
    else part+=c;
    i++;
  }
  if(part.trim())statements.push(part.trim());
  return statements;
}
