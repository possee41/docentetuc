import { getPublicApp } from './public-app.ts';
import { SnapshotCoordinator, nextBoundary, forwardPublic } from './public-snapshot-coordinator.mjs';
declare const __PUBLIC_SNAPSHOT_BUILD__: string;
const buildVersion = typeof __PUBLIC_SNAPSHOT_BUILD__ === 'string' ? __PUBLIC_SNAPSHOT_BUILD__ : 'local-unbundled';

type SnapshotEnvironment = {
  DB: D1Database;
  PUBLIC_SNAPSHOT?: DurableObjectNamespace;
  PUBLIC_SNAPSHOT_ENABLED?: string;
  PUBLIC_APP_CACHE_ENABLED?: string;
  PUBLIC_APP_CACHE_VERSION?: string;
};

// Private binding only; no maintenance endpoint or client-selected object ID.
export class PublicSnapshot {
  coordinator: SnapshotCoordinator;
  constructor(state: DurableObjectState, env: SnapshotEnvironment) {
    this.coordinator = new SnapshotCoordinator(state.storage, {
      revision: async () => {
        const row = await env.DB.prepare('SELECT revision FROM public_snapshot_revision WHERE id=1').first<{revision:number}>();
        if (!row || !Number.isSafeInteger(row.revision)) throw new Error('MISSING_PUBLIC_REVISION');
        return row.revision;
      },
      build: async () => {
        const response = await getPublicApp(new Request('https://snapshot.invalid/api/public-app?fresh=1'), () => env.DB);
        if (!response.ok) throw new Error('PUBLIC_SNAPSHOT_SOURCE_FAILED');
        const dates = await env.DB.prepare(`SELECT starts_at, ends_at FROM publications
          WHERE kind IN ('informacion','vacante','capacitacion','junta')
          AND (starts_at >= datetime('now') OR ends_at >= datetime('now'))`).all<{starts_at:string; ends_at:string}>();
        const body = await response.arrayBuffer();
        console.log(JSON.stringify({ public_snapshot: 'build', bytes: body.byteLength }));
        return { body, boundary: nextBoundary(dates.results.flatMap(row => [row.starts_at, row.ends_at]), Date.now()) };
      },
    }, Date.now, { alarms: false, version: `${buildVersion}:${env.PUBLIC_APP_CACHE_VERSION || 'public-app-v1'}` });
  }
  async fetch(request: Request) {
    const response = await this.coordinator.fetch(request);
    const probe = request.headers.get('X-DT-Public-Probe');
    if (probe && /^[a-f0-9-]{36}$/.test(probe)) {
      const snapshot = this.coordinator.snapshot;
      console.log(JSON.stringify({ public_snapshot_probe: probe, status: response.status,
        revision: snapshot?.revision, expires: snapshot?.expires, bytes: snapshot?.body.size }));
    }
    return response;
  }
  // Cancels a leftover alarm if an earlier version scheduled one. Never reschedules.
  alarm() { return this.coordinator.alarm(); }
}

export function publicSnapshotApi(request: Request, env: SnapshotEnvironment) {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.pathname !== '/api/public-app' || env.PUBLIC_SNAPSHOT_ENABLED !== 'true') return null;
  if (['false', '0'].includes(env.PUBLIC_APP_CACHE_ENABLED || '')) url.searchParams.set('__cache_disabled', '1');
  const headers = new Headers();
  const probe = request.headers.get('X-DT-Public-Probe');
  if (probe) headers.set('X-DT-Public-Probe', probe);
  return (async () => {
    try {
      if (!env.PUBLIC_SNAPSHOT) throw new Error('PUBLIC_SNAPSHOT_BINDING_MISSING');
      return await forwardPublic(new Request(url, { headers }), env.PUBLIC_SNAPSHOT);
    } catch {
      return Response.json({ error: 'No se pudo cargar la información pública.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
  })();
}
