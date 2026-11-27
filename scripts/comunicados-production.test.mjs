import test from 'node:test';
import assert from 'node:assert/strict';
import { runComunicadosProduction, COMUNICADOS_RECEIVER } from './comunicados-production.mjs';
import { runJuntasMaintenance } from './juntas-maintenance.mjs';
import { JUNTA_EXTERNAL_SOURCES } from '../lib/junta-external-sources.ts';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const sha = 'a'.repeat(40);
const env = { COMUNICADOS_APPROVED_SHA: sha, COMUNICADOS_DAILY_ENABLED: 'true',
  JUNTAS_DATABASE_ID: 'baaf5886-0123-4948-96da-aa7106424549', JUNTAS_DATABASE_NAME: 'docentetuc-db',
  JUNTAS_RECEIVER_ORIGIN: COMUNICADOS_RECEIVER, JUNTAS_IMPORT_SECRET: 'synthetic_test_only_'.padEnd(40, 'x'),
  GITHUB_EVENT_NAME: 'schedule', GITHUB_REPOSITORY: 'possee41/docentetuc', GITHUB_RUN_ATTEMPT: '1', GITHUB_RUN_ID: '123' };

function transport(actions) {
  return async (input, init) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/import-identity')) {
      assert.equal(init.headers.Authorization, `Bearer ${env.JUNTAS_IMPORT_SECRET}`);
      return Response.json({ id: env.JUNTAS_DATABASE_ID, name: env.JUNTAS_DATABASE_NAME });
    }
    assert.equal(url.pathname, '/api/internal/import-gate');
    const body = JSON.parse(init.body);
    actions.push(body.action);
    return Response.json({ ok: true, source: 'juntas', owner: 'juntas-123', closed: body.action === 'close', expiresAt: new Date(Date.now() + 600000).toISOString() });
  };
}

test('siete raíces oficiales, cuatro Juntas, cupos y cierre ante éxito', async () => {
  const actions = [];
  const result = await runComunicadosProduction(env, sha, { fetcher: transport(actions), maintenance: async options => {
    assert.equal(options.sources.length, 7);
    assert.equal(new Set(options.sources.map(source => source[2])).size, 4);
    assert.ok(options.sources.every(source => source[1] === 'Comunicados'));
    assert.equal(options.maxRequests, 25);
    assert.equal(options.maxPublicationWrites, 20);
    assert.equal(options.comunicadosOnlyFair, true);
    return { sourceRequests: 7, publicationAttempts: 2, created: 1, updated: 1, unchanged: 0, coverage: [], failures: [] };
  } });
  assert.deepEqual(actions, ['open', 'close']);
  assert.equal(result.closed, true);
});

test('rechazo de identidad impide abrir concesión; error de importación la cierra', async () => {
  const actions = [];
  await assert.rejects(runComunicadosProduction(env, sha, { fetcher: async () => new Response('', { status: 401 }) }), /COMUNICADOS_IDENTITY_HTTP_401/);
  await assert.rejects(runComunicadosProduction(env, sha, { fetcher: transport(actions), maintenance: async () => { throw Error('SOURCE_FAILED'); } }), /SOURCE_FAILED/);
  assert.deepEqual(actions, ['open', 'close']);
  await assert.rejects(runComunicadosProduction({ ...env, COMUNICADOS_APPROVED_SHA: 'b'.repeat(40) }, sha, { fetcher: transport([]) }), /COMUNICADOS_IDENTITY_INVALID/);
});

test('coordinador real reparte solicitudes y escrituras entre cuatro Juntas y guarda checkpoints', async () => {
  const sql = new DatabaseSync(':memory:');
  try {
    sql.exec(readFileSync(new URL('../lib/fixtures/juntas-production-schema-20261121.sql', import.meta.url), 'utf8'));
    const wrap = (query, args = []) => ({ bind: (...values) => wrap(query, values),
      all: async () => ({ results: sql.prepare(query).all(...args) }),
      first: async () => sql.prepare(query).get(...args) || null,
      run: async () => { const result = sql.prepare(query).run(...args); return { meta: { changes: Number(result.changes), rows_written: Number(result.changes) } }; } });
    const roots = JUNTA_EXTERNAL_SOURCES.filter(source => source[1] === 'Comunicados');
    const imported = [];
    const result = await runJuntasMaintenance({ db: { prepare: wrap }, sources: roots, comunicadosOnlyFair: true,
      now: new Date('2026-11-27T11:07:00Z'), maxRequests: 25, maxPublicationWrites: 20,
      sourceFetch: async () => new Response('COMUNICADO\n24/11/2026\nAviso anterior de prueba\nInscripción docente.\nCOMUNICADO\n27/11/2026\nAviso reciente de prueba\nInscripción docente.'),
      receiverOverride: { token: 'synthetic', endpoint: path => 'https://local.invalid' + path,
        receiverFetch: async (_, init) => { imported.push(JSON.parse(init.body).items[0]); return Response.json({ ok: true, received: 1, created: 1, updated: 0, unchanged: 0, queries: 1, rowsRead: 0, rowsWritten: 1 }); } } });
    assert.equal(result.coverage.length, 7);
    assert.ok(result.sourceRequests <= 25);
    assert.ok(result.publicationAttempts <= 20);
    assert.equal(Object.keys(result.boardRequests).length, 4);
    assert.ok(Object.values(result.boardRequests).every(count => count <= 7));
    assert.ok(Object.values(result.boardWrites).every(count => count <= 5));
    assert.equal(sql.prepare("SELECT count(*) AS n FROM juntas_import_checkpoint WHERE category='Comunicados'").get().n, 7);
    assert.equal(imported[0].sourcePublishedAt, '2026-11-27');
  } finally { sql.close(); }
});

test('workflow diario preparado a las 08:07 permanece inactivo y cierra siempre', () => {
  const workflow = readFileSync(new URL('../.github/workflows/comunicados-daily-production.yml', import.meta.url), 'utf8');
  assert.match(workflow, /# schedule: \[\{ cron: '7 11 \* \* \*' \}\]/);
  assert.match(workflow, /github\.event_name == 'schedule'/);
  assert.match(workflow, /COMUNICADOS_DAILY_ENABLED == 'true'/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /scripts\/comunicados-production\.mjs --close/);
  assert.match(workflow, /environment: juntas-production/);
});
