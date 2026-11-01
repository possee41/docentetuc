// Opens and closes the self-expiring import lease. The runner never holds a
// Cloudflare API token: it only presents the source secret to the gateway.
import { pathToFileURL } from "node:url";

const paths = { fdci: "/api/internal/fdci-import", sime: "/api/internal/sime-import",
  juntas: "/api/internal/public-source-import/juntas", cenet: "/api/internal/public-source-import/cenet",
  infd: "/api/internal/public-source-import/infd" };

export function resolveGateConfig(config) {
  const source = config.SYNC_SOURCE;
  if (!paths[source]) throw new Error("GATE_SOURCE_INVALID");
  let origin;
  try { origin = new URL(config.IMPORT_GATEWAY_ORIGIN); }
  catch { throw new Error("GATE_CONFIG_INVALID"); }
  if (origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password ||
      !(origin.protocol === "https:" && /^docentetuc-import-(?:canary-1-2|1-2)\.[a-z0-9-]+\.workers\.dev$/.test(origin.hostname) ||
        origin.protocol === "http:" && origin.hostname === "127.0.0.1")) throw new Error("GATE_CONFIG_INVALID");
  const secret = config[`${source.toUpperCase()}_IMPORT_SECRET`];
  if (!/^[A-Za-z0-9_-]{32,}$/.test(secret || "")) throw new Error("GATE_SECRET_INVALID");
  const ttlSeconds = Number(config.IMPORT_GATE_TTL_SECONDS || 600);
  const owner = config.IMPORT_GATE_RUN_ID || (config.GITHUB_RUN_ID ? `${config.GITHUB_RUN_ID}-${config.GITHUB_RUN_ATTEMPT || "1"}` : "");
  if (!/^[A-Za-z0-9_:-]{1,100}$/.test(owner)) throw new Error("GATE_RUN_ID_REQUIRED");
  return { source, endpoint: new URL("/api/internal/import-gate", origin).toString(), secret, ttlSeconds, owner };
}

export async function callGate(action, config, fetcher = fetch) {
  if (action !== "open" && action !== "close") throw new Error("GATE_ACTION_INVALID");
  const target = resolveGateConfig(config);
  let response;
  try {
    response = await fetcher(target.endpoint, { method: "POST",
      headers: { authorization: `Bearer ${target.secret}`, "content-type": "application/json" },
      body: JSON.stringify({ source: target.source, action, ttlSeconds: target.ttlSeconds, owner: target.owner }),
      signal: AbortSignal.timeout(20_000) });
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.env.IMPORT_GATEWAY_ENABLED !== "true") throw new Error("GATE_DISABLED");
    const action = process.argv[2] || "open";
    console.log(JSON.stringify(await callGate(action, process.env)));
  } catch (error) {
    console.error("GATE_CALL_FAILED", error instanceof Error && /^[A-Z_0-9]+$/.test(error.message)
      ? error.message : "GATE_CALL_FAILED");
    process.exitCode = 1;
  }
}
