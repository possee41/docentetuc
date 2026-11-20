// One-time, operator-approved recovery of historical commissions. The manifest
// is produced by the read-only inventory and remains outside Git.
import { createHash } from "node:crypto";
import { readFile, writeFile, rename } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { runFdciGatewayJob } from "./import-gate.mjs";

export function recoveryCandidates(manifest, done = []) {
  if (manifest?.complete !== true || Object.keys(manifest.errors || {}).length ||
      !Array.isArray(manifest.missingCommissions) || !Array.isArray(done))
    throw new Error("FDCI_RECOVERY_MANIFEST_INCOMPLETE");
  const seen = new Set(), completed = new Set(done);
  return manifest.missingCommissions.filter(row => {
    if (!/^[1-9]\d{0,11}$/.test(row.commissionId || "") ||
        !/^[A-Za-z0-9_-]{1,80}$/.test(row.token || "") ||
        !/^[a-z0-9-]{1,160}$/.test(row.slug || "") || seen.has(row.commissionId))
      throw new Error("FDCI_RECOVERY_MANIFEST_INVALID");
    seen.add(row.commissionId);
    return row.status === "CLOSED" && !completed.has(row.commissionId);
  });
}

export async function runRecoveryBatch(config, revision, manifestPath, statePath,
  job = runFdciGatewayJob, maxItems = 10) {
  if (config.FDCI_RECOVERY_ENABLED !== "true" || !/^[A-Za-z0-9_:-]{1,70}$/.test(config.IMPORT_GATE_RUN_ID || "") ||
      !Number.isInteger(maxItems) || maxItems < 1 || maxItems > 10)
    throw new Error("FDCI_RECOVERY_DISABLED");
  const raw = await readFile(manifestPath);
  const hash = createHash("sha256").update(raw).digest("hex");
  if (config.FDCI_RECOVERY_MANIFEST_SHA256 !== hash) throw new Error("FDCI_RECOVERY_MANIFEST_UNAPPROVED");
  const manifest = JSON.parse(raw.toString("utf8"));
  let state;
  try { state = JSON.parse(await readFile(statePath, "utf8")); }
  catch (error) { if (error?.code !== "ENOENT") throw new Error("FDCI_RECOVERY_STATE_INVALID"); state = null; }
  if (state && (state.manifestHash !== hash || !Array.isArray(state.done))) throw new Error("FDCI_RECOVERY_STATE_INVALID");
  state ||= { manifestHash: hash, done: [] };
  if (new Set(state.done).size !== state.done.length ||
      state.done.some(id => !manifest.missingCommissions.some(row => row.commissionId === id)))
    throw new Error("FDCI_RECOVERY_STATE_INVALID");
  const candidates = recoveryCandidates(manifest, state.done);
  let processed = 0, created = 0, unchanged = 0;
  for (const row of candidates.slice(0, maxItems)) {
    const selected = { ...config, SYNC_SOURCE: "fdci", FDCI_SCOPE: "single",
      FDCI_RECOVERY_CLOSED_ONLY: "true",
      FDCI_MAX_REQUESTS: "3", FDCI_MAX_PUBLICATIONS: "1", FDCI_PAUSE_MS: "3500",
      FDCI_COURSE_TOKEN: row.token, FDCI_COURSE_SLUG: row.slug,
      FDCI_COMMISSION_ID: row.commissionId,
      IMPORT_GATE_RUN_ID: `${config.IMPORT_GATE_RUN_ID}:${row.commissionId}` };
    const result = await job(selected, revision);
    if (result.status !== "OK" || result.closed !== true || result.created + result.unchanged !== 1 || result.updated !== 0)
      return { status: "ERROR", code: result.code || "FDCI_RECOVERY_UNCONFIRMED", processed, created, unchanged,
        remaining: candidates.length - processed };
    state.done.push(row.commissionId);
    await writeFile(`${statePath}.tmp`, JSON.stringify(state));
    await rename(`${statePath}.tmp`, statePath);
    processed++; created += result.created; unchanged += result.unchanged;
  }
  return { status: "OK", processed, created, unchanged, remaining: candidates.length - processed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  try {
    const result = await runRecoveryBatch(process.env, revision,
      ".wrangler/private-fdci-recovery/fdci-recovery-manifest.json",
      ".wrangler/private-fdci-recovery/fdci-recovery-batch-state.json");
    console.log(JSON.stringify(result));
    if (result.status !== "OK") process.exitCode = 1;
  } catch (error) {
    console.log(JSON.stringify({ status: "ERROR", code: /^[A-Z_0-9]+$/.test(error?.message || "")
      ? error.message : "FDCI_RECOVERY_FAILED" }));
    process.exitCode = 1;
  }
}
