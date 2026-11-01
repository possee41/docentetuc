// Independent, disabled-by-default import gateway. Node sends publications, never SQL.
import fdci from "./fdci-receiver.mjs";
import sime from "./sime-receiver.mjs";
import publicSources from "./public-source-receiver.mjs";
import juntasCheckpoint from "./juntas-checkpoint-gateway.mjs";

const routes = new Map([
  ["/api/internal/fdci-import", ["FDCI_IMPORT_SECRET", fdci]],
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

async function readLease(env) {
  try { return await env.DB.prepare("SELECT source,expires_at FROM import_gate_lease WHERE id=1").first(); }
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
  let payload;
  try { payload = await request.json(); }
  catch { return reply(400, "GATE_REQUEST_INVALID"); }
  const source = payload?.source, action = payload?.action;
  const secretName = paths[source] ? routes.get(paths[source])[0] : null;
  if (!secretName || (action !== "open" && action !== "close")) return reply(400, "GATE_REQUEST_INVALID");
  if (!await authorized(request.headers.get("authorization"), env[secretName])) return reply(401, "UNAUTHORIZED");
  const expected = { name: env.IMPORT_DATABASE_NAME, id: env.IMPORT_DATABASE_ID };
  const checked = await verifyIdentity(env, expected);
  if (checked.error) return checked.error;

  const existing = await readLease(env);
  if (existing && existing.source !== source) {
    // An unexpired lease held by another source blocks every open/close attempt.
    if (leaseValid(existing, existing.source) || action === "close") return reply(409, "GATE_BUSY");
  }
  if (action === "close") {
    try { await env.DB.prepare("DELETE FROM import_gate_lease WHERE id=1").run(); }
    catch { return reply(503, "GATE_UNAVAILABLE"); }
    return Response.json({ ok: true, source, closed: true }, { headers: noStore });
  }
  const requested = Number(payload?.ttlSeconds);
  const ttl = Math.min(LEASE_MAX_SECONDS, Math.max(LEASE_MIN_SECONDS,
    Number.isFinite(requested) && requested > 0 ? Math.round(requested) : LEASE_DEFAULT_SECONDS));
  const openedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  try {
    await env.DB.prepare(`INSERT INTO import_gate_lease (id,source,expires_at,opened_at,opened_by)
      VALUES (1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source=excluded.source,expires_at=excluded.expires_at,
      opened_at=excluded.opened_at,opened_by=excluded.opened_by`)
      .bind(source, expiresAt, openedAt, "runner").run();
  } catch { return reply(503, "GATE_UNAVAILABLE"); }
  return Response.json({ ok: true, source, openedAt, expiresAt }, { headers: noStore });
}

const gateway = { async fetch(request, env) {
  const url = new URL(request.url);
  if (url.pathname === GATE_PATH) return handleLease(request, env);
  const identityRequest = url.pathname === "/api/internal/import-identity" && request.method === "GET";
  if (url.search && url.pathname !== "/api/internal/sime-import" && !identityRequest) return reply(404, "NOT_FOUND");
  const route = identityRequest ? routes.get(paths[url.searchParams.get("source")]) : routes.get(url.pathname);
  if (!route) return reply(404, "NOT_FOUND");
  if (!configured(env)) return reply(503, "IMPORT_DISABLED");
  // Lease mode arms the endpoint without leaving a permanent open gate: each
  // import still needs an unexpired lease created by an authenticated runner.
  if (env.IMPORT_GATE_ENABLED !== "true" && !leaseMode(env)) return reply(503, "IMPORT_DISABLED");
  const requestedSource = identityRequest ? url.searchParams.get("source") :
    url.pathname === "/api/internal/juntas-checkpoint" ? "juntas" : sourceByPath.get(url.pathname);
  if (env.IMPORT_GATE_ALLOWED_SOURCE && env.IMPORT_GATE_ALLOWED_SOURCE !== requestedSource)
    return reply(503, "IMPORT_DISABLED");
  const [secretName, receiver] = route;
  if (!await authorized(request.headers.get("authorization"), env[secretName])) return reply(401, "UNAUTHORIZED");
  const expected = { name: env.IMPORT_DATABASE_NAME, id: env.IMPORT_DATABASE_ID };
  const checked = await verifyIdentity(env, expected);
  if (checked.error) return checked.error;
  if (identityRequest) return Response.json({ name: checked.identity.database_name, id: checked.identity.database_id },
    { headers: noStore });
  if (leaseMode(env) && !leaseValid(await readLease(env), requestedSource)) return reply(503, "IMPORT_DISABLED");
  return receiver.fetch(request, env);
} };
export default gateway;
