import assert from "node:assert/strict";
import test from "node:test";
import gateway from "../workers/source-import-gateway.mjs";
import { fdciLocalFixture } from "./fdci-local-fixture.mjs";
import { runFdciDaily } from "./fdci-daily.mjs";
import { resolveGatewayConfig, runGatewayImport, fdciSafety } from "./import-via-gateway.mjs";
import { fdciPublicationFresh } from "../lib/fdci-freshness.ts";
import { sourceHealth } from "../lib/source-health.ts";
import { inventorySummary } from "./fdci-recovery-inventory.mjs";
import { recoveryCandidates, runRecoveryBatch } from "./fdci-recovery-batch.mjs";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const secret = "synthetic_restoration_secret_123456789012";
const config = { SYNC_SOURCE: "fdci", IMPORT_GATEWAY_ENABLED: "true", IMPORT_GATEWAY_TARGET: "canary",
  IMPORT_GATEWAY_ORIGIN: "http://127.0.0.1:8798", IMPORT_GATEWAY_DATABASE_NAME: "docentetuc-web-canary-1-2-local",
  IMPORT_GATEWAY_DATABASE_ID: "00000000-0000-4000-8000-000000000012", FDCI_IMPORT_SECRET: secret,
  IMPORT_GATE_RUN_ID: "daily-local", FDCI_SCOPE: "active", FDCI_MAX_REQUESTS: "6",
  FDCI_MAX_PUBLICATIONS: "2", FDCI_MAX_SLICES: "12", FDCI_PAUSE_MS: "400" };
const course = { capacitacion_id: 3116, nombre: "La construcción de la cultura de la paz en la escuela",
  token: "synthetic3116", slug: "cultura-de-paz", proxima_fecha_preinscripcion: null };
const commission = { id: 6441, capacitacion_id: 3116, fecha_apertura_preinscripcion: "2026-11-15 23:00:00",
  fecha_cierre_preinscripcion: "2026-11-18 08:00:00", comision_cerrada: 1, isActivePre: 0 };

function fixture() {
  const { sqlite, db } = fdciLocalFixture();
  sqlite.prepare("INSERT INTO import_gateway_identity VALUES(1,?,?)").run(config.IMPORT_GATEWAY_DATABASE_NAME, config.IMPORT_GATEWAY_DATABASE_ID);
  const env = { DB: db, IMPORT_DATABASE_NAME: config.IMPORT_GATEWAY_DATABASE_NAME,
    IMPORT_DATABASE_ID: config.IMPORT_GATEWAY_DATABASE_ID, FDCI_IMPORT_SECRET: secret,
    IMPORT_GATE_ENABLED: "false", IMPORT_GATE_LEASE_REQUIRED: "true", IMPORT_GATE_ALLOWED_SOURCE: "fdci",
    FDCI_EXTERNAL_ENABLED: "true" };
  const receiver = (url, init) => gateway.fetch(new Request(url, init), env);
  return { sqlite, receiver };
}

test("el ciclo diario vacío confirma lectura sin eliminar el historial ni repetir tramos", async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  f.sqlite.prepare("INSERT INTO publications(id,source,external_id,kind,category,title,status,official_url,content_hash,metadata,normalized_status,last_seen_at,last_changed_at) VALUES('fdci:commission:old','Capacitación Docente','old','capacitacion','','Histórica','inscripción cerrada','https://capacitaciondocente.educaciontuc.gov.ar/','old','{}','CLOSED','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')").run();
  const source = async url => Response.json(String(url).endsWith("getCapaActivas") ? [] : []);
  const result = await runFdciDaily(config, "", source, f.receiver);
  assert.deepEqual([result.status, result.slices, result.cycleComplete], ["OK", 1, true]);
  assert.equal(f.sqlite.prepare("SELECT cycle FROM fdci_import_checkpoint").get().cycle, 2);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM publications").get().n, 1);
  const row = f.sqlite.prepare("SELECT last_seen_at FROM publications").get();
  assert.equal(fdciPublicationFresh(row.last_seen_at), false);
});

