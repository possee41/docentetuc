// One synthetic canary scenario per invocation. No Cloudflare call occurs on import.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkPushCanaryConfig } from "./check-push-canary-config.mjs";
import { generatePushCanarySql } from "./generate-push-canary-sql.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NAME = "docentetuc-push-canary-1-2";
const MARKER = NAME;
const SCENARIOS = new Set(["500-dense", "1000-sparse", "1000-dense"]);
const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const RUN_ID = /^[a-z\d-]{8,48}$/;

export function validateTarget({ scenario, accountId, subdomain, token, readToken, config }) {
  if (!SCENARIOS.has(scenario) || !UUID.test(accountId || "") ||
      !/^[a-z\d-]{2,63}$/.test(subdomain || "") ||
      !/^[A-Za-z\d_-]{32,}$/.test(token || "") ||
      typeof readToken !== "string" || !readToken.trim()) throw new Error("CANARY_INPUT_INVALID");
  checkPushCanaryConfig(config);
  const db = config.d1_databases[0];
  return { dbId: db.database_id.toLowerCase(),
    url: `https://${NAME}.${subdomain}.workers.dev` };
}

export function verifyWorkerMetadata(accountSubdomain, workerSubdomain, settings, subdomain, dbId) {
  const bindings = settings?.bindings;
  const d1 = Array.isArray(bindings) ? bindings.filter((binding) => binding.type === "d1") : [];
  if (accountSubdomain?.subdomain !== subdomain || workerSubdomain?.enabled !== true ||
      !Array.isArray(bindings) || d1.length !== 1 || d1[0].name !== "DB" ||
      d1[0].database_id?.toLowerCase() !== dbId ||
      !bindings.some((binding) => binding.name === "CANARY_BEARER_TOKEN" && binding.type === "secret_text") ||
      bindings.some((binding) => !["DB", "CANARY_BEARER_TOKEN", "CANARY_BUILD_ID"].includes(binding.name)))
    throw new Error("CANARY_WORKER_METADATA_MISMATCH");
}

export function verifyRemoteIdentity(info, markerResult, deployments, dbId) {
  const database = Array.isArray(info) ? info[0] : info?.result || info;
  const remoteId = database?.uuid || database?.id;
  const remoteName = database?.name;
  const statement = Array.isArray(markerResult) ? markerResult[0] : markerResult?.result || markerResult;
  const rows = statement?.results;
  const deploymentList = Array.isArray(deployments) ? deployments : deployments?.deployments || deployments?.result;
  if (remoteName !== NAME || typeof remoteId !== "string" || remoteId.toLowerCase() !== dbId ||
      statement?.success !== true || !Array.isArray(rows) || rows.length !== 1 || rows[0]?.marker !== MARKER ||
      !Array.isArray(deploymentList) || deploymentList.length === 0)
    throw new Error("CANARY_REMOTE_IDENTITY_MISMATCH");
}

export function evaluateCanary({ scenario, runId, status, body, cpuTimeMs, outcome }) {
  const reasons = [];
  if (status === 1102) reasons.push("HTTP_1102");
  else if (status !== 200) reasons.push("WORKER_HTTP_ERROR");
  const expected = { "500-dense": 2, "1000-sparse": 2, "1000-dense": 2 }[scenario];
  const d1 = body?.d1;
  const metricsValid = Number.isSafeInteger(d1?.queries) && Number.isSafeInteger(d1?.rowsRead) &&
    Number.isSafeInteger(d1?.rowsWritten) && d1.queries >= 0 && d1.rowsRead >= 0 && d1.rowsWritten >= 0;
  if (body?.runId !== runId || body?.scenario !== scenario || body?.result?.considered !== expected ||
      body?.result?.sent !== expected || body?.result?.failed !== 0 || body?.result?.removed !== 0 ||
      body?.result?.deferred !== 0 || !metricsValid || d1.queries >= 50 ||
      typeof body?.isolateId !== "string" || !Number.isSafeInteger(body?.isolateInvocation))
    reasons.push("FUNCTIONAL_OR_D1_RESULT_INVALID");
  if (cpuTimeMs == null || !Number.isFinite(cpuTimeMs) || cpuTimeMs < 0) reasons.push("CPU_LOG_REQUIRED");
  else if (cpuTimeMs > 7) reasons.push("CPU_OVER_7_MS");
  if (!outcome) reasons.push("OUTCOME_LOG_REQUIRED");
  else if (outcome !== "ok") reasons.push(outcome === "exceededCpu" ? "EXCEEDED_CPU" : "OUTCOME_NOT_OK");
  return { status: reasons.length ? "STOP" : "PASS", reasons: [...new Set(reasons)],
    httpStatus: status, cpuTimeMs, outcome, workerWallMs: Number.isFinite(body?.wallMs) ? body.wallMs : null,
    d1: metricsValid ? { queries: d1.queries, rowsRead: d1.rowsRead, rowsWritten: d1.rowsWritten } : null,
    result: body?.result && status === 200 ? { considered: body.result.considered, sent: body.result.sent,
      failed: body.result.failed, removed: body.result.removed, deferred: body.result.deferred } : null,
    isolateId: typeof body?.isolateId === "string" ? body.isolateId : null,
    isolateInvocation: Number.isSafeInteger(body?.isolateInvocation) ? body.isolateInvocation : null };
}

