import assert from "node:assert/strict";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { evaluateCanary, runOne, validateTarget, verifyRemoteIdentity, verifyWorkerMetadata } from "../scripts/run-push-canary.mjs";

const config = JSON.parse(readFileSync("wrangler.push-canary.json", "utf8"));
const isolated = { ...config, d1_databases: [{ ...config.d1_databases[0], database_id: "11111111-1111-1111-1111-111111111111" }] };
const token = "synthetic_canary_token_12345678901234567890";
const readToken = "synthetic_read_only_token";
const accountId = "22222222-2222-2222-2222-222222222222";
const runId = "push-test1234";
const scenario = "500-dense";

test("canary limita escenarios, configuración y URL al Worker independiente", () => {
  const input = { scenario, accountId, subdomain: "only-canary", token, readToken, config: isolated };
  assert.equal(validateTarget(input).url, "https://docentetuc-push-canary-1-2.only-canary.workers.dev");
  for (const bad of [
    { ...input, scenario: "100-sparse" },
    { ...input, subdomain: "docentetuc.com.ar" },
    { ...input, config: { ...isolated, routes: ["docentetuc.com.ar/*"] } },
    { ...input, config: { ...isolated, d1_databases: [{ ...isolated.d1_databases[0], database_name: "docentetuc-db" }] } },
  ]) assert.throws(() => validateTarget(bad), /CANARY_INPUT_INVALID|PUSH_CANARY_CONFIG_UNSAFE/);
});

const metadataRequest = async (input: RequestInfo | URL) => Response.json({ success: true, result:
  String(input).endsWith("/scripts/docentetuc-push-canary-1-2/settings")
    ? { bindings: [{ name: "DB", type: "d1", database_id: isolated.d1_databases[0].database_id },
      { name: "CANARY_BEARER_TOKEN", type: "secret_text" }, { name: "CANARY_BUILD_ID", type: "plain_text" }] }
    : String(input).endsWith("/scripts/docentetuc-push-canary-1-2/subdomain") ? { enabled: true } : { subdomain: "only-canary" } });

test("metadatos del Worker exigen subdominio y binding D1 exactos", () => {
  const bindings = [{ name: "DB", type: "d1", database_id: isolated.d1_databases[0].database_id },
    { name: "CANARY_BEARER_TOKEN", type: "secret_text" }];
  assert.doesNotThrow(() => verifyWorkerMetadata({ subdomain: "only-canary" }, { enabled: true },
    { bindings }, "only-canary", isolated.d1_databases[0].database_id));
  assert.throws(() => verifyWorkerMetadata({ subdomain: "otro" }, { enabled: true },
    { bindings }, "only-canary", isolated.d1_databases[0].database_id));
  assert.throws(() => verifyWorkerMetadata({ subdomain: "only-canary" }, { enabled: true },
    { bindings: [{ ...bindings[0], database_id: "baaf5886-0123-4948-96da-aa7106424549" }] },
    "only-canary", isolated.d1_databases[0].database_id));
});

test("metadatos Worker erróneos detienen todo antes de consultas D1", async () => {
  let cliCalls = 0;
  await assert.rejects(runOne({ scenario, runId, accountId, subdomain: "only-canary", token, readToken,
    config: isolated, cli: () => { cliCalls++; throw new Error("D1_SHOULD_NOT_RUN"); },
    metadataRequest: async () => Response.json({ success: true, result: { subdomain: "wrong" } }),
    ask: async () => { throw new Error("PROMPT_SHOULD_NOT_RUN"); } }), /CANARY_WORKER_METADATA_MISMATCH/);
  assert.equal(cliCalls, 0);
});

test("identidad remota exige nombre, UUID, marker y Worker desplegado", () => {
  const info = { name: "docentetuc-push-canary-1-2", uuid: isolated.d1_databases[0].database_id };
  const marker = [{ success: true, results: [{ marker: "docentetuc-push-canary-1-2" }] }];
  assert.doesNotThrow(() => verifyRemoteIdentity(info, marker, [{ id: "deployment" }], info.uuid));
  assert.throws(() => verifyRemoteIdentity({ ...info, name: "docentetuc-db" }, marker, [{ id: "deployment" }], info.uuid));
  assert.throws(() => verifyRemoteIdentity(info, [{ success: true, results: [{ marker: "wrong" }] }], [{ id: "deployment" }], info.uuid));
  assert.throws(() => verifyRemoteIdentity(info, marker, [], info.uuid));
});

