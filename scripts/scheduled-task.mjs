// Each expression produces a separate scheduled invocation and resource budget.
export const SCHEDULED_TASKS = Object.freeze({
  "0 * * * *": ["sync", "/api/sync"],
  "1 * * * *": ["retention", "/api/community/retention"],
  "2-57/5 * * * *": ["push", "/api/push/dispatch"],
});

export async function runScheduledTask(cron, secret, fetcher, legacyPaused = false) {
  if (!secret) throw new Error("CRON_SECRET_NOT_CONFIGURED");
  // An old trigger can arrive while Cloudflare propagates the new schedule.
  // During the cutover pause, keep push running; hourly retention can wait.
  const task = SCHEDULED_TASKS[cron] ??
    (legacyPaused && cron === "*/5 * * * *" ? SCHEDULED_TASKS["2-57/5 * * * *"] : null);
  if (!task) throw new Error("UNKNOWN_CRON_TRIGGER");
  const [name, path] = task;
  const started = performance.now();
  const response = await fetcher(new Request(`https://docentetuc.internal${path}`, {
    method: "POST", headers: { "x-docentetuc-cron": secret },
  }));
  if (!response.ok) throw new Error(`SCHEDULED_${name.toUpperCase()}_${response.status}`);
  // Wall time is diagnostic only; Cloudflare CPU usage must be measured separately.
  console.log("scheduled_task_completed", JSON.stringify({ task: name,
    transition: cron === "*/5 * * * *", wallMs: Math.round(performance.now() - started) }));
  return name;
}
