import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { runFdciGatewayJob, resolveGateConfig } from "./import-gate.mjs";
import { resolveGatewayConfig, safeImportError } from "./import-via-gateway.mjs";

export function fdciOutcome(r) {
  if (!r || r.closed !== true || r.failed || r.uncertain || !["OK", "PARTIAL"].includes(r.status)) return "FAILED";
  if (r.empty === true && r.examined === 0 && r.batches === 0) return "NO_ACTIVE_DATA";
  if (r.status === "PARTIAL" && r.progressPending === true) return "PARTIAL_PROGRESS";
  if (r.status !== "OK") return "FAILED";
  return r.created + r.updated > 0 ? "CHANGES" : "NO_CHANGES";
}

export async function runFdciAutomation(config, revision, sourceFetch = fetch, gatewayFetch = fetch, signal, measureCpu) {
  let target, owner, result, calls = 0, started = false, finishKind, serverHalted = false;
  const finish = async (success, reason) => {
    finishKind = success;
    const response = await gatewayFetch(`${target.origin}/api/internal/fdci-automation/finish`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000),
      headers: { authorization: `Bearer ${target.secret}`, "content-type": "application/json",
        "x-import-gate-owner": owner, "x-fdci-automation-sha": revision },
      body: JSON.stringify({ success, reason }),
    });
    if (!response.ok) throw new Error("AUTOMATION_FINISH_UNCERTAIN");
    const ack = await response.json();
    if (ack?.ok !== true || ack.halted !== !success) throw new Error("AUTOMATION_FINISH_UNCERTAIN");
  };
  try {
    if (config.FDCI_AUTOMATION_ENABLED !== "true" || config.SYNC_SOURCE !== "fdci" ||
        config.IMPORT_GATEWAY_APPROVED_SHA !== revision || !/^[a-f0-9]{40}$/.test(revision) ||
        config.FDCI_MAX_PUBLICATIONS !== "2" || config.FDCI_MAX_REQUESTS !== "6" || config.FDCI_PAUSE_MS !== "400")
      throw new Error("AUTOMATION_CONFIG_INVALID");
    const scoped = { ...config, FDCI_IMPORT_SECRET: config.FDCI_AUTOMATION_SECRET };
    target = resolveGatewayConfig(scoped, revision); owner = resolveGateConfig(scoped).owner;
    if (!/^\d{1,20}-1$/.test(owner)) throw new Error("AUTOMATION_OWNER_INVALID");
    const transport = async (url, init = {}) => {
      const path = new URL(url).pathname;
      const paths = { "/api/internal/import-identity": "identity", "/api/internal/fdci-import": "import", "/api/internal/fdci-checkpoint": "checkpoint",
        "/api/internal/fdci-delta": "delta" };
      let op = paths[path];
      if (path === "/api/internal/import-gate") {
        op = JSON.parse(init.body).action === "open" ? "start" : "close";
        if (op === "start") started = true; // Includes ambiguous delivery: never retry it.
      }
      if (!op) throw new Error("AUTOMATION_PATH_FORBIDDEN");
      const headers = new Headers(init.headers);
      headers.set("x-import-gate-owner", owner); headers.set("x-fdci-automation-sha", revision);
      calls++;
      const response = await gatewayFetch(`${target.origin}/api/internal/fdci-automation/${op}`, { ...init, headers });
      if (!response.ok) {
        try { serverHalted ||= (await response.clone().json()).error === "AUTOMATION_HALTED"; } catch { /* no unsafe body logging */ }
      }
      return response;
    };
    result = await runFdciGatewayJob(scoped, revision, sourceFetch, transport, signal);
    const outcome = fdciOutcome(result);
    if (outcome === "FAILED") {
      if (started) await finish(false, /^[A-Z_0-9]{1,70}$/.test(result.code || "") ? result.code : "IMPORT_FAILED");
      return { ...result, outcome, automationSuspended: started || serverHalted, operatorInterventionRequired: true };
    }
    const cpu = measureCpu ? await measureCpu({ calls, owner, revision }) : null;
    if (!cpu?.complete || !Array.isArray(cpu.samples) || cpu.samples.length !== calls ||
        cpu.samples.some(x => !Number.isFinite(x.cpuTimeMs) || x.cpuTimeMs < 0)) {
      await finish(false, "CPU_EVIDENCE_UNAVAILABLE");
      return { ...result, dataOutcome: outcome, outcome: "FAILED", status: "ERROR", code: "CPU_EVIDENCE_UNAVAILABLE", automationSuspended: true };
    }
    if (cpu.samples.some(x => x.cpuTimeMs > 7 || x.outcome !== "ok")) {
      await finish(false, "CPU_LIMIT");
      return { ...result, dataOutcome: outcome, outcome: "FAILED", status: "ERROR", code: "CPU_LIMIT", automationSuspended: true };
    }
    await finish(true, outcome);
    return { ...result, outcome, automationSuspended: false,
      cpuEvidence: { complete: true, samples: cpu.samples.map(x => ({ cpuTimeMs: x.cpuTimeMs, outcome: x.outcome })) } };
  } catch (error) {
    if (started && target && finishKind !== false) {
      try { await finish(false, "RUNNER_OR_RESPONSE_ERROR"); } catch { /* RUNNING remains latched; do not retry mutations. */ }
    }
    return { ...result, ...safeImportError(error), outcome: "FAILED", automationSuspended: started, suspensionUnconfirmed: started };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = process.env;
  const controller = new AbortController();
  process.once("SIGTERM", () => controller.abort()); process.once("SIGINT", () => controller.abort());
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  // No fake CPU adapter. Without complete individual metrics the CLI halts after
  // the controlled run, and the server refuses future grants until operator recovery.
  const result = await runFdciAutomation(config, revision, fetch, fetch, controller.signal);
  console.log(JSON.stringify(result));
  if (result.status === "ERROR" || result.automationSuspended) process.exitCode = 1;
}
