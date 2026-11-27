import { getPublicApp } from '../../lib/public-app.ts';
import { SnapshotCoordinator, nextBoundary } from './coordinator.mjs';

// Proposed class only. No Wrangler binding, migration or production route added.
export class PublicSnapshot {
  coordinator: SnapshotCoordinator;
  constructor(state: DurableObjectState, env: { DB: D1Database }) {
    this.coordinator = new SnapshotCoordinator(state.storage, {
      revision: async () => {
        const row = await env.DB.prepare('SELECT revision FROM public_snapshot_revision WHERE id=1').first<{revision:number}>();
        if (!row || !Number.isSafeInteger(row.revision)) throw new Error('MISSING_REVISION');
        return row.revision;
      },
      build: async () => {
        const response = await getPublicApp(new Request('https://snapshot.invalid/api/public-app?fresh=1'), () => env.DB);
        if (!response.ok) throw new Error('SOURCE_FAILED');
        const dates = await env.DB.prepare(`SELECT starts_at, ends_at FROM publications
          WHERE kind IN ('informacion','vacante','capacitacion','junta')
          AND (starts_at >= datetime('now') OR ends_at >= datetime('now'))`).all<{ starts_at:string; ends_at:string }>();
        return { body: await response.arrayBuffer(),
          boundary: nextBoundary(dates.results.flatMap(row => [row.starts_at, row.ends_at]), Date.now()) };
      },
    });
  }
  fetch(request: Request) { return this.coordinator.fetch(request); }
  alarm() { return this.coordinator.alarm(); }
}
