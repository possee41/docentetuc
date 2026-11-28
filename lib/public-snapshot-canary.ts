import { PublicSnapshot as BasePublicSnapshot } from './public-snapshot.ts';

// This module is bundled only into the isolated Canary entrypoint.
const DATABASE_ID = '0979f2c2-0e96-4b5c-811b-adcccc2dbd6d';
const DATABASE_NAME = 'docentetuc-sources-canary-1-2';
const CLOSE_PATH = '/__fdci_public_snapshot_canary_close';
const SECRET_HEADER = 'X-DT-Canary-Secret';

type CanaryEnvironment = {
  DB: D1Database;
  PUBLIC_SNAPSHOT: DurableObjectNamespace;
  PUBLIC_SNAPSHOT_ENABLED?: string;
  PUBLIC_SNAPSHOT_CANARY_ENABLED?: string;
  PUBLIC_SNAPSHOT_CANARY_UNTIL?: string;
  PUBLIC_SNAPSHOT_CANARY_SECRET?: string;
  JUNTAS_CANARY_DATABASE_ID?: string;
  PUBLIC_SNAPSHOT_CANARY_MAX_GETS?: string;
};

const windowExpired = (env: CanaryEnvironment) => {
  const until = Date.parse(env.PUBLIC_SNAPSHOT_CANARY_UNTIL || '');
  return Number.isFinite(until) && until <= Date.now();
};

async function isCanaryDatabase(env: CanaryEnvironment) {
  const row = await env.DB.prepare('SELECT database_name, database_id FROM import_gateway_identity WHERE id=1')
    .first<{ database_name: string; database_id: string }>();
  return row?.database_name === DATABASE_NAME && row.database_id === DATABASE_ID;
}

function authorized(request: Request, env: CanaryEnvironment) {
  return Boolean(env.PUBLIC_SNAPSHOT_CANARY_SECRET &&
    request.headers.get(SECRET_HEADER) === env.PUBLIC_SNAPSHOT_CANARY_SECRET &&
    env.JUNTAS_CANARY_DATABASE_ID === DATABASE_ID);
}

export async function canaryFetch(request: Request, env: CanaryEnvironment,
  productionFetch: (request: Request, env: CanaryEnvironment, context: unknown) => Promise<Response> | Response,
  context?: unknown) {
  const url = new URL(request.url);
  if (request.method === 'POST' && url.pathname === CLOSE_PATH) {
    if (!authorized(request, env) || !await isCanaryDatabase(env)) return new Response(null, { status: 403 });
    return env.PUBLIC_SNAPSHOT.get(env.PUBLIC_SNAPSHOT.idFromName('public-app-v1')).fetch(
      new Request(`https://canary.invalid${CLOSE_PATH}`, { method: 'POST', headers: { [SECRET_HEADER]: env.PUBLIC_SNAPSHOT_CANARY_SECRET! } }));
  }
  const remaining = Date.parse(env.PUBLIC_SNAPSHOT_CANARY_UNTIL || '') - Date.now();
  if (request.method !== 'GET' || url.pathname !== '/api/public-app' || url.search ||
    !authorized(request, env) || env.PUBLIC_SNAPSHOT_CANARY_ENABLED !== 'true' ||
    env.PUBLIC_SNAPSHOT_ENABLED !== 'true' || env.PUBLIC_SNAPSHOT_CANARY_MAX_GETS !== '2' ||
    !(remaining > 0 && remaining <= 300_000))
    return new Response(null, { status: 404 });
  return productionFetch(request, env, context);
}

export class PublicSnapshot extends BasePublicSnapshot {
  private state: DurableObjectState;
  private canaryEnv: CanaryEnvironment;
  private activeReads = new Set<Promise<unknown>>();
  constructor(state: DurableObjectState, env: CanaryEnvironment) {
    super(state, env);
    this.state = state;
    this.canaryEnv = env;
  }
  async fetch(request: Request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/public-app') {
      if (windowExpired(this.canaryEnv)) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
      const permitted = await this.state.storage.transaction(async tx => {
        if (await tx.get('canary:closed') === true) return false;
        const count = Number(await tx.get('canary:get-count') || 0);
        if (count >= 2) return false;
        await tx.put('canary:get-count', count + 1);
        return true;
      });
      if (!permitted) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
      const active = super.fetch(request);
      this.activeReads.add(active);
      try { return await active; }
      finally { this.activeReads.delete(active); }
    }
    if (request.method !== 'POST' || url.pathname !== CLOSE_PATH)
      return super.fetch(request);
    if (!authorized(request, this.canaryEnv) || !await isCanaryDatabase(this.canaryEnv))
      return new Response(null, { status: 403 });
    await this.state.storage.transaction(tx => tx.put('canary:closed', true));
    await Promise.allSettled([...this.activeReads]);
    if (!windowExpired(this.canaryEnv)) return Response.json({ closed: false, blocked: true }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
    try {
      await this.state.storage.deleteAlarm();
      await this.state.storage.deleteAll();
    } catch {
      return Response.json({ closed: false, error: 'CLEANUP_FAILED' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
    }
    this.coordinator.snapshot = null;
    return Response.json({ closed: true }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
