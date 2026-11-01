// Small, source-specific HTTP imports. The runner never receives a Cloudflare API token.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { runIncrementalFdci } from "./fdci-incremental.mjs";
import { runSimeImport, parseSimeOptions } from "./import-sime.mjs";
import { runPublicSourceImport } from "./import-public-sources.mjs";
import { runJuntasCheckpoint } from "./import-juntas-checkpoint.mjs";
import { createJuntasGatewayDb } from "./juntas-gateway-db.mjs";
import { JUNTA_EXTERNAL_SOURCES } from "../lib/junta-external-sources.ts";

const productionId = "baaf5886-0123-4948-96da-aa7106424549";
const paths = { fdci: "/api/internal/fdci-import", sime: "/api/internal/sime-import",
  juntas: "/api/internal/public-source-import/juntas", cenet: "/api/internal/public-source-import/cenet", infd: "/api/internal/public-source-import/infd" };

export function resolveGatewayConfig(config, revision = "") {
  const source = config.SYNC_SOURCE, path = typeof source === "string" && Object.hasOwn(paths, source) ? paths[source] : null;
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
    { headers: { Authorization: `Bearer ${target.secret}` }, redirect: "error", signal: AbortSignal.timeout(20_000) }); }
  catch { throw new Error("GATEWAY_IDENTITY_UNAVAILABLE"); }
  if (!response.ok) throw new Error(`GATEWAY_IDENTITY_HTTP_${response.status}`);
  let body;
  try { body = await response.json(); } catch { throw new Error("GATEWAY_IDENTITY_INVALID"); }
  if (body?.id !== target.id || body?.name !== target.name) throw new Error("GATEWAY_IDENTITY_MISMATCH");
}

export async function runGatewayImport(target, config, sourceFetch = fetch, receiverFetch = fetch) {
  // These are ceilings, not tunables that can silently expand the pilot.
  const safety = target.source === "fdci" ? fdciSafety(config) : null;
  await verifyGatewayIdentity(target, receiverFetch);
  if (target.source === "fdci") {
    let requests = 0;
    const started = Date.now();
    const fetcher = async (url, init) => {
      const parsed = new URL(url);
      if (parsed.origin === target.origin) return receiverFetch(url, init);
      if (parsed.origin !== "https://apicapacitaciones.educaciontuc.edu.ar" || ![
        "/api/gestionCapas/getCapaActivas", "/api/gestionCapas/getRestoCapas", "/api/capa/getCupo",
      ].includes(parsed.pathname) || parsed.search || parsed.username || parsed.password) throw new Error("FDCI_SOURCE_FORBIDDEN");
      if (requests >= safety.maxRequests) throw new Error("FDCI_PROBE_REQUEST_LIMIT");
      if (requests) await new Promise((resolve, reject) => {
        const finish = () => { init?.signal?.removeEventListener("abort", abort); resolve(); };
        const timer = setTimeout(finish, safety.pauseMs);
        const abort = () => { clearTimeout(timer); init.signal.removeEventListener("abort", abort); reject(new Error("FDCI_CANCELLED")); };
        if (init?.signal?.aborted) abort(); else init?.signal?.addEventListener("abort", abort, { once: true });
      });
      requests++;
      return sourceFetch(url, { ...init, redirect: "error" });
    };
    try {
      return { ...await runIncrementalFdci(target, safety, fetcher), sourceRequests: requests, elapsedMs: Date.now() - started };
    } catch (error) {
      error.result = { ...error.result, sourceRequests: requests, elapsedMs: Date.now() - started };
      throw error;
    }
  }
  if (target.source === "sime") return runSimeImport({ endpoint: target.endpoint, token: target.secret,
    sourceFetch, receiverFetch, ...parseSimeOptions(config) });
  if (target.source === "juntas") {
    const root = config.JUNTA_ROOT_ID;
    const sources = root ? JUNTA_EXTERNAL_SOURCES.filter(([id]) => id === root) : JUNTA_EXTERNAL_SOURCES;
    if (!sources.length) throw new Error("JUNTAS_ROOT_INVALID");
    const requestBudget = Number(config.JUNTAS_MAX_REQUESTS || 25);
    const writeBudget = Number(config.JUNTAS_MAX_PUBLICATION_WRITES || 20);
    return runJuntasCheckpoint({ db: createJuntasGatewayDb(target, receiverFetch), driveKey: config.GOOGLE_DRIVE_API_KEY,
      sourceFetch, sources, maxRequests: requestBudget, maxPublicationWrites: writeBudget,
      receiverOverride: { token: target.secret, endpoint: (path) => `${target.origin}${path}`, receiverFetch } });
  }
  return runPublicSourceImport({ source: target.source, endpoint: target.endpoint, token: target.secret,
    sourceFetch, receiverFetch });
}

