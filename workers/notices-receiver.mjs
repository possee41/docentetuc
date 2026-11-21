// Bounded, authenticated materialization of internal reminders. The caller sends
// one fixed operation, never SQL: Node never needs a broad D1 write token.
import { materializeExternalReminderBatch } from "../scripts/external-reminders.mjs";

const reply = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const encoder = new TextEncoder();
const secrets = new Map();
const secretDigest = (secret) => {
  let digest = secrets.get(secret);
  if (!digest) { digest = crypto.subtle.digest("SHA-256", encoder.encode(secret)); if (secrets.size < 4) secrets.set(secret, digest); }
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

const worker = { async fetch(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/internal/notices/reminders") return reply({ error: "No encontrado." }, 404);
  if (!env.DB || !env.NOTICES_IMPORT_SECRET || env.NOTICES_ENABLED !== "true") return reply({ error: "No configurado." }, 503);
  if (!await authorized(request.headers.get("authorization"), env.NOTICES_IMPORT_SECRET)) return reply({ error: "No autorizado." }, 401);
  if (request.method !== "POST") return reply({ error: "Método no permitido." }, 405);
  if (Number(request.headers.get("content-length") || 0) > 1_000) return reply({ error: "Solicitud demasiado grande." }, 413);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return reply({ error: "Se requiere JSON." }, 415);
  let payload;
  try { payload = await request.json(); } catch { return reply({ error: "JSON inválido." }, 400); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.mode !== "reminders")
    return reply({ error: "Operación inválida." }, 400);
  const limit = payload.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) return reply({ error: "Límite inválido." }, 400);
  let identity;
  try {
    identity = await env.DB.prepare("SELECT database_name,database_id FROM import_gateway_identity WHERE id=1").first();
  } catch { return reply({ error: "D1 no disponible." }, 503); }
  if (identity?.database_name !== env.NOTICES_DATABASE_NAME || identity?.database_id !== env.NOTICES_DATABASE_ID)
    return reply({ error: "D1 incorrecta." }, 503);
  try {
    // Deduplication, per-row confirmation and resumption stay in the shared routine.
    const result = await materializeExternalReminderBatch(env.DB, { limit, now: new Date() });
    return reply({ ok: true, ...result });
  } catch { return reply({ error: "Materialización fallida." }, 503); }
} };
export default worker;
