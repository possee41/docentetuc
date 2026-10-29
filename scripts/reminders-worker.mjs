// Calls the notices Worker. The runner never receives a Cloudflare API token or SQL:
// the Worker owns the fixed statements, the dedupe keys and the row confirmations.
import { pathToFileURL } from "node:url";

export function resolveReminderTarget(config = {}) {
  let url;
  try { url = new URL(config.NOTICES_IMPORT_URL || ""); } catch { throw new Error("NOTICES_URL_INVALID"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      !/^docentetuc-notices-1-2\.[a-z0-9-]+\.workers\.dev$/.test(url.hostname) ||
      url.pathname !== "/api/internal/notices/reminders") throw new Error("NOTICES_URL_INVALID");
  const secret = config.NOTICES_IMPORT_SECRET || "";
  if (!/^[A-Za-z0-9_-]{32,}$/.test(secret)) throw new Error("NOTICES_SECRET_INVALID");
  const limit = config.NOTICES_LIMIT === undefined || config.NOTICES_LIMIT === "" ? 10 : Number(config.NOTICES_LIMIT);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error("NOTICES_LIMIT_INVALID");
  return { endpoint: url.toString(), secret, limit };
}

export async function runReminderStep(target, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(target.endpoint, { method: "POST",
      headers: { Authorization: `Bearer ${target.secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "reminders", limit: target.limit }), signal: AbortSignal.timeout(20_000) });
  } catch { throw new Error("NOTICES_NETWORK_ERROR"); }
  if (!response.ok) throw new Error(`NOTICES_HTTP_${response.status}`);
  let result;
  try { result = await response.json(); } catch { throw new Error("NOTICES_ACK_INVALID"); }
  // A partial response is never treated as a completed step.
  if (result?.ok !== true || !Number.isInteger(result.considered) ||
      !Number.isInteger(result.inserted) || !Number.isInteger(result.processed))
    throw new Error("NOTICES_ACK_INVALID");
  return { considered: result.considered, inserted: result.inserted, processed: result.processed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runReminderStep(resolveReminderTarget(process.env));
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error("NOTICES_REMINDERS_FAILED", error instanceof Error && /^[A-Z_0-9]+$/.test(error.message)
      ? error.message : "NOTICES_REMINDERS_FAILED");
    process.exitCode = 1;
  }
}
