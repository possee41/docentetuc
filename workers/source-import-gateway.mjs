// Independent, disabled-by-default import gateway. Node sends publications, never SQL.
import fdci, { receiveAuthenticatedFdci } from "./fdci-receiver.mjs";
import sime from "./sime-receiver.mjs";
import publicSources from "./public-source-receiver.mjs";
import juntasCheckpoint from "./juntas-checkpoint-gateway.mjs";
import { fdciCheckpoint } from "./fdci-checkpoint.mjs";
import { automationRequest } from "./fdci-automation.mjs";
import { fdciDelta } from "./fdci-delta.mjs";

const routes = new Map([
  ["/api/internal/fdci-import", ["FDCI_IMPORT_SECRET", fdci]],
  ["/api/internal/fdci-checkpoint", ["FDCI_IMPORT_SECRET", null]],
  ["/api/internal/fdci-delta", ["FDCI_IMPORT_SECRET", null]],
  ["/api/internal/sime-import", ["SIME_IMPORT_SECRET", sime]],
  ["/api/internal/public-source-import/juntas", ["JUNTAS_IMPORT_SECRET", publicSources]],
  ["/api/internal/juntas-checkpoint", ["JUNTAS_IMPORT_SECRET", juntasCheckpoint]],
  ["/api/internal/public-source-import/cenet", ["CENET_IMPORT_SECRET", publicSources]],
  ["/api/internal/public-source-import/infd", ["INFD_IMPORT_SECRET", publicSources]],
]);
const paths = { fdci: "/api/internal/fdci-import", sime: "/api/internal/sime-import",
  juntas: "/api/internal/public-source-import/juntas", cenet: "/api/internal/public-source-import/cenet",
  infd: "/api/internal/public-source-import/infd" };
const GATE_PATH = "/api/internal/import-gate";
const LEASE_MIN_SECONDS = 60, LEASE_MAX_SECONDS = 900, LEASE_DEFAULT_SECONDS = 600;
const noStore = { "Cache-Control": "no-store" };
const reply = (status, code) => Response.json({ error: code }, { status, headers: noStore });
const sourceByPath = new Map(Object.entries(paths).map(([source, path]) => [path, source]));
const encoder = new TextEncoder();
const secrets = new Map();
const secretDigest = (secret) => {
  let digest = secrets.get(secret);
  if (!digest) { digest = crypto.subtle.digest("SHA-256", encoder.encode(secret)); if (secrets.size < 8) secrets.set(secret, digest); }
  return digest;
};

async function authorized(header, secret) {
  const token = header?.match(/^Bearer ([A-Za-z0-9_-]{32,})$/)?.[1];
  if (!secret || !token) return false;
  const [expected, actual] = await Promise.all([secretDigest(secret), crypto.subtle.digest("SHA-256", encoder.encode(token))]);
  const a = new Uint8Array(expected), b = new Uint8Array(actual);
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
  return difference === 0;
}

// A lease makes the open state self-expiring: even if the runner never closes
// it, the gateway refuses imports once the stored deadline passes.
const leaseMode = (env) => env.IMPORT_GATE_LEASE_REQUIRED === "true";
const configured = (env) => Boolean(env.DB && env.IMPORT_DATABASE_NAME && env.IMPORT_DATABASE_ID);
const validOwner = (value) => typeof value === "string" && /^[A-Za-z0-9_:-]{1,100}$/.test(value);

async function leaseBody(request, maxBytes = 1024) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return { error: reply(415, "GATE_JSON_REQUIRED") };
  if (Number(request.headers.get("content-length") || 0) > maxBytes) return { error: reply(413, "GATE_REQUEST_TOO_LARGE") };
  const reader = request.body?.getReader();
  if (!reader) return { error: reply(400, "GATE_REQUEST_INVALID") };
  let body = "", size = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); return { error: reply(413, "GATE_REQUEST_TOO_LARGE") }; }
      body += decoder.decode(value, { stream: true });
    }
    return { payload: JSON.parse(body + decoder.decode()) };
  } catch { return { error: reply(400, "GATE_REQUEST_INVALID") }; }
}

