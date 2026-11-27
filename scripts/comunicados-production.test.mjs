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
      assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${env.JUNTAS_IMPORT_SECRET}`);
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
    return { sourceRequests: 0, publicationAttempts: 0, created: 0, updated: 0, unchanged: 0, coverage: [], failures: [] };
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

test('checkpoint reutiliza una sola cabecera Authorization y conserva dueño de concesión', async () => {
  const actions = [];
  const fetcher = async (input, init) => {
    if (new URL(input).pathname === '/api/internal/juntas-checkpoint') {
      assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${env.JUNTAS_IMPORT_SECRET}`);
      assert.equal(new Headers(init.headers).get('x-import-gate-owner'), 'juntas-123');
      return Response.json({ ok: true, result: null });
    }
    return transport(actions)(input, init);
  };
  await runComunicadosProduction(env, sha, { fetcher, maintenance: async ({ db }) => {
    await db.prepare('SELECT status,last_success_at FROM juntas_import_checkpoint WHERE root_id=?').bind('com-primaria').first();
    return { sourceRequests: 0, publicationAttempts: 0, created: 0, updated: 0, unchanged: 0, coverage: [], failures: [] };
  } });
  assert.deepEqual(actions, ['open', 'close']);
});

test('el fallo posterior a una solicitud oficial conserva contador, etapa y cierre sin filtrar credenciales', async () => {
  const actions = [], events = [];
  const secret = env.JUNTAS_IMPORT_SECRET;
  const fetcher = async (input, init) => new URL(input).hostname === 'docs.google.com'
    ? new Response('', { status: 503 }) : transport(actions)(input, init);
  await assert.rejects(runComunicadosProduction(env, sha, { fetcher, report: event => events.push(event),
    maintenance: async options => {
      options.onRoot('com-secundaria');
      assert.equal((await options.sourceFetch('https://docs.google.com/document/d/example')).status, 503);
      throw Error('JUNTAS_SOURCE_HTTP_503');
    } }), /JUNTAS_SOURCE_HTTP_503/);
  assert.deepEqual(actions, ['open', 'close']);
  const failed = events.find(event => event.event === 'failure');
  assert.equal(failed.rootId, 'com-secundaria');
  assert.equal(failed.officialRequests, 1);
  assert.equal(failed.publicationAttempts, 0);
  assert.equal(failed.errorCode, 'JUNTAS_SOURCE_HTTP_503');
  assert.equal(events.at(-1).lease, 'closed');
  assert.ok(events.some(event => event.event === 'official_response_error' && event.httpStatus === 503));
  assert.doesNotMatch(JSON.stringify(events), new RegExp(secret));
  assert.doesNotMatch(JSON.stringify(events), /Authorization|docs\.google\.com/);
});

test('un rechazo del receptor cuenta el intento de publicación antes del HTTP y registra operación', async () => {
  const actions = [], events = [];
  const fetcher = async (input, init) => new URL(input).pathname === '/api/internal/public-source-import/juntas'
    ? new Response('', { status: 503 }) : transport(actions)(input, init);
  await assert.rejects(runComunicadosProduction(env, sha, { fetcher, report: event => events.push(event),
    maintenance: async options => {
      options.onRoot('com-tecnica');
      const response = await options.receiverOverride.receiverFetch(COMUNICADOS_RECEIVER + '/api/internal/public-source-import/juntas',
        { method: 'POST', body: '{}' });
      assert.equal(response.status, 503);
      throw Error('JUNTAS_RECEIVER_HTTP_503');
    } }), /JUNTAS_RECEIVER_HTTP_503/);
  assert.equal(events.find(event => event.event === 'failure').publicationAttempts, 1);
  assert.ok(events.some(event => event.event === 'receiver_response_error' && event.httpStatus === 503));
  assert.deepEqual(actions, ['open', 'close']);
});

test('la identidad rechazada registra HTTP sin abrir concesión ni consumir presupuesto', async () => {
  const events = [];
  await assert.rejects(runComunicadosProduction(env, sha, { fetcher: async () => new Response('', { status: 401 }),
    report: event => events.push(event) }), /COMUNICADOS_IDENTITY_HTTP_401/);
  assert.equal(events.at(-1).errorCode, 'COMUNICADOS_IDENTITY_HTTP_401');
  assert.equal(events.at(-1).officialRequests, 0);
  assert.equal(events.at(-1).publicationAttempts, 0);
  assert.equal(events.at(-1).lease, 'closed');
});

test('los límites se aplican antes del HTTP aun cuando el coordinador intente excederlos', async () => {
  const actions = [], events = [];
  let officialCalls = 0, publicationCalls = 0;
  const fetcher = async (input, init) => {
    const url = new URL(input);
    if (url.hostname === 'docs.google.com') { officialCalls++; return new Response('ok'); }
    if (url.pathname === '/api/internal/public-source-import/juntas') { publicationCalls++; return Response.json({ ok: true }); }
    return transport(actions)(input, init);
  };
  await assert.rejects(runComunicadosProduction(env, sha, { fetcher, report: event => events.push(event),
    maintenance: async options => {
      options.onRoot('com-superior');
      for (let n = 0; n < 25; n++) await options.sourceFetch('https://docs.google.com/document/d/example');
      await options.sourceFetch('https://docs.google.com/document/d/example');
    } }), /COMUNICADOS_REQUEST_BUDGET_EXHAUSTED/);
  assert.equal(officialCalls, 25);
  assert.equal(events.find(event => event.event === 'failure').officialRequests, 25);

  await assert.rejects(runComunicadosProduction(env, sha, { fetcher, report: event => events.push(event),
    maintenance: async options => {
      options.onRoot('com-primaria');
      for (let n = 0; n < 21; n++) await options.receiverOverride.receiverFetch(
        COMUNICADOS_RECEIVER + '/api/internal/public-source-import/juntas', { method: 'POST', body: '{}' });
    } }), /COMUNICADOS_PUBLICATION_BUDGET_EXHAUSTED/);
  assert.equal(publicationCalls, 20);
  assert.equal(events.filter(event => event.event === 'publication_attempt').length, 20);
  assert.deepEqual(actions, ['open', 'close', 'open', 'close']);
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
