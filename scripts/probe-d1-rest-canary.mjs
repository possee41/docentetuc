// One-off, opt-in REST check. Never accepts a database UUID from the environment.
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createD1Rest } from "./d1-rest.mjs";

export const CANARY_DATABASE_ID = "713a8c37-d123-43ce-9f9e-7789e60e3d21";
export const CANARY_DATABASE_NAME = "docentetuc-fdci-canary-1-1";

export async function runCanaryRestProbe({ accountId, token, fetcher = fetch }) {
  const db = createD1Rest({ accountId, databaseId: CANARY_DATABASE_ID, token, fetcher });
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${CANARY_DATABASE_ID}`;
  let response;
  try { response = await fetcher(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) }); }
  catch { throw new Error("CANARY_IDENTITY_UNAVAILABLE"); }
  if (!response.ok) throw new Error(`CANARY_IDENTITY_HTTP_${response.status}`);
  const identity = await response.json();
  if (identity?.success !== true || identity.result?.uuid !== CANARY_DATABASE_ID ||
      identity.result?.name !== CANARY_DATABASE_NAME) throw new Error("CANARY_IDENTITY_MISMATCH");

  // The only SQL in this probe touches a dedicated synthetic table.
  await db.prepare("CREATE TABLE IF NOT EXISTS _codex_rest_probe (id TEXT PRIMARY KEY, state TEXT NOT NULL)").bind().run();
  const id = `synthetic-${randomUUID()}`;
  await db.prepare("INSERT OR IGNORE INTO _codex_rest_probe(id,state) VALUES(?,?)").bind(id, "new").run();
  const first = await db.prepare("SELECT state FROM _codex_rest_probe WHERE id=?").bind(id).first();
  const beforeReplay = db.metrics().rowsWritten;
  await db.prepare("INSERT OR IGNORE INTO _codex_rest_probe(id,state) VALUES(?,?)").bind(id, "new").run();
  const replayWroteNothing = db.metrics().rowsWritten === beforeReplay;
  await db.prepare("UPDATE _codex_rest_probe SET state=? WHERE id=? AND state=?").bind("updated", id, "new").run();
  const updated = await db.prepare("SELECT state FROM _codex_rest_probe WHERE id=?").bind(id).first();
  let rejectedInvalidSql = false;
  try { await db.prepare("SELECT nonexistent_column FROM _codex_rest_probe WHERE id=?").bind(id).all(); }
  catch (error) { rejectedInvalidSql = error?.message === "D1_QUERY_FAILED" || /^D1_HTTP_4/.test(error?.message || ""); }
  if (first?.state !== "new" || !replayWroteNothing || updated?.state !== "updated" || !rejectedInvalidSql) throw new Error("CANARY_REST_PROBE_FAILED");
  return { ok: true, canary: CANARY_DATABASE_NAME, idempotent: true, update: true, invalidSqlRejected: true, d1: db.metrics() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.env.D1_DATABASE_ID || process.env.D1_REST_CANARY_PROBE !== "true") throw new Error("CANARY_PROBE_NOT_ENABLED");
    const result = await runCanaryRestProbe({ accountId: process.env.CF_ACCOUNT_ID, token: process.env.D1_CANARY_TOKEN });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error("CANARY_REST_PROBE_FAILED", error instanceof Error ? error.message : "unknown");
    process.exitCode = 1;
  }
}
