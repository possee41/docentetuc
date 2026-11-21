import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { checkFdciHybridBoundary } from "./check-fdci-hybrid-boundary.mjs";
import { fdciFixtureSql } from "./fdci-local-fixture.mjs";
import { resolveGatewayConfig, runGatewayImport } from "./import-via-gateway.mjs";
const require = createRequire(import.meta.url);
const { Miniflare } = require("../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare");
const { build } = require("../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild");

test("bundle boundary keeps collection, normalization, hashing and cursor decisions in Node", async () => {
  const report = await checkFdciHybridBoundary();
  assert.ok(report.workerBundleBytes > 0);
});

test("Node prepares two records; isolated Workerd only persists bounded requests and durable cursor", async () => {
  const config = { SYNC_SOURCE: "fdci", IMPORT_GATEWAY_TARGET: "canary", IMPORT_GATEWAY_ORIGIN: "http://127.0.0.1:8798",
    IMPORT_GATEWAY_DATABASE_NAME: "docentetuc-web-canary-1-2-local", IMPORT_GATEWAY_DATABASE_ID: "00000000-0000-4000-8000-000000000012",
    FDCI_IMPORT_SECRET: "synthetic_hybrid_secret_123456789012345", IMPORT_GATE_RUN_ID: "hybrid-local", FDCI_SCOPE: "active",
    FDCI_MAX_REQUESTS: "6", FDCI_MAX_PUBLICATIONS: "2", FDCI_PAUSE_MS: "400" };
  const bundle = await build({ entryPoints: ["workers/source-import-gateway.mjs"], bundle: true, format: "esm", platform: "browser", target: "es2022", write: false });
  let outboundCalls = 0;
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-05-15",
    d1Databases: ["DB"], d1Persist: false,
    outboundService() { outboundCalls++; throw new Error("WORKER_NETWORK_FORBIDDEN"); },
    bindings: { IMPORT_GATE_ENABLED: "false", IMPORT_GATE_LEASE_REQUIRED: "true", IMPORT_GATE_ALLOWED_SOURCE: "fdci",
      FDCI_EXTERNAL_ENABLED: "true", FDCI_IMPORT_SECRET: config.FDCI_IMPORT_SECRET,
      IMPORT_DATABASE_NAME: config.IMPORT_GATEWAY_DATABASE_NAME, IMPORT_DATABASE_ID: config.IMPORT_GATEWAY_DATABASE_ID } });
  try {
    const db = await mf.getD1Database("DB");
    for (const text of fdciFixtureSql())
      for (const sql of text.replace(/^--.*$/gm, "").split(";").map(x => x.trim()).filter(Boolean)) await db.prepare(sql).run();
    await db.prepare("INSERT INTO import_gateway_identity VALUES(1,?,?)").bind(config.IMPORT_GATEWAY_DATABASE_NAME, config.IMPORT_GATEWAY_DATABASE_ID).run();
    await db.prepare("INSERT INTO import_gate_lease VALUES(1,'fdci','2099-01-01T00:00:00Z','2026-01-01T00:00:00Z',?)").bind(config.IMPORT_GATE_RUN_ID).run();
    const courses = [{ capacitacion_id: 42, nombre: "Curso sintético", token: "synthetic", slug: "synthetic" }];
    const commissions = [9001, 9002].map(id => ({ id, capacitacion_id: 42,
      fecha_apertura_preinscripcion: "2026-01-01 08:00:00", fecha_cierre_preinscripcion: "2099-12-01 08:00:00" }));
    let sourceCalls = 0, received = 0;
    const publicationAcks = [];
    const source = async url => {
      sourceCalls++;
      assert.equal(new URL(url).hostname, "apicapacitaciones.educaciontuc.edu.ar");
      return Response.json(String(url).endsWith("getCapaActivas") ? commissions :
        String(url).endsWith("getRestoCapas") ? courses : { comisiones: commissions });
    };
    const receiver = async (url, init) => {
      if (new URL(url).pathname === "/api/internal/fdci-import") {
        const body = JSON.parse(init.body);
        assert.equal(body.items.length, 1);
        assert.match(body.items[0].contentHash, /^[a-f0-9]{64}$/);
        assert.equal(JSON.parse(body.items[0].metadata).entity, "commission");
        received++;
      }
      const response = await mf.dispatchFetch(url, init);
      if (new URL(url).pathname === "/api/internal/fdci-import" && response.ok)
        publicationAcks.push(await response.clone().json());
      return response;
    };
    const target = resolveGatewayConfig(config);
    const first = await runGatewayImport(target, config, source, receiver);
    assert.equal(first.created, 2); assert.equal(first.cycleComplete, true);
    const second = await runGatewayImport(target, config, source, receiver);
    assert.equal(second.created, 0); assert.equal(second.updated, 0); assert.equal(second.unchanged, 2);
    assert.equal(second.cycleComplete, true);
    assert.ok(publicationAcks.slice(2).every(ack => ack.rowsWritten === 0));
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM publications").first()).n, 2);
    assert.equal((await db.prepare("SELECT cycle FROM fdci_import_checkpoint WHERE id=1").first()).cycle, 3);
    assert.equal(received, 4); assert.equal(sourceCalls, 6); assert.equal(outboundCalls, 0);
    const unauthorized = await mf.dispatchFetch("http://local.test/api/internal/fdci-import", { method: "POST" });
    assert.equal(unauthorized.status, 401);
  } finally { await mf.dispose(); }
});
