// Read-only GitHub fuse. Covers failures before D1 could persist a RUNNING latch.
import { pathToFileURL } from "node:url";

export async function checkAutomationHistory(config, fetcher = fetch) {
  const approved = config.FDCI_AUTOMATION_APPROVED_SHA;
  if (config.GITHUB_REPOSITORY !== "possee41/docentetuc" || !/^\d+$/.test(config.GITHUB_RUN_ID || "") ||
      config.GITHUB_RUN_ATTEMPT !== "1" || !config.GITHUB_TOKEN || !/^[a-f0-9]{40}$/.test(approved || ""))
    throw new Error("AUTOMATION_HISTORY_CONFIG_INVALID");
  const root = "https://api.github.com/repos/possee41/docentetuc";
  const get = async path => {
    const response = await fetcher(root + path, { headers: { authorization: `Bearer ${config.GITHUB_TOKEN}`,
      accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, redirect: "error", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error("AUTOMATION_HISTORY_UNAVAILABLE");
    return response.json();
  };
  const current = await get("/actions/runs/" + config.GITHUB_RUN_ID);
  if (String(current.id) !== config.GITHUB_RUN_ID || current.run_attempt !== 1 || !Number.isSafeInteger(current.workflow_id) ||
      !Number.isSafeInteger(current.run_number)) throw new Error("AUTOMATION_HISTORY_INVALID");
  const runs = await get(`/actions/workflows/${current.workflow_id}/runs?per_page=100`);
  if (!Array.isArray(runs.workflow_runs)) throw new Error("AUTOMATION_HISTORY_INVALID");
  const prior = runs.workflow_runs.filter(x => x.run_number < current.run_number).sort((a, b) => b.run_number - a.run_number)[0];
  if (!prior) {
    if (current.run_number !== 1 || config.FDCI_AUTOMATION_BOOTSTRAP_SHA !== approved)
      throw new Error("AUTOMATION_BOOTSTRAP_NOT_APPROVED");
    return { ok: true, bootstrap: true };
  }
  if (!Number.isSafeInteger(prior.id) || prior.status !== "completed" || prior.run_attempt !== 1)
    throw new Error("AUTOMATION_HISTORY_BLOCKED");
  const jobs = await get(`/actions/runs/${prior.id}/jobs?per_page=100`);
  const healthy = prior.conclusion === "success" && Array.isArray(jobs.jobs) && jobs.jobs.some(job =>
    job.name === "import" && job.conclusion === "success" && job.steps?.some(step =>
      step.name === "One bounded run; no retries" && step.conclusion === "success"));
  if (!healthy && config.FDCI_AUTOMATION_RECOVERY_RUN_ID !== String(prior.id)) throw new Error("AUTOMATION_HISTORY_BLOCKED");
  return { ok: true, bootstrap: false, priorRunId: prior.id, operatorRecoveryAcknowledged: !healthy };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await checkAutomationHistory(process.env))); }
  catch { console.error("FDCI_AUTOMATION_HISTORY_BLOCKED");process.exitCode = 1; }
}
