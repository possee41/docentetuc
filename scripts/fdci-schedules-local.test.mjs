import assert from "node:assert/strict";
import test from "node:test";
import gateway from "../workers/source-import-gateway.mjs";
import { runIncrementalFdci } from "./fdci-incremental.mjs";
import { fdciLocalFixture } from "./fdci-local-fixture.mjs";
import { fdciScheduleScenarios, projectFdciSchedule } from "./simulate-fdci-schedules.mjs";
import { checkFdciHybridBoundary } from "./check-fdci-hybrid-boundary.mjs";
import { runFdciAutomation } from "./fdci-automation.mjs";

test("12 offline projections reserve lost turns and additional work without enabling execution", () => {
  const expected = { 30: [48, 24, 32], 100: [160, 80, 108], 500: [800, 400, 534], 1000: [1600, 800, 1068] };
  for (const count of [30, 100, 500, 1000]) {
    assert.deepEqual(fdciScheduleScenarios.map(s => projectFdciSchedule(count, s).reservedCycleHours), expected[count]);
    for (const scenario of fdciScheduleScenarios) {
      const p = projectFdciSchedule(count, scenario);
      // Independently simulate slot admission and the reserved work units.
      let completed = 0, slots = 0;
      while (completed < p.reservedWorkUnits) {
        slots++;
        if (Math.floor(slots * 0.75) > Math.floor((slots - 1) * 0.75)) completed += scenario.batch;
      }
      assert.equal(slots, p.requiredSlots);
      assert.equal(p.fits24HoursWithReserve, slots * scenario.intervalHours <= 24);
    }
  }
  assert.deepEqual(fdciScheduleScenarios.map(s => projectFdciSchedule(30, s).dailyRecordsWithReserve), [15, 30, 22]);
  assert.equal(projectFdciSchedule(0, fdciScheduleScenarios[0]).requiredSlots, 0);
  assert.throws(() => projectFdciSchedule(30, fdciScheduleScenarios[0], 100), /SIMULATION_INPUT_INVALID/);
});

for (const count of [30, 100, 500, 1000]) test(`real incremental algorithm: ${count} synthetic records, batches <=2, durable ACK and unchanged replay`, async t => {
  const { sqlite, db } = fdciLocalFixture(); t.after(() => sqlite.close());
  const name = "synthetic-canary", id = "synthetic-id", owner = "schedule-local";
  const secret = "synthetic_schedule_secret_12345678901234";
  sqlite.prepare("INSERT INTO import_gateway_identity VALUES(1,?,?)").run(name, id);
  sqlite.exec("INSERT INTO import_gate_lease VALUES(1,'fdci','2099-01-01T00:00:00Z','2026-01-01T00:00:00Z','schedule-local')");
  const env = { DB: db, IMPORT_DATABASE_NAME: name, IMPORT_DATABASE_ID: id, FDCI_IMPORT_SECRET: secret,
    IMPORT_GATE_ENABLED: "false", IMPORT_GATE_LEASE_REQUIRED: "true", IMPORT_GATE_ALLOWED_SOURCE: "fdci", FDCI_EXTERNAL_ENABLED: "true" };
  const courses = [{ capacitacion_id: 100, nombre: "Curso sintético", token: "synthetic", slug: "synthetic" }];
  const commissions = Array.from({ length: count }, (_, i) => ({ id: 9000 + i, capacitacion_id: 100,
    fecha_apertura_preinscripcion: "2026-01-01 08:00:00", fecha_cierre_preinscripcion: "2099-12-01 08:00:00" }));
  const target = { origin: "http://127.0.0.1:8798", endpoint: "http://127.0.0.1:8798/api/internal/fdci-import", secret };
  let sourceCalls = 0, accepted = 0;
  const fetcher = async (url, init) => {
    if (new URL(url).origin !== target.origin) {
      assert.equal(new URL(url).hostname, "apicapacitaciones.educaciontuc.edu.ar");
      sourceCalls++;
      assert.ok(sourceCalls <= 6);
      return Response.json(String(url).endsWith("getCapaActivas") ? commissions :
        String(url).endsWith("getRestoCapas") ? courses : { comisiones: commissions });
    }
    const response = await gateway.fetch(new Request(url, init), env);
    if (new URL(url).pathname.endsWith("fdci-import")) {
      assert.equal(JSON.parse(init.body).items.length, 1);
      assert.equal(response.status, 200); accepted++;
    }
    return response;
  };
  let runs = 0, examined = 0, created = 0, result;
  do {
    sourceCalls = 0;
    result = await runIncrementalFdci(target, { maxPublications: 2, owner }, fetcher);
    assert.ok(result.examined <= 2); assert.equal(result.failed, false);
    examined += result.examined; created += result.created; runs++;
    assert.ok(runs <= Math.ceil(count / 2));
  } while (!result.cycleComplete);
  assert.equal(runs, Math.ceil(count / 2)); assert.equal(examined, count); assert.equal(created, count);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM publications").get().n, count);
  assert.equal(accepted, count);
  assert.equal(sqlite.prepare("SELECT cycle FROM fdci_import_checkpoint WHERE id=1").get().cycle, 2);
  sourceCalls = 0;
  const repeated = await runIncrementalFdci(target, { maxPublications: 2, owner }, fetcher);
  assert.equal(repeated.created, 0); assert.equal(repeated.updated, 0); assert.equal(repeated.unchanged, 2);
  t.diagnostic(`${count} records: ${runs} independent logical runs; source/HTTP mocked, SQLite in memory, no time/frequency or Cloudflare CPU measurement`);
});

test("heavy modules remain in Node and three-record automation still fails before networking", async () => {
  await checkFdciHybridBoundary();
  const sha = "a".repeat(40);
  const failNetwork = () => { throw new Error("NETWORK_MUST_NOT_RUN"); };
  const result = await runFdciAutomation({ FDCI_AUTOMATION_ENABLED: "true", SYNC_SOURCE: "fdci",
    IMPORT_GATEWAY_APPROVED_SHA: sha, FDCI_MAX_PUBLICATIONS: "3", FDCI_MAX_REQUESTS: "6", FDCI_PAUSE_MS: "400" },
  sha, failNetwork, failNetwork);
  assert.equal(result.code, "AUTOMATION_CONFIG_INVALID");
});
