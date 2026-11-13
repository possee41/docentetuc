import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, openSync, closeSync, writeFileSync, renameSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { runSimeImport, parseSimeOptions, parseSimeCursor } from "./import-sime.mjs";

export const CANARY = Object.freeze({
  origin: "https://docentetuc-import-canary-1-2.possee41.workers.dev",
  id: "853e2f5d-89b1-46a3-9c1c-5cbd46784756", name: "docentetuc-web-canary-1-2",
});
const repository = "possee41/docentetuc";
const ref = "refs/heads/pilot/sime-fair-canary";
const fail = code => { throw new Error(code); };
const safeCode = error => /^[A-Z0-9_]+$/.test(error?.message || "") ? error.message : "SIME_CANARY_FAILED";

export function resolveGatewayConfig(config) {
  if (config.SYNC_SOURCE !== "sime" || config.IMPORT_GATEWAY_TARGET !== "canary" ||
      config.IMPORT_GATEWAY_PRODUCTION_ENABLED === "true" || config.IMPORT_GATEWAY_ORIGIN !== CANARY.origin ||
      config.IMPORT_GATEWAY_DATABASE_ID !== CANARY.id || config.IMPORT_GATEWAY_DATABASE_NAME !== CANARY.name)
    fail("GATEWAY_TARGET_FORBIDDEN");
  if (!/^[A-Za-z0-9_-]{32,}$/.test(config.SIME_IMPORT_SECRET || "")) fail("GATEWAY_SECRET_INVALID");
  return { ...CANARY, source: "sime", endpoint: CANARY.origin + "/api/internal/sime-import", secret: config.SIME_IMPORT_SECRET };
}

export function verifyExecution(config, revision) {
  const target = resolveGatewayConfig(config), options = parseSimeOptions(config);
  if (config.SIME_CANARY_ENABLED !== "true" || config.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
      config.GITHUB_REPOSITORY !== repository || config.GITHUB_REF !== ref || config.GITHUB_RUN_ATTEMPT !== "1" ||
      !/^\d+$/.test(config.GITHUB_RUN_ID || "") || config.SIME_CANARY_AUTHORIZED_RUN_ID !== config.GITHUB_RUN_ID ||
      !/^[a-f0-9]{40}$/.test(config.SIME_CANARY_APPROVED_SHA || "") ||
      revision !== config.SIME_CANARY_APPROVED_SHA || config.GITHUB_SHA !== revision ||
      options.juntas.join() !== "1,2,3,4" || options.limit !== 50)
    fail("SIME_EXECUTION_NOT_APPROVED");
  return { target, options, owner: `sime-canary:${config.GITHUB_RUN_ID}:1` };
}

async function jsonResponse(response, code) {
  if (!response.ok) fail(`${code}_HTTP_${response.status}`);
  try { return await response.json(); } catch { fail(`${code}_INVALID`); }
}

export async function verifyGatewayIdentity(target, fetcher = fetch) {
  const response = await fetcher(`${target.origin}/api/internal/import-identity?source=sime`, {
    headers: { Authorization: `Bearer ${target.secret}` }, redirect: "error", signal: AbortSignal.timeout(20_000),
  });
  const body = await jsonResponse(response, "GATEWAY_IDENTITY");
  if (body?.id !== CANARY.id || body?.name !== CANARY.name) fail("GATEWAY_IDENTITY_MISMATCH");
}

async function gate(action, target, owner, fetcher) {
  const response = await fetcher(`${target.origin}/api/internal/import-gate`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${target.secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action, source: "sime", owner, ttlSeconds: 600 }),
  });
  const body = await jsonResponse(response, "GATE");
  if (body?.ok !== true || body.source !== "sime" || body.owner !== owner ||
      action === "close" && body.closed !== true) fail("GATE_ACK_INVALID");
  return body;
}

export async function closeSimeCanary(config, revision, fetcher = fetch) {
  const { target, owner } = verifyExecution(config, revision);
  await gate("close", target, owner, fetcher);
  return { closed: true, owner };
}

export function sealReport(data) {
  return { data, checksum: createHash("sha256").update(JSON.stringify(data)).digest("hex") };
}

