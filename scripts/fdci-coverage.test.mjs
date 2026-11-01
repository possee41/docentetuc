import assert from "node:assert/strict";
import test from "node:test";
import gateway from "../workers/source-import-gateway.mjs";
import { resolveGatewayConfig, runGatewayImport } from "./import-via-gateway.mjs";
import { checkpointRequest, fdciKey } from "./fdci-incremental.mjs";
import { fdciLocalFixture } from "./fdci-local-fixture.mjs";

const config = { SYNC_SOURCE: "fdci", IMPORT_GATEWAY_TARGET: "canary", IMPORT_GATEWAY_ORIGIN: "http://127.0.0.1:8798",
  IMPORT_GATEWAY_DATABASE_NAME: "docentetuc-web-canary-1-2-local", IMPORT_GATEWAY_DATABASE_ID: "00000000-0000-4000-8000-000000000012",
  FDCI_IMPORT_SECRET: "synthetic_coverage_secret_123456789012", IMPORT_GATE_RUN_ID: "coverage-local", FDCI_SCOPE: "active",
  FDCI_MAX_REQUESTS: "6", FDCI_MAX_PUBLICATIONS: "5", FDCI_PAUSE_MS: "400" };

function fixture(commissionCount = 30, courseCount = 1) {
  const { sqlite, db } = fdciLocalFixture();
  sqlite.prepare("INSERT INTO import_gateway_identity VALUES(1,?,?)").run(config.IMPORT_GATEWAY_DATABASE_NAME, config.IMPORT_GATEWAY_DATABASE_ID);
  sqlite.exec("INSERT INTO import_gate_lease VALUES(1,'fdci','2099-01-01T00:00:00Z','2026-01-01T00:00:00Z','coverage-local')");
  const env = { DB: db, IMPORT_GATE_ENABLED: "false", IMPORT_GATE_LEASE_REQUIRED: "true", IMPORT_GATE_ALLOWED_SOURCE: "fdci",
    IMPORT_DATABASE_NAME: config.IMPORT_GATEWAY_DATABASE_NAME, IMPORT_DATABASE_ID: config.IMPORT_GATEWAY_DATABASE_ID,
    FDCI_IMPORT_SECRET: config.FDCI_IMPORT_SECRET, FDCI_EXTERNAL_ENABLED: "true" };
  const courses = Array.from({ length: courseCount }, (_, i) => ({ capacitacion_id: 100 + i, nombre: "Ficticio", token: `synthetic${i}`, slug: `curso-${i}` }));
  const commissions = Array.from({ length: commissionCount }, (_, i) => ({ id: 9000 + i, capacitacion_id: courses[i % courseCount].capacitacion_id,
    fecha_apertura_preinscripcion: "2026-10-17 23:00:00", fecha_cierre_preinscripcion: "2026-10-19 08:00:00" }));
  let sourceCalls = 0;
  const controls = { reverse: false, failCourse: null, failOnce: false, dropAck: false, dropCursorAck: false, expireAfterWrite: false };
  const source = async (url, init) => {
    sourceCalls++;
    if (String(url).endsWith("getCapaActivas")) return Response.json(controls.reverse ? [...commissions].reverse() : commissions);
    if (String(url).endsWith("getRestoCapas")) return Response.json(controls.reverse ? [...courses].reverse() : courses);
    const parent = courses.find(c => c.token === JSON.parse(init.body).token);
    if (controls.failOnce) { controls.failOnce = false; throw new Error("synthetic network error"); }
    if (controls.failCourse === parent.capacitacion_id) return new Response(null, { status: 404 });
    return Response.json({ comisiones: commissions.filter(c => c.capacitacion_id === parent.capacitacion_id) });
  };
  const receiver = async (url, init) => {
    const response = await gateway.fetch(new Request(url, init), env);
    if (String(url).endsWith("fdci-import") && response.ok) {
      if (controls.expireAfterWrite) { controls.expireAfterWrite = false; sqlite.exec("UPDATE import_gate_lease SET expires_at='2000-01-01T00:00:00Z'"); }
      if (controls.dropAck) { controls.dropAck = false; throw new Error("synthetic ACK lost after commit"); }
    }
    if (String(url).endsWith("fdci-checkpoint") && JSON.parse(init.body).op === "advance" && response.ok && controls.dropCursorAck) {
      controls.dropCursorAck = false; throw new Error("synthetic checkpoint ACK lost after commit");
    }
    return response;
  };
  const target = resolveGatewayConfig(config);
  const run = () => runGatewayImport(target, config, source, receiver);
  return { sqlite, db, env, courses, commissions, controls, source, receiver, target, run, sourceCalls: () => sourceCalls,
    state: () => sqlite.prepare("SELECT * FROM fdci_import_checkpoint").get(),
    count: () => sqlite.prepare("SELECT COUNT(*) AS n FROM publications").get().n };
}