test("una lectura oficial fallida invalida la salud del ciclo sin borrar publicaciones", async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const empty = async () => Response.json([]);
  assert.equal((await runFdciDaily(config, "", empty, f.receiver)).status, "OK");
  const failed = await runFdciDaily(config, "", async () => { throw new Error("synthetic network failure"); }, f.receiver);
  assert.equal(failed.status, "ERROR");
  const checkpoint = f.sqlite.prepare("SELECT last_cycle_status,upper_key FROM fdci_import_checkpoint").get();
  assert.deepEqual([checkpoint.last_cycle_status, checkpoint.upper_key], ["PARTIAL", ""]);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM publications").get().n, 0);
});

test("un cursor pendiente que desaparece se abandona como parcial y permite un ciclo posterior", async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const rows = [6441, 6442, 6443].map(id => ({ ...commission, id }));
  const listed = async url => Response.json(String(url).endsWith("getCapaActivas") ? rows :
    String(url).endsWith("getRestoCapas") ? [course] : { comisiones: rows });
  const oneSlice = { ...config, FDCI_MAX_SLICES: "1" };
  assert.equal((await runFdciDaily(oneSlice, "", listed, f.receiver)).status, "PARTIAL");
  assert.notEqual(f.sqlite.prepare("SELECT upper_key FROM fdci_import_checkpoint").get().upper_key, "");
  const empty = async () => Response.json([]);
  const abandoned = await runFdciDaily(config, "", empty, f.receiver);
  assert.deepEqual([abandoned.status, abandoned.code], ["ERROR", "FDCI_PENDING_DISAPPEARED"]);
  const checkpoint = f.sqlite.prepare("SELECT upper_key,last_cycle_status FROM fdci_import_checkpoint").get();
  assert.deepEqual([checkpoint.upper_key, checkpoint.last_cycle_status], ["", "PARTIAL"]);
  assert.equal((await runFdciDaily(config, "", empty, f.receiver)).status, "OK");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM publications").get().n, 2);
});

test("el job diario agota dos tramos y deja el cursor completo sin duplicar", async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const rows = [6441, 6442, 6443].map(id => ({ ...commission, id }));
  const source = async url => Response.json(String(url).endsWith("getCapaActivas") ? rows :
    String(url).endsWith("getRestoCapas") ? [course] : { comisiones: rows });
  const result = await runFdciDaily(config, "", source, f.receiver);
  assert.deepEqual([result.status, result.slices, result.created, result.cycleComplete], ["OK", 2, 3, true]);
  assert.equal(f.sqlite.prepare("SELECT COUNT(DISTINCT id) n FROM publications").get().n, 3);
  assert.equal(f.sqlite.prepare("SELECT cycle FROM fdci_import_checkpoint").get().cycle, 2);
});

test("recuperación individual acepta una comisión histórica verificada y reejecución idempotente", async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  f.sqlite.exec("INSERT INTO import_gate_lease VALUES(1,'fdci','2099-01-01T00:00:00Z','2026-01-01T00:00:00Z','daily-local')");
  const source = async (url) => Response.json(String(url).endsWith("getCapaActivas") ? [] :
    String(url).endsWith("getRestoCapas") ? [course] : { comisiones: [commission] });
  const single = { ...config, FDCI_SCOPE: "single", FDCI_MAX_REQUESTS: "3", FDCI_MAX_PUBLICATIONS: "1",
    FDCI_RECOVERY_CLOSED_ONLY: "true",
    FDCI_COURSE_TOKEN: course.token, FDCI_COURSE_SLUG: course.slug, FDCI_COMMISSION_ID: "6441" };
  const target = resolveGatewayConfig(single);
  const first = await runGatewayImport(target, single, source, f.receiver);
  assert.deepEqual([first.created, first.updated, first.sourceRequests], [1, 0, 3]);
  const before = f.sqlite.prepare("SELECT first_seen_at,content_hash,normalized_status FROM publications WHERE id='fdci:commission:6441'").get();
  assert.equal(before.normalized_status, "CLOSED");
  const again = await runGatewayImport(target, single, source, f.receiver);
  assert.deepEqual([again.created, again.updated, again.unchanged], [0, 0, 1]);
  const after = f.sqlite.prepare("SELECT first_seen_at,content_hash FROM publications WHERE id='fdci:commission:6441'").get();
  assert.equal(after.first_seen_at, before.first_seen_at);
  assert.equal(after.content_hash, before.content_hash);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM publications WHERE id='fdci:commission:6441'").get().n, 1);
  const changedSource = async url => Response.json(String(url).endsWith("getCapaActivas") ? [] :
    String(url).endsWith("getRestoCapas") ? [{ ...course, nombre: "Título cambiado" }] : { comisiones: [commission] });
  await assert.rejects(runGatewayImport(target, single, changedSource, f.receiver), /HTTP_409/);
  assert.equal(f.sqlite.prepare("SELECT content_hash FROM publications WHERE id='fdci:commission:6441'").get().content_hash,
    before.content_hash);
  f.sqlite.prepare("UPDATE publications SET removed_at='2026-11-19T00:00:00Z' WHERE id='fdci:commission:6441'").run();
  await assert.rejects(runGatewayImport(target, single, source, f.receiver), /HTTP_409/);
  assert.equal(f.sqlite.prepare("SELECT removed_at FROM publications WHERE id='fdci:commission:6441'").get().removed_at,
    "2026-11-19T00:00:00Z");
  assert.throws(() => fdciSafety({ ...single, FDCI_MAX_PUBLICATIONS: "2" }), /FDCI_RECOVERY_SELECTION_INVALID/);
});

