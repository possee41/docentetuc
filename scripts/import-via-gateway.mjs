// Small, source-specific HTTP imports. The runner never receives a Cloudflare API token.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { runSimeImport, parseSimeOptions } from "./import-sime.mjs";





const productionId = "baaf5886-0123-4948-96da-aa7106424549";
const paths = { fdci: "/api/internal/fdci-import", sime: "/api/internal/sime-import",
  juntas: "/api/internal/public-source-import/juntas", cenet: "/api/internal/public-source-import/cenet", infd: "/api/internal/public-source-import/infd" };

export function resolveGatewayConfig(config, revision = "") {
  const source = config.SYNC_SOURCE, path = paths[source];
  if (!path) throw new Error("GATEWAY_SOURCE_INVALID");
  let origin;
  try { origin = new URL(config.IMPORT_GATEWAY_ORIGIN); } catch { throw new Error("GATEWAY_CONFIG_INVALID"); }
  if (origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password ||
      !(origin.protocol === "https:" && /^docentetuc-import-(?:canary-1-2|1-2)\.[a-z0-9-]+\.workers\.dev$/.test(origin.hostname) ||
        origin.protocol === "http:" && origin.hostname === "127.0.0.1")) throw new Error("GATEWAY_CONFIG_INVALID");
  const target = config.IMPORT_GATEWAY_TARGET || "canary";
  const id = config.IMPORT_GATEWAY_DATABASE_ID, name = config.IMPORT_GATEWAY_DATABASE_NAME;
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id || "") || !name)
    throw new Error("GATEWAY_CONFIG_INVALID");
  if (target === "canary") {
    if (id === productionId || !/^docentetuc-[a-z0-9-]*canary[a-z0-9-]*$/.test(name) ||
        (origin.protocol !== "http:" && !origin.hostname.startsWith("docentetuc-import-canary-1-2.")))
      throw new Error("GATEWAY_TARGET_FORBIDDEN");
  } else if (target !== "production" || id !== productionId || name !== "docentetuc-db" ||
      origin.protocol !== "https:" || !origin.hostname.startsWith("docentetuc-import-1-2.") ||
      config.IMPORT_GATEWAY_PRODUCTION_ENABLED !== "true" ||
      !/^[a-f0-9]{40}$/i.test(config.IMPORT_GATEWAY_APPROVED_SHA || "") ||
      config.IMPORT_GATEWAY_APPROVED_SHA.toLowerCase() !== revision.toLowerCase())
    throw new Error("GATEWAY_PRODUCTION_NOT_APPROVED");
  const secret = config[`${source.toUpperCase()}_IMPORT_SECRET`];
  if (!/^[A-Za-z0-9_-]{32,}$/.test(secret || "")) throw new Error("GATEWAY_SECRET_INVALID");
  return { source, endpoint: new URL(path, origin).toString(), origin: origin.origin, id, name, secret };
}

export async function verifyGatewayIdentity(target, fetcher = fetch) {
  let response;
  try { response = await fetcher(`${target.origin}/api/internal/import-identity?source=${target.source}`,
    { headers: { Authorization: `Bearer ${target.secret}` }, signal: AbortSignal.timeout(20_000) }); }
  catch { throw new Error("GATEWAY_IDENTITY_UNAVAILABLE"); }
  if (!response.ok) throw new Error(`GATEWAY_IDENTITY_HTTP_${response.status}`);
  let body;
  try { body = await response.json(); } catch { throw new Error("GATEWAY_IDENTITY_INVALID"); }
  if (body?.id !== target.id || body?.name !== target.name) throw new Error("GATEWAY_IDENTITY_MISMATCH");
}

export async function runGatewayImport(target, config, sourceFetch = fetch, receiverFetch = fetch) {
  await verifyGatewayIdentity(target, receiverFetch);
  if (target.source === "fdci") {
    const { runFdciImport } = await import("./import-fdci.mjs");
    const scope = config.FDCI_SCOPE || "single";
    return runFdciImport({ endpoint: target.endpoint, token: target.secret,
      selection: scope === "single" ? { token: config.FDCI_COURSE_TOKEN || "",
        slug: config.FDCI_COURSE_SLUG || "", commissionId: config.FDCI_COMMISSION_ID || "" } : undefined,
      scope, fetcher: (url, init) => String(url).startsWith(target.origin) ? receiverFetch(url, init) : sourceFetch(url, init) });
  }
  if (target.source === "sime") return runSimeImport({ endpoint: target.endpoint, token: target.secret,
    sourceFetch, receiverFetch, ...parseSimeOptions(config) });
  if (target.source === "juntas") {
    const { runJuntasCheckpoint } = await import("./import-juntas-checkpoint.mjs");
    const { createJuntasGatewayDb } = await import("./juntas-gateway-db.mjs");
    const { JUNTA_EXTERNAL_SOURCES } = await import("../lib/junta-external-sources.ts");
    const root = config.JUNTA_ROOT_ID;
    const sources = root ? JUNTA_EXTERNAL_SOURCES.filter(([id]) => id === root) : JUNTA_EXTERNAL_SOURCES;
    if (!sources.length) throw new Error("JUNTAS_ROOT_INVALID");
    const requestBudget = Number(config.JUNTAS_MAX_REQUESTS || 25);
    const writeBudget = Number(config.JUNTAS_MAX_PUBLICATION_WRITES || 20);
    return runJuntasCheckpoint({ db: createJuntasGatewayDb(target, receiverFetch), driveKey: config.GOOGLE_DRIVE_API_KEY,
      sourceFetch, sources, maxRequests: requestBudget, maxPublicationWrites: writeBudget,
      receiverOverride: { token: target.secret, endpoint: (path) => `${target.origin}${path}`, receiverFetch } });
  }
  const { runPublicSourceImport } = await import("./import-public-sources.mjs");
  return runPublicSourceImport({ source: target.source, endpoint: target.endpoint, token: target.secret,
    sourceFetch, receiverFetch });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.env.IMPORT_GATEWAY_ENABLED !== "true") throw new Error("GATEWAY_DISABLED");
    const revision = process.env.IMPORT_GATEWAY_TARGET === "production"
      ? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() : "";
    const target = resolveGatewayConfig(process.env, revision);
    console.log(JSON.stringify({ source: target.source, ...await runGatewayImport(target, process.env) }));
  } catch (error) {
    // Do not print response bodies, URLs, authorization headers or tokens.
    console.error("GATEWAY_IMPORT_FAILED", error instanceof Error && /^[A-Z_0-9]+$/.test(error.message)
      ? error.message : "GATEWAY_IMPORT_FAILED");
    process.exitCode = 1;
  }
}
