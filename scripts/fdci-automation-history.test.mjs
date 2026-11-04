import assert from "node:assert/strict";
import test from "node:test";
import { checkAutomationHistory } from "./fdci-automation-history.mjs";
const sha = "a".repeat(40);
const base = { GITHUB_REPOSITORY: "possee41/docentetuc", GITHUB_RUN_ID: "100", GITHUB_RUN_ATTEMPT: "1",
  GITHUB_TOKEN: "synthetic-read-only-token", FDCI_AUTOMATION_APPROVED_SHA: sha };
function api({ prior, good = true } = {}) {
  return async (url, init) => {
    assert.ok(String(url).startsWith("https://api.github.com/repos/possee41/docentetuc/actions/"));
    assert.equal(init.method, undefined, "history fuse never mutates GitHub");
    if (String(url).endsWith("/runs/100")) return Response.json({ id: 100, run_attempt: 1, run_number: prior ? 2 : 1, workflow_id: 42 });
    if (String(url).endsWith("/runs?per_page=100")) return Response.json({ workflow_runs: prior ? [prior] : [] });
    return Response.json({ jobs: [{ name: "import", conclusion: good ? "success" : "failure", steps: [
      { name: "One bounded run; no retries", conclusion: good ? "success" : "skipped" },
    ] }] });
  };
}
test("bootstrap is explicit; no historical failure is silently ignored", async () => {
  await assert.rejects(checkAutomationHistory(base, api()), /BOOTSTRAP_NOT_APPROVED/);
  assert.equal((await checkAutomationHistory({ ...base, FDCI_AUTOMATION_BOOTSTRAP_SHA: sha }, api())).ok, true);
});
test("preflight D1 outage, cancellation or failed CPU check blocks later schedules until that exact run is acknowledged", async () => {
  for (const conclusion of ["failure", "cancelled", "timed_out"]) {
    const prior = { id: 99, run_number: 1, run_attempt: 1, status: "completed", conclusion };
    await assert.rejects(checkAutomationHistory(base, api({ prior })), /HISTORY_BLOCKED/);
    await assert.rejects(checkAutomationHistory({ ...base, FDCI_AUTOMATION_RECOVERY_RUN_ID: "98" }, api({ prior })), /HISTORY_BLOCKED/);
    assert.equal((await checkAutomationHistory({ ...base, FDCI_AUTOMATION_RECOVERY_RUN_ID: "99" }, api({ prior }))).operatorRecoveryAcknowledged, true);
  }
});
test("a skipped import, rerun or unreadable history does not count as success", async () => {
  const prior = { id: 99, run_number: 1, run_attempt: 1, status: "completed", conclusion: "success" };
  await assert.rejects(checkAutomationHistory(base, api({ prior, good: false })), /HISTORY_BLOCKED/);
  await assert.rejects(checkAutomationHistory({ ...base, GITHUB_RUN_ATTEMPT: "2" }, api({ prior })), /CONFIG_INVALID/);
  await assert.rejects(checkAutomationHistory(base, async () => new Response(null, { status: 403 })), /HISTORY_UNAVAILABLE/);
  assert.equal((await checkAutomationHistory(base, api({ prior }))).ok, true);
});
