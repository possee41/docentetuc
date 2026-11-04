// Synthetic local fixture only. No credentials or source/Cloudflare networking.
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import gateway from "../workers/source-import-gateway.mjs";
import { prepareFdciImports } from "../lib/fdci-import.ts";
import { hashSourceSnapshot } from "../lib/sync-diff.ts";
import { fdciLocalFixture } from "./fdci-local-fixture.mjs";
import { runDeltaFdci } from "./fdci-delta.mjs";

export async function deltaData(count, events) {
  const start = performance.now();
  const courses = [{ capacitacion_id: 100, nombre: "Curso sintético", token: "synthetic", slug: "synthetic" }];
  const commissions = Array.from({ length: count }, (_, i) => ({ id: 9000 + i, capacitacion_id: 100,
    fecha_apertura_preinscripcion: "2026-01-01 08:00:00", fecha_cierre_preinscripcion: "2099-12-01 08:00:00" }));
  const baseline = await prepareFdciImports(courses, commissions);
  const items = structuredClone(baseline);
  for (let i = 0; i < events; i++) {
    const item = items[i % count];
    item.summary = `Novedad sintética ${i + 1}`;
    item.contentHash = await hashSourceSnapshot(item.id, { summary: item.summary });
  }
  return { baseline, items, uniqueChanges: Math.min(count, events), normalizationMs: performance.now() - start };
}

export const deltaSeed = items => items.map(item => {
  const values = [item.id, "Capacitación Docente", item.externalId, "capacitacion", item.category, item.title,
    item.status, item.officialUrl, item.metadata, item.contentHash, item.normalizedStatus];
  return `INSERT INTO publications(id,source,external_id,kind,category,title,status,official_url,metadata,content_hash,normalized_status)
    VALUES(${values.map(value => `'${value.replaceAll("'", "''")}'`).join(",")});`;
});

export async function deltaFixture(count = 30, events = 10) {
  const data = await deltaData(count, events), base = fdciLocalFixture();
  base.sqlite.exec(readFileSync("migrations/0034_fdci_delta_queue.sql", "utf8"));
  base.sqlite.exec(deltaSeed(data.baseline).join("\n"));
  const owner = "delta-local", secret = "synthetic_delta_secret_123456789012345";
  const target = { source: "fdci", name: "synthetic-canary", id: "synthetic-id",
    origin: "http://127.0.0.1:8798", endpoint: "http://127.0.0.1:8798/api/internal/fdci-import", secret };
  base.sqlite.exec("INSERT INTO import_gateway_identity VALUES(1,'synthetic-canary','synthetic-id'); INSERT INTO import_gate_lease VALUES(1,'fdci','2099-01-01T00:00:00Z','2026-01-01T00:00:00Z','delta-local')");
  const metrics = { queries: 0, returnedRows: 0, changedSqlRows: 0, gatewayRequests: 0, publicationRequests: 0 };
  const controls = { lostOp: null, failBatch: false };
  const wrap = stmt => ({ bind(...args) { return wrap(stmt.bind(...args)); },
    async first() { metrics.queries++; const r = await stmt.first(); metrics.returnedRows += Number(Boolean(r)); return r; },
    async all() { metrics.queries++; const r = await stmt.all(); metrics.returnedRows += r.results.length; return r; },
    async run() { metrics.queries++; const r = await stmt.run(); metrics.changedSqlRows += r.meta.changes; return r; } });
  const db = { prepare: sql => wrap(base.db.prepare(sql)), async batch(statements) {
    if (controls.failBatch) { controls.failBatch = false;
      return base.db.batch([statements[0], { run() { throw new Error("synthetic transaction failure"); } }]); }
    return base.db.batch(statements);
  } };
  const env = { DB: db, IMPORT_DATABASE_NAME: "synthetic-canary", IMPORT_DATABASE_ID: "synthetic-id",
    IMPORT_GATE_ENABLED: "false", IMPORT_GATE_LEASE_REQUIRED: "true", IMPORT_GATE_ALLOWED_SOURCE: "fdci",
    FDCI_EXTERNAL_ENABLED: "true", FDCI_IMPORT_SECRET: secret, FDCI_DELTA_ENABLED: "true" };
  const fetcher = async (url, init) => {
    if (new URL(url).origin !== target.origin) throw new Error("REMOTE_FORBIDDEN");
    metrics.gatewayRequests++;
    const op = init?.body ? JSON.parse(init.body).op : undefined;
    const isImport = new URL(url).pathname.endsWith("fdci-import");
    if (isImport) metrics.publicationRequests++;
    const r = await gateway.fetch(new Request(url, init), env);
    if (r.ok && controls.lostOp === (isImport ? "import" : op)) {
      controls.lostOp = null; throw new Error("synthetic lost response");
    }
    return r;
  };
  const collect = async () => ({ items: data.items, failures: 0 });
  const run = (collector = collect) => runDeltaFdci(target, { maxPublications: 2, owner }, fetcher, collector);
  return { ...base, data, env, db, owner, target, metrics, controls, fetcher, run,
    state: () => base.sqlite.prepare("SELECT * FROM fdci_delta_state WHERE id=1").get(),
    queue: () => base.sqlite.prepare("SELECT * FROM fdci_delta_queue ORDER BY seq").all() };
}
