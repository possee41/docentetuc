// Opens and closes the self-expiring import lease. The runner never holds a
// Cloudflare API token: it only presents the source secret to the gateway.
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { resolveGatewayConfig, verifyGatewayIdentity, runGatewayImport, fdciSafety, safeImportError } from "./import-via-gateway.mjs";

const paths = { fdci: "/api/internal/fdci-import", sime: "/api/internal/sime-import",
  juntas: "/api/internal/public-source-import/juntas", cenet: "/api/internal/public-source-import/cenet",
  infd: "/api/internal/public-source-import/infd" };

export function resolveGateConfig(config) {
  const source = config.SYNC_SOURCE;
  if (typeof source !== "string" || !Object.hasOwn(paths, source)) throw new Error("GATE_SOURCE_INVALID");
  let origin;
  try { origin = new URL(config.IMPORT_GATEWAY_ORIGIN); }
  catch { throw new Error("GATE_CONFIG_INVALID"); }
  if (origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password ||
      !(origin.protocol === "https:" && /^docentetuc-import-(?:canary-1-2|1-2)\.[a-z0-9-]+\.workers\.dev$/.test(origin.hostname) ||
        origin.protocol === "http:" && origin.hostname === "127.0.0.1")) throw new Error("GATE_CONFIG_INVALID");
  const secret = config[`${source.toUpperCase()}_IMPORT_SECRET`];
  if (!/^[A-Za-z0-9_-]{32,}$/.test(secret || "")) throw new Error("GATE_SECRET_INVALID");
  const ttlSeconds = Number(config.IMPORT_GATE_TTL_SECONDS || 600);
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 600) throw new Error("GATE_TTL_INVALID");
  const owner = config.IMPORT_GATE_RUN_ID || (config.GITHUB_RUN_ID ? `${config.GITHUB_RUN_ID}-${config.GITHUB_RUN_ATTEMPT || "1"}` : "");
  if (!/^[A-Za-z0-9_:-]{1,100}$/.test(owner)) throw new Error("GATE_RUN_ID_REQUIRED");
  return { source, endpoint: new URL("/api/internal/import-gate", origin).toString(), secret, ttlSeconds, owner };
}

export async function callGate(action, config, fetcher = fetch, revision = "") {
  if (action !== "open" && action !== "close") throw new Error("GATE_ACTION_INVALID");
  const target = resolveGateConfig(config);
  resolveGatewayConfig(config, revision);
  let response;
  try {
    response = await fetcher(target.endpoint, { method: "POST",
      headers: { authorization: `Bearer ${target.secret}`, "content-type": "application/json" },
      body: JSON.stringify({ source: target.source, action, ttlSeconds: target.ttlSeconds, owner: target.owner }),
      redirect: "error", signal: AbortSignal.timeout(20_000) });
  } catch { throw new Error("GATE_UNAVAILABLE"); }
  if (!response.ok) throw new Error(`GATE_HTTP_${response.status}`);
  let body;
  try { body = await response.json(); } catch { throw new Error("GATE_RESPONSE_INVALID"); }
  if (body?.source !== target.source || body?.owner !== target.owner) throw new Error("GATE_RESPONSE_INVALID");
  if (action === "open" && (body?.ok !== true || !Number.isFinite(Date.parse(body?.expiresAt)) || Date.parse(body.expiresAt) <= Date.now()))
    throw new Error("GATE_RESPONSE_INVALID");
  if (action === "close" && (body?.ok !== true || body?.closed !== true)) throw new Error("GATE_RESPONSE_INVALID");
  return { source: target.source, action, expiresAt: body.expiresAt || null };
}

export async function preflightFdciJob(config, revision, fetcher = fetch) {
  if (config.IMPORT_GATEWAY_ENABLED !== "true" || config.SYNC_SOURCE !== "fdci") throw new Error("GATE_DISABLED");
  const target = resolveGatewayConfig(config, revision);
  resolveGateConfig(config);
  fdciSafety(config);
  await verifyGatewayIdentity(target, fetcher);
  return target;
}

export async function runFdciGatewayJob(config, revision, sourceFetch = fetch, receiverFetch = fetch, signal) {
  let attempted = false, result;
  const cancellable = (fetcher) => (url, init = {}) => {
    if (signal?.aborted) throw new Error("FDCI_CANCELLED");
    return fetcher(url, { ...init, signal: signal ? AbortSignal.any([signal, ...(init.signal ? [init.signal] : [])]) : init.signal });
  };
  try {
    if (signal?.aborted) throw new Error("FDCI_CANCELLED");
    const target = await preflightFdciJob(config, revision, cancellable(receiverFetch));
    if (signal?.aborted) throw new Error("FDCI_CANCELLED");
    attempted = true;
    await callGate("open", config, receiverFetch, revision);
    if (signal?.aborted) throw new Error("FDCI_CANCELLED");
    result = { status: "OK", ...await runGatewayImport(target, { ...config,
      IMPORT_GATE_RUN_ID: resolveGateConfig(config).owner }, cancellable(sourceFetch), cancellable(receiverFetch)) };
  } catch (error) { result = safeImportError(error); }
  finally {
    // Also close after an ambiguous open ACK. Never retry open or an import.
    if (attempted) {
      try { await callGate("close", config, receiverFetch, revision); result.closed = true; }
      catch (error) { result = { ...result, status: "ERROR", closed: false, closeCode: safeImportError(error).code }; }
    } else result.closed = null;
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.env.IMPORT_GATEWAY_ENABLED !== "true") throw new Error("GATE_DISABLED");
    const action = process.argv[2] || "open";
    const revision = process.env.IMPORT_GATEWAY_TARGET === "production"
      ? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() : "";
    if (action === "preflight") {
      await preflightFdciJob(process.env, revision);
      console.log(JSON.stringify({ ok: true, preflight: true }));
    } else if (action === "run") {
      const controller = new AbortController();
      const abort = () => controller.abort();
      process.once("SIGTERM", abort); process.once("SIGINT", abort);
      const result = await runFdciGatewayJob(process.env, revision, fetch, fetch, controller.signal);
      console.log(JSON.stringify(result));
      if (result.closed !== true || !(result.status === "OK" || result.status === "PARTIAL" && result.progressPending === true && result.failed === false)) process.exitCode = 1;
    } else console.log(JSON.stringify(await callGate(action, process.env, fetch, revision)));
  } catch (error) {
    console.error("GATE_CALL_FAILED", error instanceof Error && /^[A-Z_0-9]+$/.test(error.message)
      ? error.message : "GATE_CALL_FAILED");
    process.exitCode = 1;
  }
}
