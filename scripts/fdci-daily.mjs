import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { runFdciGatewayJob } from "./import-gate.mjs";

// Each slice gets its own six-read/two-publication budget and closes its lease.
// The daily job stops on incomplete or uncertain progress instead of claiming a
// fresh catalog. The persistent D1 checkpoint resumes on the next authorized run.
export async function runFdciDaily(config, revision, sourceFetch = fetch, gatewayFetch = fetch, signal) {
  const maxSlices = Number(config.FDCI_MAX_SLICES || 12);
  if (config.FDCI_SCOPE !== "active" || config.FDCI_DELTA_ENABLED === "true" ||
      config.FDCI_MAX_REQUESTS !== "6" || config.FDCI_MAX_PUBLICATIONS !== "2" ||
      !Number.isInteger(maxSlices) || maxSlices < 1 || maxSlices > 12)
    throw new Error("FDCI_DAILY_CONFIG_INVALID");
  const totals = { discovered: 0, created: 0, updated: 0, unchanged: 0, rejected: 0,
    skipped: 0, sourceRequests: 0, slices: 0 };
  let previousRevision = -1;
  for (let slice = 0; slice < maxSlices; slice++) {
    if (signal?.aborted) return { ...totals, status: "ERROR", code: "FDCI_CANCELLED" };
    if (slice) await new Promise(resolve => setTimeout(resolve, Number(config.FDCI_PAUSE_MS)));
    const result = await runFdciGatewayJob(config, revision, sourceFetch, gatewayFetch, signal);
    totals.slices++;
    for (const key of ["created", "updated", "unchanged", "rejected", "skipped", "sourceRequests"])
      totals[key] += Number.isSafeInteger(result[key]) ? result[key] : 0;
    totals.discovered = Number.isSafeInteger(result.discovered) ? result.discovered : totals.discovered;
    if (result.closed !== true || result.status === "ERROR" || result.failed || result.uncertain ||
        result.rejected || result.sourceErrors && Object.keys(result.sourceErrors).some(key => key !== "requestLimit"))
      return { ...totals, status: "ERROR", code: result.code || "FDCI_SLICE_FAILED", cycleComplete: false };
    if (result.cycleComplete === true) return { ...totals, status: "OK", cycleComplete: true };
    const revisionNow = result.cursor?.revision;
    if (result.progressPending !== true || !Number.isSafeInteger(revisionNow) || revisionNow <= previousRevision)
      return { ...totals, status: "ERROR", code: "FDCI_NO_PROGRESS", cycleComplete: false };
    previousRevision = revisionNow;
  }
  return { ...totals, status: "PARTIAL", code: "FDCI_DAILY_CAPACITY", cycleComplete: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  process.once("SIGTERM", () => controller.abort()); process.once("SIGINT", () => controller.abort());
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  try {
    const result = await runFdciDaily(process.env, revision, fetch, fetch, controller.signal);
    console.log(JSON.stringify(result));
    if (result.status !== "OK") process.exitCode = 1;
  } catch (error) {
    console.log(JSON.stringify({ status: "ERROR", code: /^[A-Z_0-9]+$/.test(error?.message || "") ? error.message : "FDCI_DAILY_FAILED" }));
    process.exitCode = 1;
  }
}
