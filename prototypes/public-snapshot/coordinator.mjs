// Local prototype only: deliberately not exported by the production Worker.
export const TTL = 60_000;
const CHUNK = 64 * 1024;

// Preserve the existing SQL's TEXT comparison with datetime('now'), including
// its treatment of ISO 'T' values. Do not silently change date semantics here.
export function nextBoundary(values, now) {
  let boundary = Infinity;
  const sqlNow = new Date(now).toISOString().slice(0, 19).replace('T', ' ');
  for (const value of values) {
    if (!value || value < sqlNow) continue;
    let candidate;
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      candidate = Date.parse(value.slice(0, 10) + 'T00:00:00Z') + 86_400_000;
    } else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
      candidate = Date.parse(value.replace(' ', 'T') + 'Z') + 1000;
    } else {
      // Unknown formats cannot justify renewing an unchanged snapshot.
      candidate = now;
    }
    boundary = Math.min(boundary, Number.isFinite(candidate) ? candidate : now);
  }
  return boundary;
}

export class SnapshotCoordinator {
  constructor(storage, source, clock = Date.now) {
    this.storage = storage;
    this.source = source;
    this.clock = clock;
  }

  async load() {
    if (this.snapshot) return this.snapshot;
    const manifest = await this.storage.get('manifest');
    if (!manifest) return null;
    const parts = [];
    for (let i = 0; i < manifest.chunks; i++) {
      const part = await this.storage.get(`body:${i}`);
      if (!part) throw new Error('INCOMPLETE_SNAPSHOT');
      parts.push(part);
    }
    return this.snapshot = { ...manifest, body: new Blob(parts) };
  }

  async refresh(force = false) {
    // Serialize refreshes, including BYPASS, without concurrent publication.
    const previous = this.pending || Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
      const snapshot = await this.load();
      const now = this.clock();
      if (!force && snapshot && now < snapshot.expires) return snapshot;
      const revision = await this.source.revision();
      if (!force && snapshot && revision === snapshot.revision && now < snapshot.boundary) {
        const renewed = { ...snapshot, expires: now + TTL };
        const { body, ...manifest } = renewed;
        await this.storage.put('manifest', manifest);
        return this.snapshot = renewed;
      }
      const prepared = await this.source.build();
      // A concurrent relevant write invalidates the entire preparation. No retry.
      if (revision !== await this.source.revision() || this.clock() >= now + TTL) {
        throw new Error('SNAPSHOT_CHANGED_OR_EXPIRED');
      }
      const body = new Blob([prepared.body]);
      const bytes = new Uint8Array(await body.arrayBuffer());
      const manifest = { revision, expires: now + TTL,
        boundary: prepared.boundary, chunks: Math.ceil(bytes.length / CHUNK) };
      await this.storage.transaction(async tx => {
        for (let i = 0; i < manifest.chunks; i++) {
          await tx.put(`body:${i}`, bytes.slice(i * CHUNK, (i + 1) * CHUNK));
        }
        for (let i = manifest.chunks; i < (snapshot?.chunks || 0); i++) await tx.delete(`body:${i}`);
        await tx.put('manifest', manifest);
      });
      return this.snapshot = { ...manifest, body };
    });
    this.pending = pending;
    try { return await pending; }
    finally { if (this.pending === pending) this.pending = null; }
  }

  async alarm() {
    try { await this.refresh(); }
    finally { await this.storage.setAlarm(this.clock() + 50_000); }
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.pathname !== '/api/public-app') return new Response(null, { status: 404 });
    try {
      const snapshot = await this.refresh(Boolean(url.search));
      if (this.clock() >= snapshot.expires) throw new Error('EXPIRED');
      if (await this.storage.getAlarm() === null) await this.storage.setAlarm(this.clock() + 50_000);
      return new Response(snapshot.body, { headers: {
        'Content-Type': 'application/json', 'Cache-Control': 'no-store',
        'X-Public-App-Cache': url.search ? 'BYPASS' : 'PREPARED',
      } });
    } catch {
      return Response.json({ error: 'No se pudo cargar la información pública.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
  }
}

// The public Worker does no D1 query, JSON decode/encode, clone or cache.put.
// A private binding uses one fixed object, never an ID supplied by a client.
export function forwardPublic(request, namespace) {
  return namespace.get(namespace.idFromName('public-app-v1')).fetch(
    new Request(request.url, { method: 'GET' }));
}
