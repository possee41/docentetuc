import assert from "node:assert/strict";
import test from "node:test";
import { mergeTrainingData, trainingStatus } from "./training.ts";

const now = new Date("2026-09-26T12:00:00-03:00");
const course = { capacitacion_id: 10, nombre: "Curso oficial", token: "abc", slug: "curso-oficial", niveles: "Secundario" };
const commission = { id: 20, capacitacion_id: 10, fecha_apertura_preinscripcion: "2026-09-25 08:00:00", fecha_cierre_preinscripcion: "2026-09-28 08:00:00", fecha_inicio: "2026-10-01", fecha_fin: "2026-10-10", comision_cerrada: 0 };

test("incluye una comisión abierta aunque su capacitación no esté en el catálogo", () => {
  const result = mergeTrainingData([], [{ ...commission, nombre: "Curso huérfano", token: "x", slug: "huerfano" }], now);
  assert.equal(result.length, 1);
  assert.equal(result[0].status, "inscripción abierta");
  assert.equal(result[0].metadata.trainingId, "10");
  assert.equal(result[0].metadata.commissionId, "20");
});

test("calcula estados reales y respeta las fechas límite", () => {
  assert.equal(trainingStatus(commission, now), "inscripción abierta");
  assert.equal(trainingStatus(commission, new Date("2026-09-24T12:00:00-03:00")), "próximamente");
  assert.equal(trainingStatus(commission, new Date("2026-09-28T08:00:00-03:00")), "inscripción abierta");
  assert.equal(trainingStatus(commission, new Date("2026-09-29T12:00:00-03:00")), "inscripción cerrada");
  assert.equal(trainingStatus(commission, new Date("2026-10-05T12:00:00-03:00")), "en curso");
  assert.equal(trainingStatus(commission, new Date("2026-10-11T12:00:00-03:00")), "finalizada");
});

test("representa varias comisiones de una capacitación por separado", () => {
  const result = mergeTrainingData([course], [commission, { ...commission, id: 21 }], now);
  assert.deepEqual(result.map((item) => item.id), ["fdci:commission:20", "fdci:commission:21"]);
});

test("mantiene una capacitación sin comisión como consultable", () => {
  const [result] = mergeTrainingData([course], [], now);
  assert.equal(result.status, "consultar");
  assert.equal(result.metadata.entity, "course");
});

test("admite respuestas oficiales vacías", () => assert.deepEqual(mergeTrainingData([], [], now), []));

test("propaga una caída temporal para conservar los datos almacenados", async () => {
  const load = async (fetcher: () => Promise<unknown[]>) => mergeTrainingData(await fetcher(), [], now);
  await assert.rejects(load(async () => { throw new Error("API temporalmente caída"); }), /temporalmente caída/);
});