export function markdownReport(report) {
  const result = report.measurement || {};
  return `# Push canary ${report.scenario} — ${report.runId}\n\n` +
    `- Estado: **${result.status || "STOP"}**\n- Motivos: ${(result.reasons || []).join(", ") || "ninguno"}\n` +
    `- CPU Cloudflare: ${result.cpuTimeMs ?? "pendiente"} ms (Workers Logs)\n` +
    `- Outcome Cloudflare: ${result.outcome || "pendiente"}\n` +
    `- Wall del Worker: ${result.workerWallMs ?? "pendiente"} ms; no es CPU\n` +
    `- HTTP: ${result.httpStatus ?? "pendiente"}\n` +
    `- D1 consultas/leídas/escritas: ${result.d1 ? `${result.d1.queries}/${result.d1.rowsRead}/${result.d1.rowsWritten}` : "pendiente"}\n` +
    `- Entregas simuladas: ${result.result?.sent ?? "pendiente"}\n` +
    `- Isolate: ${result.isolateId || "pendiente"}, invocación ${result.isolateInvocation ?? "pendiente"}\n` +
    `\nSin envío push real. Cada escenario requiere una ejecución autorizada por separado.\n`;
}

function wrangler(args, accountId) {
  const command = resolve(ROOT, "node_modules/wrangler/bin/wrangler.js");
  const childEnv = { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId };
  delete childEnv.PUSH_CANARY_TOKEN;
  delete childEnv.PUSH_CANARY_READ_TOKEN;
  const result = spawnSync(process.execPath, [command, ...args], { cwd: ROOT, encoding: "utf8",
    env: childEnv, timeout: 120_000, maxBuffer: 2_000_000 });
  if (result.error || result.status !== 0) throw new Error("WRANGLER_COMMAND_FAILED");
  return result.stdout;
}

