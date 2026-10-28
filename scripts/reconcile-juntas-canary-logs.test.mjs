import assert from "node:assert/strict";
import test from "node:test";
import { reconcileJuntasLogs } from "./reconcile-juntas-canary-logs.mjs";

const routes = ["/api/internal/import-identity", ...Array(12).fill("/api/internal/juntas-checkpoint"),
  "/api/internal/public-source-import/juntas"];
const logs = routes.map((route, index) => ({ timestamp: Date.parse("2026-10-28T04:28:41Z") + index * 1000,
  $metadata: { service: "docentetuc-import-canary-1-2", trigger: `POST ${route}`,
    requestId: `synthetic-${index}`, statusCode: 200 },
  $workers: { cpuTimeMs: 3, outcome: "ok" } }));

test("reconciles exactly fourteen safe invocation records", () => {
  const result = reconcileJuntasLogs([...logs, { ...logs[0], $workers: {} }]);
  assert.equal(result.found, 14);
  assert.equal(result.readyForResume, true);
  assert.equal(result.byRoute["/api/internal/juntas-checkpoint"], 12);
  assert.equal(result.runId, null);
});

test("missing, over-budget or failed CPU keeps resumption blocked", () => {
  assert.equal(reconcileJuntasLogs(logs.slice(0, 4)).readyForResume, false);
  assert.equal(reconcileJuntasLogs(logs.map((row, index) => index === 8
    ? { ...row, $workers: { cpuTimeMs: 8, outcome: "ok" } } : row)).readyForResume, false);
  assert.equal(reconcileJuntasLogs(logs.map((row, index) => index === 8
    ? { ...row, $workers: { cpuTimeMs: 3, outcome: "exceededCpu" } } : row)).readyForResume, false);
});
