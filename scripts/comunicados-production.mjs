import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { runJuntasMaintenance } from './juntas-maintenance.mjs';
import { createJuntasGatewayDb } from './juntas-gateway-db.mjs';
import { JUNTA_EXTERNAL_SOURCES } from '../lib/junta-external-sources.ts';

export const COMUNICADOS_RECEIVER = 'https://docentetuc-sources-1-2.possee41.workers.dev';
const sources = JUNTA_EXTERNAL_SOURCES.filter(source => source[1] === 'Comunicados');
const errorCode = error => /^(?:COMUNICADOS|JUNTAS)_[A-Z_0-9]{2,100}$/.test(error?.message || '') ? error.message :
  ['AbortError', 'TimeoutError', 'TypeError'].includes(error?.name) ? error.name.toUpperCase() : 'UNEXPECTED_ERROR';

export function comunicadosConfig(env, sha, { closing = false } = {}) {
  if (!/^[a-f0-9]{40}$/.test(sha || '') || env.COMUNICADOS_APPROVED_SHA !== sha ||
    env.JUNTAS_DATABASE_ID !== 'baaf5886-0123-4948-96da-aa7106424549' ||
    env.JUNTAS_DATABASE_NAME !== 'docentetuc-db' || env.JUNTAS_RECEIVER_ORIGIN !== COMUNICADOS_RECEIVER)
    throw Error('COMUNICADOS_IDENTITY_INVALID');
  if (!closing && (env.COMUNICADOS_DAILY_ENABLED !== 'true' || env.GITHUB_EVENT_NAME !== 'schedule' ||
    env.GITHUB_REPOSITORY !== 'possee41/docentetuc' || env.GITHUB_RUN_ATTEMPT !== '1'))
    throw Error('COMUNICADOS_DISABLED');
  const owner = `juntas-${env.GITHUB_RUN_ID || ''}`;
  if (!/^juntas-[0-9]{1,30}$/.test(owner) || !/^[A-Za-z0-9_-]{32,}$/.test(env.JUNTAS_IMPORT_SECRET || ''))
    throw Error('COMUNICADOS_CREDENTIAL_MISSING');
  return { origin: COMUNICADOS_RECEIVER, owner, secret: env.JUNTAS_IMPORT_SECRET };
}