async function readLease(env) {
  try { return await env.DB.prepare("SELECT source,expires_at,opened_at,opened_by FROM import_gate_lease WHERE id=1").first(); }
  catch { return undefined; }
}

function leaseValid(lease, source) {
  if (!lease || lease.source !== source) return false;
  const expires = Date.parse(String(lease.expires_at));
  return Number.isFinite(expires) && expires > Date.now();
}

async function verifyIdentity(env, expected) {
  let identity;
  try { identity = await env.DB.prepare("SELECT database_name,database_id FROM import_gateway_identity WHERE id=1").first(); }
  catch { return { error: reply(503, "DATABASE_IDENTITY_UNAVAILABLE") }; }
  if (identity?.database_name !== expected.name || identity?.database_id !== expected.id)
    return { error: reply(503, "DATABASE_IDENTITY_MISMATCH") };
  return { identity };
}

async function handleLease(request, env) {
  if (request.method !== "POST") return reply(405, "METHOD_NOT_ALLOWED");
  if (!leaseMode(env) || !configured(env)) return reply(503, "IMPORT_DISABLED");
  const parsed = await leaseBody(request);
  if (parsed.error) return parsed.error;
  const payload = parsed.payload;
  const source = payload?.source, action = payload?.action;
  const owner = payload?.owner;
  const secretName = typeof source === "string" && Object.hasOwn(paths, source) ? routes.get(paths[source])[0] : null;
  if (!secretName || (action !== "open" && action !== "close")) return reply(400, "GATE_REQUEST_INVALID");
  if (!validOwner(owner)) return reply(400, "GATE_OWNER_INVALID");
  if (source === "fdci" && action === "open" &&
      payload.ttlSeconds !== undefined && (!Number.isInteger(payload.ttlSeconds) || payload.ttlSeconds < 60 || payload.ttlSeconds > 600))
    return reply(400, "FDCI_TTL_INVALID");
  if (env.IMPORT_GATE_ALLOWED_SOURCE && env.IMPORT_GATE_ALLOWED_SOURCE !== source) return reply(503, "IMPORT_DISABLED");
  if (!await authorized(request.headers.get("authorization"), env[secretName])) return reply(401, "UNAUTHORIZED");
  const expected = { name: env.IMPORT_DATABASE_NAME, id: env.IMPORT_DATABASE_ID };
  const checked = await verifyIdentity(env, expected);
  if (checked.error) return checked.error;

  const existing = await readLease(env);
  if (existing === undefined) return reply(503, "GATE_UNAVAILABLE");
  if (action === "close") {
    try {
      await env.DB.prepare("DELETE FROM import_gate_lease WHERE id=1 AND source=? AND opened_by=?").bind(source, owner).run();
      const remaining = await readLease(env);
      if (remaining === undefined) return reply(503, "GATE_UNAVAILABLE");
      if (remaining !== null) return reply(409, "GATE_BUSY");
    }
    catch { return reply(503, "GATE_UNAVAILABLE"); }
    return Response.json({ ok: true, source, owner, closed: true }, { headers: noStore });
  }
  if (existing && leaseValid(existing, existing.source)) {
    if (existing.source !== source || existing.opened_by !== owner) return reply(409, "GATE_BUSY");
    return Response.json({ ok: true, source, owner, openedAt: existing.opened_at, expiresAt: existing.expires_at }, { headers: noStore });
  }
  const requested = Number(payload?.ttlSeconds);
  const ttl = Math.min(LEASE_MAX_SECONDS, Math.max(LEASE_MIN_SECONDS,
    Number.isFinite(requested) && requested > 0 ? Math.round(requested) : LEASE_DEFAULT_SECONDS));
  const openedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  try {
    const result = await env.DB.prepare(`INSERT INTO import_gate_lease (id,source,expires_at,opened_at,opened_by)
      VALUES (1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source=excluded.source,expires_at=excluded.expires_at,
      opened_at=excluded.opened_at,opened_by=excluded.opened_by
      WHERE julianday(import_gate_lease.expires_at)<=julianday(?)`)
      .bind(source, expiresAt, openedAt, owner, openedAt).run();
    if (Number(result.meta?.changes) !== 1) return reply(409, "GATE_BUSY");
  } catch { return reply(503, "GATE_UNAVAILABLE"); }
  return Response.json({ ok: true, source, owner, openedAt, expiresAt }, { headers: noStore });
}

