// Isolated CPU canary: the real dispatcher writes only to a synthetic D1.
// The injected provider never performs a network request.
import { dispatchPushNotifications } from "../lib/push.ts";

const CANARY_MARKER = "docentetuc-push-canary-1-2";
const VAPID_PLACEHOLDER = { VAPID_PUBLIC_KEY: "synthetic", VAPID_PRIVATE_KEY: "synthetic",
  VAPID_SUBJECT: "mailto:canary@example.invalid" };
const simulatedProvider = { send: async () => new Response(null, { status: 201 }) };
const isolateId = crypto.randomUUID();
let isolateInvocation = 0;
const reply = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function authorized(header, secret) {
  const bearer = header?.match(/^Bearer ([A-Za-z0-9_-]{32,})$/)?.[1];
  if (typeof secret !== "string" || !/^[A-Za-z0-9_-]{32,}$/.test(secret) || !bearer) return false;
  const digest = (value) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const [expected, actual] = await Promise.all([digest(secret), digest(bearer)]);
  const left = new Uint8Array(expected), right = new Uint8Array(actual);
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

function measuredD1(db) {
  const metrics = { queries: 0, rowsRead: 0, rowsWritten: 0 };
  const record = (result) => {
    if (!Number.isSafeInteger(result.meta?.rows_read) || !Number.isSafeInteger(result.meta?.rows_written) ||
        result.meta.rows_read < 0 || result.meta.rows_written < 0) throw new Error("CANARY_D1_META_INVALID");
    metrics.rowsRead += result.meta.rows_read;
    metrics.rowsWritten += result.meta.rows_written;
    return result;
  };
  const wrap = (statement) => ({
    bind: (...params) => wrap(statement.bind(...params)),
    all: async () => { metrics.queries++; return record(await statement.all()); },
    run: async () => { metrics.queries++; return record(await statement.run()); },
  });
  return { metrics, db: { prepare: (sql) => wrap(db.prepare(sql)) } };
}

export async function handlePushCanary(request, env, now = new Date()) {
  const invocation = ++isolateInvocation;
  const started = performance.now();
  const path = new URL(request.url).pathname;
  const match = /^\/run\/(0|100|500|1000)-(dense|sparse)\/([a-z0-9-]{1,64})$/.exec(path);
  if (request.method !== "POST" || !match) return reply({ error: "NOT_FOUND" }, 404);
  if (!env?.CANARY_BEARER_TOKEN || !env.DB) return reply({ error: "CANARY_NOT_CONFIGURED" }, 503);
  if (!await authorized(request.headers.get("Authorization"), env.CANARY_BEARER_TOKEN))
    return reply({ error: "UNAUTHORIZED" }, 401);

  const [, count, density, runId] = match;
  const measured = measuredD1(env.DB);
  try {
    const identity = await measured.db.prepare("SELECT marker FROM push_canary_identity LIMIT 1").all();
    if (identity.results?.[0]?.marker !== CANARY_MARKER) {
      console.error(JSON.stringify({ event: "push_canary_identity_invalid", runId, scenario: `${count}-${density}` }));
      return reply({ error: "CANARY_DB_IDENTITY_INVALID" }, 503);
    }
    const result = await dispatchPushNotifications(measured.db, VAPID_PLACEHOLDER, now, simulatedProvider);
    const report = { runId, scenario: `${count}-${density}`, isolateId, isolateInvocation: invocation,
      result, d1: measured.metrics, wallMs: Math.round((performance.now() - started) * 100) / 100 };
    console.log(JSON.stringify({ event: "push_canary", ...report }));
    return reply(report);
  } catch {
    console.error(JSON.stringify({ event: "push_canary_error", runId, scenario: `${count}-${density}`,
      isolateId, isolateInvocation: invocation, d1: measured.metrics }));
    return reply({ error: "CANARY_DISPATCH_FAILED", runId, d1: measured.metrics }, 500);
  }
}

const worker = { fetch: handlePushCanary };
export default worker;
