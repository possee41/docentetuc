import assert from "node:assert/strict";
import test from "node:test";
import gateway from "../workers/source-import-gateway.mjs";
import { collectFdciDeltaSlice } from "./collect-fdci-delta.mjs";
import { runIncrementalFdci } from "./fdci-incremental.mjs";
import { fdciLocalFixture } from "./fdci-local-fixture.mjs";
import { canScheduleTrainingReminder, enrollmentState, isClosingSoon, isUrgentOpening } from "../lib/training.ts";

const at = new Date("2026-11-14T12:00:00-03:00");
const course = { capacitacion_id: 3116, nombre: "La construcción de la cultura de la paz en la escuela. La mediación como herramienta pedagógica",
  token: "V177gl1d", slug: "la-construccion-de-la-cultura-de-la-paz-en-la-escuela-la-mediacion-como-herramienta-pedagogica",
  proxima_fecha_preinscripcion: "2026-11-15 23:00:00", descripcion: "Apertura prevista en el cronograma." };
const commission = { id: 6441, capacitacion_id: 3116, fecha_apertura_preinscripcion: "2026-11-15 23:00:00",
  fecha_cierre_preinscripcion: "2026-11-18 08:00:00", fecha_inicio: "2026-11-20", fecha_fin: "2026-12-01",
  isActivePre: 0, comision_cerrada: 0, cupo_disponible_pre: 249 };

function source(details = [commission]) {
  return async (url) => Response.json(String(url).endsWith("getCapaActivas") ? [] :
    String(url).endsWith("getRestoCapas") ? [course] : { comisiones: details });
}

test("6441: un curso próximo fuera de getCapaActivas se verifica y entra en D1 sin inventar fechas", async t => {
  const { sqlite, db } = fdciLocalFixture(); t.after(() => sqlite.close());
  const owner = "upcoming-local", secret = "synthetic_upcoming_secret_12345678901234";
  sqlite.prepare("INSERT INTO import_gateway_identity VALUES(1,?,?)").run("synthetic-upcoming", "synthetic-id");
  sqlite.exec("INSERT INTO import_gate_lease VALUES(1,'fdci','2099-01-01T00:00:00Z','2026-01-01T00:00:00Z','upcoming-local')");
  const target = { origin: "http://127.0.0.1:8798", endpoint: "http://127.0.0.1:8798/api/internal/fdci-import", secret };
  const env = { DB: db, IMPORT_DATABASE_NAME: "synthetic-upcoming", IMPORT_DATABASE_ID: "synthetic-id", FDCI_IMPORT_SECRET: secret,
    IMPORT_GATE_ENABLED: "false", IMPORT_GATE_LEASE_REQUIRED: "true", IMPORT_GATE_ALLOWED_SOURCE: "fdci", FDCI_EXTERNAL_ENABLED: "true" };
  const fetcher = (url, init) => new URL(url).origin === target.origin
    ? gateway.fetch(new Request(url, init), env) : source([commission, { ...commission, id: 6442 }])(url, init);
  const first = await runIncrementalFdci(target, { maxPublications: 1, owner }, fetcher, at);
  assert.equal(first.created, 1); assert.equal(first.cycleComplete, false);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM publications").get().n, 1);
  const row = sqlite.prepare("SELECT * FROM publications WHERE id='fdci:commission:6441'").get();
  const metadata = JSON.parse(row.metadata);
  assert.equal(metadata.dateStatus, "confirmed");
  assert.equal(metadata.registrationOpensAt, "2026-11-15T23:00:00-03:00");
  assert.equal(metadata.registrationClosesAt, "2026-11-18T08:00:00-03:00");
  assert.equal(row.normalized_status, "UPCOMING");
  assert.equal(enrollmentState(metadata, row.status, row.normalized_status, at), "PROXIMAMENTE");
  assert.equal(canScheduleTrainingReminder(metadata, row.status, row.normalized_status, at), true);
  assert.equal(isUrgentOpening(metadata, new Date("2026-11-14T23:30:00-03:00")), true);
  assert.equal(isUrgentOpening({ ...metadata, dateStatus: "tentative" }, new Date("2026-11-14T23:30:00-03:00")), false);
  assert.equal(isUrgentOpening({ ...metadata, registrationHasTime: false }, new Date("2026-11-14T23:30:00-03:00")), false);
  assert.equal(isClosingSoon({ ...metadata, dateStatus: "tentative" }, at), false);
  const second = await runIncrementalFdci(target, { maxPublications: 1, owner }, fetcher, at);
  assert.equal(second.created, 1); assert.equal(second.cycleComplete, false);
  const third = await runIncrementalFdci(target, { maxPublications: 1, owner }, fetcher, at);
  assert.equal(third.cycleComplete, true);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM publications").get().n, 2);
});

test("una fecha futura resumida sin comisión comprobable no publica y se reintenta en el ciclo siguiente", async t => {
  const { sqlite, db } = fdciLocalFixture(); t.after(() => sqlite.close());
  const owner = "upcoming-local", secret = "synthetic_upcoming_secret_12345678901234";
  sqlite.prepare("INSERT INTO import_gateway_identity VALUES(1,?,?)").run("synthetic-upcoming", "synthetic-id");
  sqlite.exec("INSERT INTO import_gate_lease VALUES(1,'fdci','2099-01-01T00:00:00Z','2026-01-01T00:00:00Z','upcoming-local')");
  const target = { origin: "http://127.0.0.1:8798", endpoint: "http://127.0.0.1:8798/api/internal/fdci-import", secret };
  const env = { DB: db, IMPORT_DATABASE_NAME: "synthetic-upcoming", IMPORT_DATABASE_ID: "synthetic-id", FDCI_IMPORT_SECRET: secret,
    IMPORT_GATE_ENABLED: "false", IMPORT_GATE_LEASE_REQUIRED: "true", IMPORT_GATE_ALLOWED_SOURCE: "fdci", FDCI_EXTERNAL_ENABLED: "true" };
  const fetcher = (url, init) => new URL(url).origin === target.origin
    ? gateway.fetch(new Request(url, init), env) : source([])(url, init);
  const result = await runIncrementalFdci(target, { maxPublications: 2, owner }, fetcher, at);
  assert.equal(result.status, "PARTIAL");
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM publications").get().n, 0);
  const retry = (url, init) => new URL(url).origin === target.origin
    ? gateway.fetch(new Request(url, init), env) : source()(url, init);
  const recovered = await runIncrementalFdci(target, { maxPublications: 2, owner }, retry, at);
  assert.equal(recovered.created, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM publications").get().n, 1);
});

test("delta también descubre 6441 desde la fecha resumen y exige detalle estructurado", async () => {
  const result = await collectFdciDeltaSlice(source(), { state: { detail_after: "", detail_upper: "" }, queued: new Map(), now: at });
  assert.deepEqual(result.items.map(item => item.id), ["fdci:commission:6441"]);
  assert.equal(result.items[0].normalizedStatus, "UPCOMING");
  await assert.rejects(collectFdciDeltaSlice(source([]), { state: { detail_after: "", detail_upper: "" }, queued: new Map(), now: at }), /INCOMPLETE/);
});
