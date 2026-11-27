import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { runJuntasMaintenance } from './juntas-maintenance.mjs';
import { createJuntasGatewayDb } from './juntas-gateway-db.mjs';
import { JUNTA_EXTERNAL_SOURCES } from '../lib/junta-external-sources.ts';

export const COMUNICADOS_RECEIVER = 'https://docentetuc-sources-1-2.possee41.workers.dev';
const sources = JUNTA_EXTERNAL_SOURCES.filter(source => source[1] === 'Comunicados');

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

export async function runComunicadosProduction(env, sha, { fetcher = fetch, maintenance = runJuntasMaintenance, clock = () => Date.now(), closing = false } = {}) {
  const config = comunicadosConfig(env, sha, { closing });
  const headers = { Authorization: `Bearer ${config.secret}` };
  const gate = async action => {
    const response = await fetcher(config.origin + '/api/internal/import-gate', {
      method: 'POST', redirect: 'error', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'juntas', owner: config.owner, action, ttlSeconds: 600 }), signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw Error(`COMUNICADOS_GATE_HTTP_${response.status}`);
    const body = await response.json();
    if (body.ok !== true || body.source !== 'juntas' || body.owner !== config.owner || action === 'close' && body.closed !== true)
      throw Error('COMUNICADOS_GATE_ACK_INVALID');
    return body;
  };
  if (closing) { await gate('close'); return { closed: true }; }
  let deadline = Infinity;
  const receive = async (input, init = {}) => {
    if (new URL(input).origin !== config.origin) throw Error('COMUNICADOS_DESTINATION_FORBIDDEN');
    if (clock() >= deadline) throw Error('COMUNICADOS_WINDOW_EXPIRED');
    return fetcher(input, { ...init, redirect: 'error', headers: { ...Object.fromEntries(new Headers(init.headers)), ...headers, 'X-Import-Gate-Owner': config.owner },
      signal: AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(Math.max(1, Math.min(20000, deadline - clock())))]) });
  };
  const identity = await receive(config.origin + '/api/internal/import-identity?source=juntas');
  if (!identity.ok) throw Error(`COMUNICADOS_IDENTITY_HTTP_${identity.status}`);
  const id = await identity.json();
  if (id.id !== env.JUNTAS_DATABASE_ID || id.name !== env.JUNTAS_DATABASE_NAME) throw Error('COMUNICADOS_IDENTITY_MISMATCH');
  let opened = false;
  try {
    opened = true;
    const lease = await gate('open');
    const expires = Date.parse(lease.expiresAt);
    if (!Number.isFinite(expires) || expires <= clock() || expires - clock() > 600000) throw Error('COMUNICADOS_EXPIRATION_INVALID');
    deadline = expires - 30000;
    const db = createJuntasGatewayDb({ origin: config.origin, secret: config.secret }, receive);
    const sourceFetch = (input, init = {}) => { if (clock() >= deadline) throw Error('COMUNICADOS_WINDOW_EXPIRED'); return fetcher(input, { ...init,
      signal: AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(Math.max(1, deadline - clock()))]) }); };
    const result = await maintenance({ db, sources, comunicadosOnlyFair: true, maxRequests: 25, maxPublicationWrites: 20, sourceFetch,
      receiverOverride: { token: config.secret, endpoint: path => config.origin + path, receiverFetch: receive } });
    if (!Number.isInteger(result.sourceRequests) || result.sourceRequests > 25 || !Number.isInteger(result.publicationAttempts) || result.publicationAttempts > 20)
      throw Error('COMUNICADOS_BUDGET_INVALID');
    return { created: result.created, updated: result.updated, unchanged: result.unchanged,
      sourceRequests: result.sourceRequests, publicationAttempts: result.publicationAttempts,
      coverage: result.coverage, failures: result.failures, boardRequests: result.boardRequests, boardWrites: result.boardWrites, closed: true };
  } finally { if (opened) await gate('close'); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    console.log(JSON.stringify(await runComunicadosProduction(process.env, sha, { closing: process.argv.includes('--close') })));
  } catch (error) {
    console.error(/^[A-Z_0-9]+$/.test(error?.message || '') ? error.message : 'COMUNICADOS_PRODUCTION_FAILED');
    process.exitCode = 1;
  }
}
