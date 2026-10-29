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
const reply = (status, code) => Response.json({ error: code }, { status, headers: { "Cache-Control": "no-store" } });
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

const gateway = { async fetch(request, env) {
  const url = new URL(request.url);
  const identityRequest = url.pathname === "/api/internal/import-identity" && request.method === "GET";
  if (url.search && url.pathname !== "/api/internal/sime-import" && !identityRequest) return reply(404, "NOT_FOUND");
  const route = identityRequest ? routes.get(paths[url.searchParams.get("source")]) : routes.get(url.pathname);
  if (!route) return reply(404, "NOT_FOUND");
  if (env.IMPORT_GATE_ENABLED !== "true" || !env.DB || !env.IMPORT_DATABASE_NAME || !env.IMPORT_DATABASE_ID)
    return reply(503, "IMPORT_DISABLED");
  const requestedSource = identityRequest ? url.searchParams.get("source") :
    url.pathname === "/api/internal/juntas-checkpoint" ? "juntas" : sourceByPath.get(url.pathname);
  if (env.IMPORT_GATE_ALLOWED_SOURCE && env.IMPORT_GATE_ALLOWED_SOURCE !== requestedSource)
    return reply(503, "IMPORT_DISABLED");
  const [secretName, receiver] = route;
  if (!await authorized(request.headers.get("authorization"), env[secretName])) return reply(401, "UNAUTHORIZED");
  let identity;
  try { identity = await env.DB.prepare("SELECT database_name,database_id FROM import_gateway_identity WHERE id=1").first(); }
  catch { return reply(503, "DATABASE_IDENTITY_UNAVAILABLE"); }
  if (identity?.database_name !== env.IMPORT_DATABASE_NAME || identity?.database_id !== env.IMPORT_DATABASE_ID)
    return reply(503, "DATABASE_IDENTITY_MISMATCH");
  if (identityRequest) return Response.json({ name: identity.database_name, id: identity.database_id },
    { headers: { "Cache-Control": "no-store" } });
  return receiver.fetch(request, env);
} };
export default gateway;
