// Calls the notices Worker. The runner never receives a Cloudflare API token or SQL:
// the Worker owns the fixed statements, the dedupe keys and the row confirmations.
import { pathToFileURL } from "node:url";

export function resolveReminderTarget(config = {}) {
  let url;
  try { url = new URL(config.NOTICES_IMPORT_URL || ""); } catch { throw new Error("NOTICES_URL_INVALID"); }
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.search || url.hash ||
      !/^docentetuc-notices-1-2(-canary)?\.[a-z0-9-]+\.workers\.dev$/.test(url.hostname) ||
      url.pathname !== "/api/internal/notices/reminders") throw new Error("NOTICES_URL_INVALID");
  const secret = config.NOTICES_IMPORT_SECRET || "";
  if (!/^[A-Za-z0-9_-]{32,}$/.test(secret)) throw new Error("NOTICES_SECRET_INVALID");
  const limit = config.NOTICES_LIMIT === undefined || config.NOTICES_LIMIT === "" ? 2 : Number(config.NOTICES_LIMIT);
  if (!Number.isInteger(limit) || limit < 1 || limit > 2) throw new Error("NOTICES_LIMIT_INVALID");
  return { endpoint: url.toString(), secret, limit };
}

// Read-only Actions history acts as the stop latch. A failed/ambiguous run
// blocks subsequent batches until an operator explicitly acknowledges it.
export async function checkReminderAutomation(config, fetcher = fetch) {
  if (config.NOTICES_AUTOMATION_ENABLED !== "true") throw new Error("NOTICES_AUTOMATION_DISABLED");
  if (config.GITHUB_REPOSITORY !== "possee41/docentetuc" || !/^\d+$/.test(config.GITHUB_RUN_ID || "") ||
      !/^\d+$/.test(config.GITHUB_RUN_NUMBER || "") || !config.GH_TOKEN)
    throw new Error("NOTICES_ACTIONS_CONTEXT_INVALID");
  const reset = config.GITHUB_EVENT_NAME === "workflow_dispatch" && config.NOTICES_ACKNOWLEDGE_FAILURE === "true";
  if (config.GITHUB_RUN_ATTEMPT !== "1" && !reset) throw new Error("NOTICES_RETRY_REQUIRES_REVIEW");
  let response;
  try {
    response = await fetcher("https://api.github.com/repos/possee41/docentetuc/actions/workflows/notices-reminders.yml/runs?per_page=100", {
      headers: { Authorization: `Bearer ${config.GH_TOKEN}`, Accept: "application/vnd.github+json" },
      redirect: "error", signal: AbortSignal.timeout(20_000),
    });
  } catch { throw new Error("NOTICES_HISTORY_UNAVAILABLE"); }
  if (!response.ok) throw new Error("NOTICES_HISTORY_UNAVAILABLE");
  let history;
  try { history = await response.json(); } catch { throw new Error("NOTICES_HISTORY_INVALID"); }
  if (!Array.isArray(history?.workflow_runs)) throw new Error("NOTICES_HISTORY_INVALID");
  const previous = history.workflow_runs
    .filter(run => Number.isSafeInteger(run.run_number) && run.run_number < Number(config.GITHUB_RUN_NUMBER) && run.conclusion !== "skipped")
    .sort((a, b) => b.run_number - a.run_number)[0];
  if (previous && previous.status !== "completed") throw new Error("NOTICES_PREVIOUS_RUN_ACTIVE");
  if (!reset && ((previous && previous.conclusion !== "success") || (!previous && config.GITHUB_RUN_NUMBER !== "1")))
    throw new Error("NOTICES_PREVIOUS_RUN_REQUIRES_REVIEW");
}

export async function runReminderStep(target, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(target.endpoint, { method: "POST",
      headers: { Authorization: `Bearer ${target.secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "reminders", limit: target.limit }), redirect: "error", signal: AbortSignal.timeout(20_000) });
  } catch { throw new Error("NOTICES_NETWORK_ERROR"); }
  if (!response.ok) throw new Error(`NOTICES_HTTP_${response.status}`);
  let result;
  try { result = await response.json(); } catch { throw new Error("NOTICES_ACK_INVALID"); }
  // A partial response is never treated as a completed step.
  if (result?.ok !== true || ![result.considered, result.inserted, result.processed].every(Number.isSafeInteger) ||
      result.considered < 0 || result.considered > target.limit || result.inserted < 0 ||
      result.inserted > result.considered || result.processed < 0 || result.processed > result.considered)
    throw new Error("NOTICES_ACK_INVALID");
  if (result.processed !== result.considered) throw new Error("NOTICES_BATCH_UNCONFIRMED");
  return { considered: result.considered, inserted: result.inserted, processed: result.processed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const target = resolveReminderTarget(process.env);
    await checkReminderAutomation(process.env);
    const startedAt = new Date().toISOString(), started = performance.now();
    const result = await runReminderStep(target);
    console.log(JSON.stringify({ ...result, startedAt, elapsedMs: Math.round(performance.now() - started), cpuTimeMs: null, d1: null }));
  } catch (error) {
    console.error("NOTICES_REMINDERS_FAILED", error instanceof Error && /^[A-Z_0-9]+$/.test(error.message)
      ? error.message : "NOTICES_REMINDERS_FAILED");
    process.exitCode = 1;
  }
}