export async function runComunicadosProduction(env, sha, { fetcher = fetch, maintenance = runJuntasMaintenance, clock = () => Date.now(), closing = false, report = () => {} } = {}) {
  const config = comunicadosConfig(env, sha, { closing });
  const state = { phase: 'identity', rootId: null, checkpointOp: null, checkpointStatus: null,
    officialRequests: 0, publicationAttempts: 0, lease: 'closed' };
  const emit = (event, extra = {}) => { try { report({ event, ...state, ...extra }); } catch { /* Telemetry cannot open the gate or bypass a limit. */ } };
  const headers = { Authorization: `Bearer ${config.secret}` };
  const gate = async action => {
    state.phase = `gate_${action}`;
    if (action === 'open') state.lease = 'unknown';
    emit('gate_request');
    const response = await fetcher(config.origin + '/api/internal/import-gate', {
      method: 'POST', redirect: 'error', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'juntas', owner: config.owner, action, ttlSeconds: 600 }), signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw Error(`COMUNICADOS_GATE_HTTP_${response.status}`);
    const body = await response.json();
    if (body.ok !== true || body.source !== 'juntas' || body.owner !== config.owner || action === 'close' && body.closed !== true)
      throw Error('COMUNICADOS_GATE_ACK_INVALID');
    state.lease = action === 'open' ? 'open' : 'closed';
    emit('gate_ack', { httpStatus: response.status });
    return body;
  };
  if (closing) {
    try { await gate('close'); return { closed: true }; }
    catch (error) { emit('close_failure', { errorCode: errorCode(error) }); throw error; }
  }
  let deadline = Infinity;
  const receive = async (input, init = {}) => {
    const url = new URL(input);
    if (url.origin !== config.origin) throw Error('COMUNICADOS_DESTINATION_FORBIDDEN');
    if (clock() >= deadline) throw Error('COMUNICADOS_WINDOW_EXPIRED');
    if (url.pathname === '/api/internal/juntas-checkpoint') {
      const op = JSON.parse(init.body || '{}').op;
      state.phase = 'checkpoint';
      state.checkpointOp = /^[A-Za-z]{2,20}$/.test(op || '') ? op : 'unknown';
    } else if (url.pathname === '/api/internal/public-source-import/juntas') {
      if (state.publicationAttempts >= 20) throw Error('COMUNICADOS_PUBLICATION_BUDGET_EXHAUSTED');
      state.phase = 'publication';
      state.publicationAttempts++;
      emit('publication_attempt');
    }
    const requestHeaders = new Headers(init.headers);
    requestHeaders.set('Authorization', `Bearer ${config.secret}`);
    requestHeaders.set('X-Import-Gate-Owner', config.owner);
    try {
      const response = await fetcher(input, { ...init, redirect: 'error', headers: requestHeaders,
        signal: AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(Math.max(1, Math.min(20000, deadline - clock())))]) });
      if (!response.ok) emit('receiver_response_error', { httpStatus: response.status });
      return response;
    } catch (error) { emit('receiver_network_error', { errorCode: errorCode(error) }); throw error; }
  };
  let opened = false;
  let failure = null;
  try {
    const identity = await receive(config.origin + '/api/internal/import-identity?source=juntas');
    if (!identity.ok) throw Error(`COMUNICADOS_IDENTITY_HTTP_${identity.status}`);
    const id = await identity.json();
    if (id.id !== env.JUNTAS_DATABASE_ID || id.name !== env.JUNTAS_DATABASE_NAME) throw Error('COMUNICADOS_IDENTITY_MISMATCH');
    emit('identity_ack', { httpStatus: identity.status });
    opened = true;
    const lease = await gate('open');
    const expires = Date.parse(lease.expiresAt);
    if (!Number.isFinite(expires) || expires <= clock() || expires - clock() > 600000) throw Error('COMUNICADOS_EXPIRATION_INVALID');
    deadline = expires - 30000;
    const db = createJuntasGatewayDb({ origin: config.origin, secret: config.secret }, receive);
    const sourceFetch = async (input, init = {}) => {
      if (clock() >= deadline) throw Error('COMUNICADOS_WINDOW_EXPIRED');
      if (state.officialRequests >= 25) throw Error('COMUNICADOS_REQUEST_BUDGET_EXHAUSTED');
      state.phase = 'official_source';
      state.officialRequests++;
      emit('official_request');
      try {
        const response = await fetcher(input, { ...init,
          signal: AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(Math.max(1, deadline - clock()))]) });
        if (!response.ok && ![301, 302, 303, 307, 308].includes(response.status)) emit('official_response_error', { httpStatus: response.status });
        return response;
      } catch (error) { emit('official_network_error', { errorCode: errorCode(error) }); throw error; }
    };
    const result = await maintenance({ db, sources, comunicadosOnlyFair: true, maxRequests: 25, maxPublicationWrites: 20, sourceFetch,
      onRoot: rootId => { state.rootId = rootId; state.checkpointOp = null; state.checkpointStatus = null; state.phase = 'root'; emit('root_start'); },
      onRootResult: (rootId, row) => { state.rootId = rootId; state.checkpointStatus = row.health?.find(item => item.root_id === rootId)?.status || null;
        emit('root_result', { sourceRequests: row.sourceRequests, publicationAttemptsInRoot: row.publicationAttempts }); },
      receiverOverride: { token: config.secret, endpoint: path => config.origin + path, receiverFetch: receive } });
    if (!Number.isInteger(result.sourceRequests) || result.sourceRequests > 25 || !Number.isInteger(result.publicationAttempts) || result.publicationAttempts > 20 ||
      result.sourceRequests < state.officialRequests || result.publicationAttempts !== state.publicationAttempts)
      throw Error('COMUNICADOS_BUDGET_INVALID');
    emit('maintenance_complete', { sourceRequests: result.sourceRequests });
    return { created: result.created, updated: result.updated, unchanged: result.unchanged,
      sourceRequests: state.officialRequests, publicationAttempts: state.publicationAttempts,
      coverage: result.coverage, failures: result.failures, boardRequests: result.boardRequests, boardWrites: result.boardWrites, closed: true };
  } catch (error) {
    failure = error;
    emit('failure', { errorCode: errorCode(error), httpStatus: Number(error?.cause?.status) || undefined });
    throw error;
  } finally {
    if (opened) try { await gate('close'); }
    catch (error) { emit('close_failure', { errorCode: errorCode(error) }); if (!failure) throw error; }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    console.log(JSON.stringify(await runComunicadosProduction(process.env, sha, { closing: process.argv.includes('--close'),
      report: event => console.error(JSON.stringify(event)) })));
  } catch (error) {
    console.error(errorCode(error));
    process.exitCode = 1;
  }
}