async function cycle(f, maxRuns = 40) {
  const results = [];
  do {
    results.push(await f.run());
    assert.ok(results.at(-1).batches <= 5);
    assert.ok(results.at(-1).sourceRequests <= 6);
    assert.ok(results.length <= maxRuns, "cycle did not finish");
  } while (!results.at(-1).cycleComplete);
  return results;
}

test("30 comisiones: seis lotes de cinco, sin omisiones; siguiente ciclo sin escrituras de publicaciones", async () => {
  const f = fixture();
  const first = await cycle(f);
  assert.equal(first.length, 6);
  assert.equal(f.count(), 30);
  assert.equal(first.reduce((s, x) => s + x.created, 0), 30);
  assert.equal(f.state().cycle, 2);
  assert.equal(f.state().last_cycle_status, "OK");
  const before = f.sqlite.prepare("SELECT SUM(length(content_hash)) AS n FROM publications").get().n;
  const repeat = await cycle(f);
  assert.equal(repeat.length, 6);
  assert.equal(repeat.reduce((s, x) => s + x.created + x.updated, 0), 0);
  assert.equal(repeat.reduce((s, x) => s + x.unchanged, 0), 30);
  assert.equal(f.count(), 30);
  assert.equal(f.sqlite.prepare("SELECT SUM(length(content_hash)) AS n FROM publications").get().n, before);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM sync_state").get().n, 0);
});

test("30 cursos: cada tramo respeta seis solicitudes y llega al final en ocho ejecuciones", async () => {
  const f = fixture(30, 30);
  const results = await cycle(f);
  assert.equal(results.length, 8);
  assert.equal(results.reduce((s, x) => s + x.created, 0), 30);
  assert.equal(f.count(), 30);
});

test("orden variable, contenido modificado y altas antes/después del cursor se atienden sin reinicios", async () => {
  const f = fixture(10);
  await f.run();
  const upper = f.state().upper_key;
  f.controls.reverse = true;
  f.courses[0].nombre = "Contenido actualizado";
  f.commissions.push({ ...f.commissions[0], id: 8999 }, { ...f.commissions[0], id: 9999 });
  const end = await cycle(f);
  assert.equal(end.length, 1);
  assert.equal(f.count(), 10, "new items outside the frozen interval wait for the next cycle");
  assert.equal(upper, fdciKey(100, 9009));
  await cycle(f);
  assert.equal(f.count(), 12);
  assert.equal(f.sqlite.prepare("SELECT title FROM publications WHERE id='fdci:commission:9000'").get().title, "Contenido actualizado");
  assert.equal(f.sqlite.prepare("SELECT COUNT(DISTINCT id) AS n FROM publications").get().n, 12);
});

test("lectura fallida no bloquea otros cursos: ciclo PARTIAL y reintento del fallido en el próximo", async () => {
  const f = fixture(6, 6);
  f.controls.failCourse = 100;
  const first = await cycle(f);
  assert.equal(f.count(), 5);
  assert.equal(first.at(-1).status, "PARTIAL");
  assert.equal(f.state().last_cycle_status, "PARTIAL");
  assert.equal(f.state().last_completed_at, null);
  f.controls.failCourse = null; f.controls.failOnce = true;
  const repeat = await cycle(f);
  assert.equal(f.count(), 6);
  assert.equal(repeat.reduce((s, x) => s + x.created, 0), 1);
  assert.equal(f.state().last_cycle_status, "OK");
});