test("27 horas de frescura FDCI no amplían INFoD ni verifican comisiones antiguas", () => {
  const now = new Date("2026-11-20T15:00:00Z");
  const status = { sync_status: "OK", last_successful_sync_at: "2026-11-19T15:00:00Z" };
  assert.equal(sourceHealth({ ...status, source: "Capacitación Docente" }, now), "current");
  assert.equal(sourceHealth({ ...status, source: "INFoD / AulaS-TIC" }, now), "stale");
  assert.equal(fdciPublicationFresh("2026-11-19T15:00:00Z", now), true);
  assert.equal(fdciPublicationFresh("2026-11-18T15:00:00Z", now), false);
});

test("el inventario de recuperación compara IDs y clasifica fechas oficiales de Tucumán", () => {
  const result = inventorySummary([{ id: "fdci:commission:6440" }], [course], { 3116: [commission] },
    new Date("2026-11-20T15:00:00Z"));
  assert.deepEqual(result.missingCourses, ["3116"]);
  assert.deepEqual(result.missingCommissions.map(row => [row.commissionId, row.status]), [["6441", "CLOSED"]]);
  assert.throws(() => inventorySummary([], [course], { 3116: [commission, commission] }), /DETAIL_INVALID/);
});

test("el lote histórico exige manifiesto completo y reanuda tras cada ACK confirmado", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fdci-recovery-test-"));
  const manifestPath = join(dir, "manifest.json"), statePath = join(dir, "state.json");
  try {
    const manifest = { complete: true, errors: {}, missingCommissions: [
      { courseId: "3116", commissionId: "6441", token: course.token, slug: course.slug, status: "CLOSED" },
      { courseId: "3116", commissionId: "6442", token: course.token, slug: course.slug, status: "UPCOMING" },
    ] };
    const raw = JSON.stringify(manifest);
    await writeFile(manifestPath, raw);
    const approved = { FDCI_RECOVERY_ENABLED: "true", IMPORT_GATE_RUN_ID: "synthetic-run",
      FDCI_RECOVERY_MANIFEST_SHA256: createHash("sha256").update(raw).digest("hex") };
    const calls = [];
    const job = async selected => { calls.push(selected); return { status: "OK", closed: true, created: 1, updated: 0, unchanged: 0 }; };
    assert.deepEqual(recoveryCandidates(manifest).map(row => row.commissionId), ["6441"]);
    assert.deepEqual(await runRecoveryBatch(approved, "", manifestPath, statePath, job, 1),
      { status: "OK", processed: 1, created: 1, unchanged: 0, remaining: 0 });
    assert.equal(calls[0].FDCI_RECOVERY_CLOSED_ONLY, "true");
    assert.equal(JSON.parse(await readFile(statePath, "utf8")).done[0], "6441");
    assert.equal((await runRecoveryBatch(approved, "", manifestPath, statePath, job)).processed, 0);
    assert.equal(calls.length, 1);
    await assert.rejects(runRecoveryBatch({ ...approved, FDCI_RECOVERY_MANIFEST_SHA256: "bad" }, "", manifestPath, statePath, job),
      /MANIFEST_UNAPPROVED/);
  } finally {
    await unlink(statePath).catch(() => {});
    await unlink(manifestPath).catch(() => {});
    await rmdir(dir);
  }
});