test("sin confirmación o identidad correcta no hay semilla ni invocación", async () => {
  const calls: string[] = [];
  const cli = (args: string[]) => {
    calls.push(args.join(" "));
    if (args[0] === "whoami") return JSON.stringify({ accounts: [{ id: accountId }] });
    if (args[1] === "info") return JSON.stringify({ name: "docentetuc-push-canary-1-2", uuid: isolated.d1_databases[0].database_id });
    if (args[1] === "execute") return JSON.stringify([{ success: true, results: [{ marker: "docentetuc-push-canary-1-2" }] }]);
    return JSON.stringify([{ id: "deployment" }]);
  };
  const input = { scenario, runId, accountId, subdomain: "only-canary", token, readToken,
    config: isolated, cli, metadataRequest: async (input: RequestInfo | URL) => {
      const response = await metadataRequest(input);
      const body = await response.json() as { result: { bindings: Array<{ database_id: string }> } };
      if (String(input).endsWith("/settings")) body.result.bindings[0].database_id = isolated.d1_databases[0].database_id;
      return Response.json(body);
    }, send: async () => { throw new Error("FETCH_FORBIDDEN"); } };
  await assert.rejects(runOne({ ...input, ask: async () => "NO" }), /CANARY_NOT_CONFIRMED/);
  assert.equal(calls.length, 4);
  assert.ok(calls.every((line) => !line.includes("--file")));
  await assert.rejects(runOne({ ...input, cli: (args: string[]) =>
    args[1] === "info" ? JSON.stringify({ name: "docentetuc-db", uuid: isolated.d1_databases[0].database_id }) : cli(args),
  ask: async () => { throw new Error("PROMPT_SHOULD_NOT_RUN"); } }), /CANARY_REMOTE_IDENTITY_MISMATCH/);
});

test("una sola semilla, un envío simulado y CPU manual obligatoria", async () => {
  const calls: string[] = [];
  const cli = (args: string[]) => {
    calls.push(args.join(" "));
    if (args[0] === "whoami") return JSON.stringify({ accounts: [{ id: accountId }] });
    if (args[1] === "info") return JSON.stringify({ name: "docentetuc-push-canary-1-2", uuid: isolated.d1_databases[0].database_id });
    if (args[1] === "execute" && args.includes("--command"))
      return JSON.stringify([{ success: true, results: [{ marker: "docentetuc-push-canary-1-2" }] }]);
    if (args[1] === "execute") return JSON.stringify([{ success: true }]);
    return JSON.stringify([{ id: "deployment" }]);
  };
  let sends = 0;
  const send = async () => { sends++;
    return Response.json({ runId, scenario, result: { considered: 2, sent: 2, failed: 0, removed: 0, deferred: 0 },
      d1: { queries: 11, rowsRead: 17, rowsWritten: 14 }, isolateId: "local-isolate", isolateInvocation: 1, wallMs: 2000 }); };
  const tempConfigPath = join(process.cwd(), "wrangler.push-canary.test-temp.json");
  writeFileSync(tempConfigPath, JSON.stringify(isolated, null, 2));
  const answers = [`EJECUTAR ${scenario} ${runId}`, "", "ok"];
  let result;
  try {
    result = await runOne({ scenario, runId, accountId, subdomain: "only-canary", token, readToken,
      config: isolated, cli, send, metadataRequest, ask: async () => answers.shift() || "", configPath: tempConfigPath as any });
  } finally {
    try { unlinkSync(tempConfigPath); } catch {}
  }
  assert.equal(sends, 1);
  assert.equal(calls.filter((line) => line.includes("--file")).length, 1);
  const measurement = result.measurement as unknown as { status: string, reasons: string[] };
  assert.equal(measurement.status, "STOP");
  assert.deepEqual(measurement.reasons, ["CPU_LOG_REQUIRED"]);
  assert.ok(!JSON.stringify(result).includes(token) && !JSON.stringify(result).includes(readToken));
});

test("CPU, outcome y resultado funcional detienen el avance", () => {
  const body = { runId, scenario, result: { considered: 2, sent: 2, failed: 0, removed: 0, deferred: 0 },
    d1: { queries: 11, rowsRead: 17, rowsWritten: 14 }, isolateId: "local", isolateInvocation: 1, wallMs: 2047 };
  assert.equal(evaluateCanary({ scenario, runId, status: 200, body, cpuTimeMs: 6, outcome: "ok" }).status, "PASS");
  assert.ok(evaluateCanary({ scenario, runId, status: 200, body, cpuTimeMs: 8, outcome: "ok" }).reasons.includes("CPU_OVER_7_MS"));
  assert.ok(evaluateCanary({ scenario, runId, status: 1102, body: null, cpuTimeMs: null, outcome: "exceededCpu" }).reasons.includes("HTTP_1102"));
  assert.ok(evaluateCanary({ scenario, runId, status: 200, body: { ...body, result: { ...body.result, sent: 1 } },
    cpuTimeMs: 5, outcome: "ok" }).reasons.includes("FUNCTIONAL_OR_D1_RESULT_INVALID"));
});