async function readWorkerMetadata(accountId, readToken, request = fetch) {
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers`;
  const paths = ["/subdomain", `/scripts/${NAME}/subdomain`, `/scripts/${NAME}/settings`];
  const results = [];
  for (const path of paths) {
    let response;
    try { response = await request(base + path, { headers: { Authorization: `Bearer ${readToken}` },
      signal: AbortSignal.timeout(15_000) }); }
    catch { throw new Error("CANARY_METADATA_READ_FAILED"); }
    if (!response.ok) throw new Error("CANARY_METADATA_READ_FAILED");
    let body;
    try { body = await response.json(); } catch { throw new Error("CANARY_METADATA_READ_FAILED"); }
    if (body?.success !== true || !body.result) throw new Error("CANARY_METADATA_READ_FAILED");
    results.push(body.result);
  }
  return results;
}

function jsonOutput(value) {
  try { return JSON.parse(value); } catch { throw new Error("WRANGLER_JSON_INVALID"); }
}

async function question(prompt) {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await input.question(prompt)).trim(); } finally { input.close(); }
}

export async function runOne({ scenario, accountId, subdomain, token, readToken, config,
  cli = wrangler, send = fetch, metadataRequest = fetch, ask = question,
  now = new Date(), runId = `push-${randomBytes(6).toString("hex")}`,
  configPath = "" }) {
  if (!RUN_ID.test(runId)) throw new Error("CANARY_RUN_ID_INVALID");
  const target = validateTarget({ scenario, accountId, subdomain, token, readToken, config });
  const report = { scenario, runId, measuredAt: now.toISOString(), worker: NAME, measurement: null };
  const resolvedConfigPath = resolve(configPath || resolve(ROOT, "wrangler.push-canary.json"));
  const base = ["--config", resolvedConfigPath];
  // These checks are read-only. Any unexpected response stops before seeding or invoking.
  const metadata = await readWorkerMetadata(accountId, readToken, metadataRequest);
  verifyWorkerMetadata(...metadata, subdomain, target.dbId);
  const who = jsonOutput(cli(["whoami", "--account", accountId, "--json"], accountId));
  if (!JSON.stringify(who).includes(accountId)) throw new Error("CANARY_ACCOUNT_MISMATCH");
  const info = jsonOutput(cli(["d1", "info", NAME, "--json", ...base], accountId));
  const marker = jsonOutput(cli(["d1", "execute", "DB", "--remote", "--json",
    "--command", "SELECT marker FROM push_canary_identity LIMIT 1", ...base], accountId));
  const deployments = jsonOutput(cli(["deployments", "list", "--name", NAME, "--json", ...base], accountId));
  verifyRemoteIdentity(info, marker, deployments, target.dbId);
  const phrase = `EJECUTAR ${scenario} ${runId}`;
  if (await ask(`Canary ${NAME}, D1 verificada, URL ${target.url}. Escribí '${phrase}' para sembrar e invocar una vez: `) !== phrase)
    throw new Error("CANARY_NOT_CONFIRMED");
  const seedFile = resolve(ROOT, "outputs", `push-canary-seed-${runId}.sql`);
  mkdirSync(dirname(seedFile), { recursive: true });
  writeFileSync(seedFile, generatePushCanarySql({ count: Number(scenario.split("-")[0]),
    density: scenario.split("-")[1], now }), "utf8");
  // Recheck local config immediately before the first remote write.
  checkPushCanaryConfig(JSON.parse(readFileSync(resolvedConfigPath, "utf8")));
  if (JSON.parse(readFileSync(resolvedConfigPath, "utf8")).d1_databases[0].database_id.toLowerCase() !== target.dbId)
    throw new Error("CANARY_CONFIG_CHANGED");
  const seeded = jsonOutput(cli(["d1", "execute", "DB", "--remote", "--yes", "--json",
    "--file", seedFile, ...base], accountId));
  const seedResults = Array.isArray(seeded) ? seeded : seeded?.result;
  if (!Array.isArray(seedResults) || !seedResults.length || seedResults.some((item) => item?.success !== true))
    throw new Error("CANARY_SEED_FAILED");
  let response;
  try {
    response = await send(`${target.url}/run/${scenario}/${runId}`, { method: "POST",
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  } catch { report.measurement = { status: "STOP", reasons: ["WORKER_REQUEST_FAILED", "CPU_LOG_REQUIRED"] }; return report; }
  let body;
  try { body = await response.json(); } catch { body = null; }
  // The official query endpoint currently requires Observability Write. Never use it with an elevated token.
  const cpuText = await ask(`Workers Logs para ${runId}: cpuTimeMs (Enter si falta): `);
  const outcome = await ask(`Workers Logs para ${runId}: outcome (Enter si falta): `);
  const cpu = cpuText && /^\d+(?:\.\d+)?$/.test(cpuText) ? Number(cpuText) : null;
  report.measurement = evaluateCanary({ scenario, runId, status: response.status, body, cpuTimeMs: cpu, outcome });
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, "").split("=")));
  const runId = `push-${randomBytes(6).toString("hex")}`;
  const report = { scenario: args.scenario || "", runId, measuredAt: new Date().toISOString(), worker: NAME,
    measurement: { status: "STOP", reasons: ["NOT_STARTED"] } };
  try {
    if (Object.keys(args).length !== 1 || !SCENARIOS.has(args.scenario)) throw new Error("CANARY_SCENARIO_INVALID");
    const config = JSON.parse(readFileSync(resolve(ROOT, "wrangler.push-canary.json"), "utf8"));
    const result = await runOne({ scenario: args.scenario, accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      subdomain: process.env.PUSH_CANARY_WORKERS_SUBDOMAIN, token: process.env.PUSH_CANARY_TOKEN,
      readToken: process.env.PUSH_CANARY_READ_TOKEN,
      config, runId });
    Object.assign(report, result);
  } catch (error) {
    report.measurement = { status: "STOP", reasons: [error instanceof Error && /^CANARY_|^WRANGLER_/.test(error.message)
      ? error.message : "CANARY_UNEXPECTED_ERROR"] };
  }
  const outputDir = resolve(ROOT, "outputs");
  mkdirSync(outputDir, { recursive: true });
  const prefix = resolve(outputDir, `push-canary-${runId}`);
  if (existsSync(`${prefix}.json`) || existsSync(`${prefix}.md`)) throw new Error("CANARY_REPORT_EXISTS");
  writeFileSync(`${prefix}.json`, JSON.stringify(report, null, 2) + "\n", "utf8");
  writeFileSync(`${prefix}.md`, markdownReport(report), "utf8");
  console.log(`${report.measurement.status}: ${report.measurement.reasons.join(", ") || "OK"}. Informes: ${prefix}.json y .md`);
  if (report.measurement.status !== "PASS") process.exitCode = 1;
}
