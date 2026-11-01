import assert from "node:assert/strict";
import test from "node:test";
import { resolveGatewayConfig, runGatewayImport } from "./import-via-gateway.mjs";

const config = { SYNC_SOURCE: "fdci", IMPORT_GATEWAY_TARGET: "canary", IMPORT_GATEWAY_ORIGIN: "http://127.0.0.1:8798",
  IMPORT_GATEWAY_DATABASE_NAME: "docentetuc-web-canary-1-2-local", IMPORT_GATEWAY_DATABASE_ID: "00000000-0000-4000-8000-000000000012",
  FDCI_IMPORT_SECRET: "synthetic_coverage_secret_123456789012", IMPORT_GATE_RUN_ID: "coverage-local", FDCI_SCOPE: "active",
  FDCI_MAX_REQUESTS: "6", FDCI_MAX_PUBLICATIONS: "5", FDCI_PAUSE_MS: "400" };

function fixture(courseCount, commissionCount) {
  const courses = Array.from({ length: courseCount }, (_, i) => ({ capacitacion_id: 100 + i, nombre: "Ficticio", token: `synthetic${i}`, slug: `curso-${i}` }));
  const commissions = Array.from({ length: commissionCount }, (_, i) => ({ id: 9000 + i, capacitacion_id: courses[i % courseCount].capacitacion_id,
    fecha_apertura_preinscripcion: "2026-10-17 23:00:00", fecha_cierre_preinscripcion: "2026-10-19 08:00:00" }));
  const rows = new Map();
  let requests = 0;
  const source = async (url, init) => {
    requests++;
    if (String(url).endsWith("getCapaActivas")) return Response.json(commissions);
    if (String(url).endsWith("getRestoCapas")) return Response.json(courses);
    const parent = courses.find(c => c.token === JSON.parse(init.body).token);
    return Response.json({ comisiones: commissions.filter(c => c.capacitacion_id === parent.capacitacion_id) });
  };
  const receiver = async (url, init) => {
    if (String(url).includes("import-identity")) return Response.json({ id: config.IMPORT_GATEWAY_DATABASE_ID, name: config.IMPORT_GATEWAY_DATABASE_NAME });
    const item = JSON.parse(init.body).items[0];
    const existed = rows.has(item.id), changed = rows.get(item.id) !== item.contentHash;
    rows.set(item.id, item.contentHash);
    return Response.json({ ok: true, received: 1, created: existed ? 0 : 1, updated: existed && changed ? 1 : 0, unchanged: changed ? 0 : 1 });
  };
  return { rows, source, receiver, requests: () => requests };
}

test("límite actual: repetir seis comisiones no alcanza la sexta, aunque devuelve PARTIAL", async () => {
  const f = fixture(1, 6);
  const target = resolveGatewayConfig(config);
  for (let run = 0; run < 2; run++) await assert.rejects(runGatewayImport(target, config, f.source, f.receiver), error => {
    assert.equal(error.message, "FDCI_PARTIAL_SOURCE");
    assert.equal(error.result.batches, 5);
    assert.equal(error.result.deferred, 1);
    assert.equal(error.result.created, run === 0 ? 5 : 0);
    assert.equal(error.result.unchanged, run === 0 ? 0 : 5);
    return true;
  });
  assert.equal(f.rows.size, 5);
  assert.equal(f.rows.has("fdci:commission:9005"), false);
});

test("límite actual: cinco cursos activos agotan seis solicitudes y no escriben una selección incompleta", async () => {
  const f = fixture(5, 5);
  await assert.rejects(runGatewayImport(resolveGatewayConfig(config), config, f.source, f.receiver), error => {
    assert.equal(error.message, "FDCI_SELECTION_INCOMPLETE");
    assert.equal(error.result.sourceRequests, 6);
    assert.equal(error.diagnostics.requestLimit, 1);
    return true;
  });
  assert.equal(f.requests(), 6);
  assert.equal(f.rows.size, 0);
});