export function fdciSafety(config) {
  if (config.FDCI_SCOPE !== "active") throw new Error("FDCI_ACTIVE_SCOPE_REQUIRED");
  const owner = config.IMPORT_GATE_RUN_ID || (config.GITHUB_RUN_ID ? `${config.GITHUB_RUN_ID}-${config.GITHUB_RUN_ATTEMPT || "1"}` : "");
  if (!/^[A-Za-z0-9_:-]{1,100}$/.test(owner)) throw new Error("GATE_RUN_ID_REQUIRED");
  const maxRequests = Number(config.FDCI_MAX_REQUESTS || 6);
  const maxPublications = Number(config.FDCI_MAX_PUBLICATIONS || 5);
  const pauseMs = Number(config.FDCI_PAUSE_MS || 400);
  if (!Number.isInteger(maxRequests) || maxRequests < 2 || maxRequests > 6 ||
      !Number.isInteger(maxPublications) || maxPublications < 1 || maxPublications > 5 ||
      !Number.isInteger(pauseMs) || pauseMs < 400 || pauseMs > 1000) throw new Error("FDCI_BUDGET_INVALID");
  return { maxRequests, maxPublications, pauseMs, owner };
}

// Never serialize arbitrary exceptions, remote bodies, headers, URLs or config.
export function safeImportError(error) {
  const code = /^[A-Z_0-9]+$/.test(error?.message || "") ? error.message : "GATEWAY_IMPORT_FAILED";
  const result = {};
  for (const key of ["discovered", "created", "updated", "unchanged", "rejected", "skipped", "deferred", "uncertain", "batches", "sourceRequests", "elapsedMs"])
    result[key] = Number.isSafeInteger(error?.result?.[key]) && error.result[key] >= 0 ? error.result[key] : 0;
  const sourceErrors = {};
  for (const key of ["orphanActive", "missingTokenOrSlug", "timeoutOrNetwork", "invalidJson", "schema", "other", "activeDetailFailures", "requestLimit"])
    if (Number.isSafeInteger(error?.diagnostics?.[key]) && error.diagnostics[key] > 0) sourceErrors[key] = error.diagnostics[key];
  for (const [key, value] of Object.entries(error?.diagnostics?.http || {}))
    if (/^HTTP_\d{3}$/.test(key) && Number.isSafeInteger(value) && value > 0) sourceErrors[key] = value;
  const rejectedReasons = {};
  for (const [key, value] of Object.entries(error?.diagnostics?.rejectedReasons || {}))
    if (/^(?:record|identity|hash|status|circuit|circuitConfidence|url|metadata|metadataOrUrl|receiverHttp400|protectedExistingRecord|text:(?:category|title|summary|level|area|location|character|status|metadata|contentHash|circuit|sourceCircuitRaw|circuitInferenceSource)|date:(?:startsAt|endsAt|sourceUpdatedAt|registrationOpenAt|registrationCloseAt|expiresAt))$/.test(key) &&
        Number.isSafeInteger(value) && value > 0) rejectedReasons[key] = value;
  const cursor = error?.result?.cursor;
  const safeCursor = cursor && Number.isSafeInteger(cursor.revision) && Number.isSafeInteger(cursor.cycle) &&
    [cursor.after_key, cursor.upper_key].every(k => k === "" || typeof k === "string" && /^\d{12}:\d{12}$/.test(k))
    ? { revision: cursor.revision, cycle: cursor.cycle, after_key: cursor.after_key, upper_key: cursor.upper_key } : undefined;
  return { status: ["FDCI_PARTIAL_SOURCE", "FDCI_SELECTION_INCOMPLETE", "FDCI_PROBE_REQUEST_LIMIT", "HTTP_429", "FDCI_EMPTY_RESPONSE"].includes(code)
    ? "PARTIAL" : "ERROR", code, ...result, ...(safeCursor ? { cursor: safeCursor } : {}), sourceErrors, rejectedReasons, completed: false };
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
    console.log(JSON.stringify(safeImportError(error)));
    process.exitCode = 1;
  }
}