test("ACK de publicación o cursor perdido: no reintenta mutaciones, conserva progreso y recupera sin duplicar", async () => {
  for (const kind of ["dropAck", "dropCursorAck"]) {
    const f = fixture(2);
    f.controls[kind] = true;
    await assert.rejects(f.run(), /IMPORT_RESULT_UNCERTAIN|FDCI_CHECKPOINT_UNCERTAIN/);
    assert.equal(f.count(), 1);
    assert.equal(f.state().after_key, kind === "dropAck" ? "" : fdciKey(100, 9000));
    await cycle(f);
    assert.equal(f.count(), 2);
    assert.equal(f.sqlite.prepare("SELECT COUNT(DISTINCT id) AS n FROM publications").get().n, 2);
  }
});

test("expiración entre escritura y avance conserva cursor y permite repetir el ACK confirmado sin duplicados", async () => {
  const f = fixture(1);
  f.controls.expireAfterWrite = true;
  await assert.rejects(f.run(), /FDCI_CHECKPOINT_UNCERTAIN/);
  assert.equal(f.count(), 1);
  assert.equal(f.state().after_key, "");
  f.sqlite.exec("UPDATE import_gate_lease SET expires_at='2099-01-01T00:00:00Z'");
  const recovered = await f.run();
  assert.equal(recovered.created, 0);
  assert.equal(recovered.unchanged, 1);
  assert.equal(f.count(), 1);
});

test("CAS concurrente y cambio de propietario dentro del SQL no sobrescriben el cursor", async () => {
  const f = fixture(2);
  const start = await checkpointRequest(f.target, config.IMPORT_GATE_RUN_ID, { op: "start", revision: 0, upper: fdciKey(100, 9001) }, f.receiver);
  const updates = await Promise.allSettled([9000, 9001].map(n => checkpointRequest(f.target, config.IMPORT_GATE_RUN_ID,
    { op: "advance", revision: start.revision, after: fdciKey(100, n), failed: false, code: null }, f.receiver)));
  assert.equal(updates.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(f.state().revision, start.revision + 1);
  const before = f.state();
  const prepare = f.db.prepare;
  f.db.prepare = sql => {
    if (sql.startsWith("UPDATE fdci_import_checkpoint")) f.sqlite.exec("UPDATE import_gate_lease SET opened_by='new-owner'");
    return prepare(sql);
  };
  await assert.rejects(checkpointRequest(f.target, config.IMPORT_GATE_RUN_ID, { op: "finish", revision: before.revision }, f.receiver), /FDCI_CHECKPOINT_HTTP_409/);
  assert.deepEqual(f.state(), before);
});

test("cursor no modifica UNKNOWN, 6375, históricos ausentes ni sync_state", async () => {
  const f = fixture(4);
  f.courses.push({ capacitacion_id: 0, nombre: "Histórico incompleto fuera de scope active" });
  f.commissions[1].id = 6375;
  f.sqlite.exec(`INSERT INTO publications(id,source,external_id,kind,category,title,status,official_url,content_hash,metadata,source_status,normalized_status)
    VALUES('fdci:commission:9000','Capacitación Docente','9000','capacitacion','Comisión','Histórica','consultar','https://capacitaciondocente.educaciontuc.gov.ar','protected','{}','UNKNOWN','UNKNOWN'),
    ('legacy-unlisted','Capacitación Docente','old','capacitacion','Histórica','Conservar','cerrada','https://capacitaciondocente.educaciontuc.gov.ar','legacy','{}','CLOSED','CLOSED');
    INSERT INTO sync_state(source,synced_at,item_count) VALUES('Capacitación Docente','2020-01-01',2)`);
  const before = f.sqlite.prepare("SELECT * FROM sync_state").all();
  const result = await f.run();
  assert.equal(result.created, 2);
  assert.equal(result.skipped, 2);
  assert.equal(f.count(), 4);
  assert.equal(f.sqlite.prepare("SELECT content_hash FROM publications WHERE id='fdci:commission:9000'").get().content_hash, "protected");
  assert.equal(f.sqlite.prepare("SELECT content_hash FROM publications WHERE id='legacy-unlisted'").get().content_hash, "legacy");
  assert.deepEqual(f.sqlite.prepare("SELECT * FROM sync_state").all(), before);
});