const gateway = { async fetch(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/internal/fdci-delta" && env.FDCI_DELTA_ENABLED !== "true") return reply(503, "DELTA_DISABLED");
  if (url.pathname.startsWith("/api/internal/fdci-automation/"))
    return automationRequest(request, env, authorized, (next, scopedEnv) => gateway.fetch(next, scopedEnv));
  if (url.pathname === GATE_PATH) return handleLease(request, env);
  const identityRequest = url.pathname === "/api/internal/import-identity" && request.method === "GET";
  if (url.search && url.pathname !== "/api/internal/sime-import" && !identityRequest) return reply(404, "NOT_FOUND");
  const source = url.searchParams.get("source");
  const route = identityRequest ? (Object.hasOwn(paths, source) ? routes.get(paths[source]) : null) : routes.get(url.pathname);
  if (!route) return reply(404, "NOT_FOUND");
  if (!configured(env)) return reply(503, "IMPORT_DISABLED");
  // Lease mode arms the endpoint without leaving a permanent open gate: each
  // import still needs an unexpired lease created by an authenticated runner.
  if (env.IMPORT_GATE_ENABLED !== "true" && !leaseMode(env)) return reply(503, "IMPORT_DISABLED");
  const requestedSource = identityRequest ? url.searchParams.get("source") :
    url.pathname === "/api/internal/juntas-checkpoint" ? "juntas" :
    ["/api/internal/fdci-checkpoint", "/api/internal/fdci-delta"].includes(url.pathname) ? "fdci" : sourceByPath.get(url.pathname);
  if (env.IMPORT_GATE_ALLOWED_SOURCE && env.IMPORT_GATE_ALLOWED_SOURCE !== requestedSource)
    return reply(503, "IMPORT_DISABLED");
  const [secretName, receiver] = route;
  if (!await authorized(request.headers.get("authorization"), env[secretName])) return reply(401, "UNAUTHORIZED");
  const expected = { name: env.IMPORT_DATABASE_NAME, id: env.IMPORT_DATABASE_ID };
  const checked = await verifyIdentity(env, expected);
  if (checked.error) return checked.error;
  if (identityRequest) return Response.json({ name: checked.identity.database_name, id: checked.identity.database_id },
    { headers: noStore });
  let owner;
  if (leaseMode(env)) {
    const lease = await readLease(env);
    if (!leaseValid(lease, requestedSource)) return reply(503, "IMPORT_DISABLED");
    owner = request.headers.get("x-import-gate-owner");
    if (!validOwner(owner) || lease.opened_by !== owner) return reply(409, "GATE_OWNER_MISMATCH");
  }
  if (url.pathname === "/api/internal/fdci-delta") {
    if (!leaseMode(env)) return reply(503, "IMPORT_DISABLED");
    if (request.method !== "POST") return reply(405, "METHOD_NOT_ALLOWED");
    const parsed = await leaseBody(request, 150_000);
    return parsed.error || fdciDelta(parsed.payload, env.DB, owner);
  }
  if (url.pathname === "/api/internal/fdci-checkpoint") {
    if (!leaseMode(env)) return reply(503, "IMPORT_DISABLED");
    if (request.method !== "POST") return reply(405, "METHOD_NOT_ALLOWED");
    const parsed = await leaseBody(request);
    return parsed.error || fdciCheckpoint(parsed.payload, env.DB, owner);
  }
  return receiver === fdci ? receiveAuthenticatedFdci(request, env) : receiver.fetch(request, env);
} };
export default gateway;