export function readSimeCheckpoint(report, revision, expectedRunId) {
  if (!report?.data || report.checksum !== sealReport(report.data).checksum ||
      report.data.version !== 1 || report.data.repository !== repository || report.data.ref !== ref ||
      report.data.codeSha !== revision || !/^\d+$/.test(expectedRunId || "") || report.data.runId !== expectedRunId ||
      report.data.owner !== `sime-canary:${report.data.runId}:1` || report.data.closed !== true ||
      report.data.halted || !["OK", "PARTIAL"].includes(report.data.status)) fail("SIME_CHECKPOINT_REVIEW_REQUIRED");
  parseSimeCursor(report.data.result?.nextResumeAfter);
  if (!report.data.result?.nextResumeAfter) fail("SIME_CHECKPOINT_REVIEW_REQUIRED");
  return report.data.result.nextResumeAfter;
}

export async function runSimeCanaryPilot(config, revision, { sourceFetch = fetch, receiverFetch = fetch,
  clock = Date.now, signal, onProgress = () => {} } = {}) {
  const { target, options, owner } = verifyExecution(config, revision);
  const report = { version: 1, repository, ref, codeSha: revision, runId: config.GITHUB_RUN_ID,
    owner, startedAt: new Date(clock()).toISOString(), status: "ERROR", closed: null };
  let attempted = false, deadline = Infinity, stopped = false;
  const check = () => {
    if (signal?.aborted || stopped) fail("SIME_CANCELLED");
    if (clock() >= deadline) fail("SIME_LEASE_EXPIRED");
  };
  // No retry: any uncertain HTTP exchange stops subsequent source and batch requests.
  const guarded = fetcher => async (url, init = {}) => {
    check();
    try {
      const remaining = Math.max(1, Math.min(20_000, deadline - clock()));
      const response = await fetcher(url, { ...init, redirect: "error",
        headers: { ...Object.fromEntries(new Headers(init.headers)),
          ...(new URL(url).origin === target.origin ? { "X-Import-Gate-Owner": owner } : {}) },
        signal: AbortSignal.any([AbortSignal.timeout(remaining), ...(signal ? [signal] : []), ...(init.signal ? [init.signal] : [])]) });
      check();
      if (!response.ok) { stopped = true; fail(`SIME_HTTP_${response.status}`); }
      return response;
    } catch (error) { stopped = true; throw error; }
  };
  try {
    check();
    await verifyGatewayIdentity(target, guarded(receiverFetch));
    check();
    attempted = true; // Also close if the open ACK is lost.
    const opened = await gate("open", target, owner, receiverFetch);
    deadline = Date.parse(opened.expiresAt);
    if (!Number.isFinite(deadline) || deadline <= clock() || deadline > clock() + 600_000)
      fail("GATE_EXPIRY_INVALID");
    report.expiresAt = opened.expiresAt;
    report.result = await runSimeImport({ ...options, endpoint: target.endpoint, token: target.secret,
      sourceFetch: guarded(sourceFetch), receiverFetch: guarded(receiverFetch), now: new Date(clock()),
      onProgress: result => onProgress(sealReport({ ...report, result, status: "IN_PROGRESS", halted: true })) });
    report.status = report.result.completed ? "OK" : "PARTIAL";
  } catch (error) {
    report.code = safeCode(error);
    if (error.result) report.result = error.result;
    report.halted = true; // A checkpoint after an ambiguous ACK is diagnostic, never an automatic resume permit.
  } finally {
    if (attempted) {
      try { await gate("close", target, owner, receiverFetch); report.closed = true; }
      catch (error) { report.closed = false; report.closeCode = safeCode(error); report.status = "ERROR"; report.halted = true; }
    }
  }
  report.finishedAt = new Date(clock()).toISOString();
  return sealReport(report);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort); process.once("SIGTERM", abort);
  try {
    const config = process.env, revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    verifyExecution(config, revision);
    if (process.argv[2] === "close") console.log(JSON.stringify(await closeSimeCanary(config, revision)));
    else {
      if (process.argv[2] !== "run") fail("SIME_ACTION_REQUIRED");
      if (existsSync("sime-canary-result.json")) fail("SIME_RESULT_ALREADY_EXISTS");
      // A persistent local latch also blocks a second invocation in this workspace.
      closeSync(openSync(".sime-canary-once.lock", "wx"));
      const persist = result => {
        writeFileSync("sime-canary-result.json.tmp", JSON.stringify(result, null, 2), { flag: "wx" });
        renameSync("sime-canary-result.json.tmp", "sime-canary-result.json");
      };
      const result = await runSimeCanaryPilot(config, revision, { signal: controller.signal, onProgress: persist });
      persist(result);
      console.log(JSON.stringify(result));
      if (result.data.status === "ERROR") process.exitCode = 1;
    }
  } catch (error) { console.error(safeCode(error)); process.exitCode = 1; }
  finally { process.removeListener("SIGINT", abort); process.removeListener("SIGTERM", abort); }
}
