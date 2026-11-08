// Reuse existing authentication, identity, leases and narrow receivers in a separate Worker.
// The retired FDCI Worker is never changed or reopened by this entry point.
import gateway from "./source-import-gateway.mjs";
const sources = new Set(["sime", "infd", "cenet"]);
const routes = new Set(["/api/internal/import-identity", "/api/internal/import-gate", "/api/internal/sime-import",
  ...["infd", "cenet"].map(s => `/api/internal/public-source-import/${s}`)]);
const dailyGateway = { async fetch(request, env) {
  const url = new URL(request.url);
  if (env.DAILY_SOURCES_ENABLED !== "true" || env.DAILY_RECEIVER_NAME !== "docentetuc-sources-1-2" ||
      env.DAILY_PRODUCTION_APPROVED !== 'true' || env.IMPORT_DATABASE_NAME !== 'docentetuc-db' ||
      env.IMPORT_DATABASE_ID !== 'baaf5886-0123-4948-96da-aa7106424549' ||
      env.IMPORT_GATE_ENABLED !== "false" || env.IMPORT_GATE_LEASE_REQUIRED !== "true")
    return Response.json({ error: "DAILY_DISABLED" }, { status: 503 });
  if (!routes.has(url.pathname) || url.pathname.endsWith("import-identity") && !sources.has(url.searchParams.get("source")))
    return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  if (url.pathname === "/api/internal/import-gate") {
    if (Number(request.headers.get("content-length") || 0) > 1024) return new Response(null, { status: 413 });
    // The existing bounded body reader remains authoritative. Do not read an unbounded clone.
    const reader = request.body?.getReader(); let bytes = 0, text = "";
    if (!reader) return new Response(null, { status: 400 });
    try {
      const decoder = new TextDecoder();
      while (true) { const { done, value } = await reader.read(); if (done) break;
        bytes += value.byteLength; if (bytes > 1024) { await reader.cancel(); return new Response(null, { status: 413 }); }
        text += decoder.decode(value, { stream: true }); }
      const body = JSON.parse(text + decoder.decode());
      if (!sources.has(body.source) || body.action === "open" &&
          (!Number.isInteger(body.ttlSeconds) || body.ttlSeconds < 60 || body.ttlSeconds > 600)) return new Response(null, { status: 400 });
      request = new Request(request.url, { method: request.method, headers: request.headers, body: text });
    } catch { return new Response(null, { status: 400 }); }
  }
  return gateway.fetch(request, { ...env, FDCI_EXTERNAL_ENABLED: "false", FDCI_AUTOMATION_ENABLED: "false", FDCI_DELTA_ENABLED: "false" });
} };
export default dailyGateway;
