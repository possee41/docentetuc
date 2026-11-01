// Canary-only measurement wrapper. No production identity or additional operations.
import gateway from "./source-import-gateway.mjs";

const canary = { async fetch(request, env) {
  if (env.IMPORT_DATABASE_ID !== "853e2f5d-89b1-46a3-9c1c-5cbd46784756" ||
      env.IMPORT_DATABASE_NAME !== "docentetuc-web-canary-1-2" || !env.DB)
    return new Response("CANARY_IDENTITY_REQUIRED", { status: 503 });
  const metrics = { rpc: 0, queries: 0, rowsRead: 0, rowsWritten: 0 };
  const record = result => {
    const m = result.meta;
    if (!Number.isSafeInteger(m?.rows_read) || !Number.isSafeInteger(m?.rows_written)) throw new Error("CANARY_D1_META_INVALID");
    metrics.rowsRead += m.rows_read; metrics.rowsWritten += m.rows_written;
    return result;
  };
  const wrap = raw => ({ raw,
    bind: (...args) => wrap(raw.bind(...args)),
    async all() { metrics.rpc++; metrics.queries++; return record(await raw.all()); },
    async first() { const result = await this.all(); return result.results[0] ?? null; },
    async run() { metrics.rpc++; metrics.queries++; return record(await raw.run()); },
  });
  const db = { prepare: sql => wrap(env.DB.prepare(sql)), async batch(statements) {
    metrics.rpc++; metrics.queries += statements.length;
    return (await env.DB.batch(statements.map(s => s.raw))).map(record);
  } };
  const started = performance.now();
  const response = await gateway.fetch(request, { ...env, DB: db });
  const step = request.headers.get("x-canary-step") || "unlabelled";
  const report = { event: "fdci_lease_canary", step: /^[a-z0-9-]{1,48}$/.test(step) ? step : "invalid",
    version: env.VERSION_METADATA?.id || null, status: response.status, d1: metrics, wallMs: performance.now() - started };
  console.log(JSON.stringify(report));
  const headers = new Headers(response.headers);
  headers.set("X-Canary-Metrics", JSON.stringify(metrics));
  headers.set("X-Canary-Version", report.version || "unknown");
  return new Response(response.body, { status: response.status, headers });
} };
export default canary;
