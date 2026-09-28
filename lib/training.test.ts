import assert from "node:assert/strict";
import test from "node:test";
import { mergeTrainingData, openingCountdown, trainingStatus } from "./training.ts";

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
  assert.equal(result.metadata.registrationOpensAt, undefined);
  assert.equal(result.metadata.registrationClosesAt, undefined);
});

test("detecta una próxima apertura publicada en la capacitación", () => {
  const [result] = mergeTrainingData([{ ...course, proxima_fecha_preinscripcion: "2026-09-27 23:00:00" }], [], now);
  assert.equal(result.status, "próximamente");
  assert.equal(result.metadata.registrationOpensAt, "2026-09-27T23:00:00-03:00");
  assert.equal(result.metadata.registrationHasTime, true);
});

test("calcula la cuenta regresiva sin inventar hora", () => {
  assert.equal(openingCountdown("2026-09-26T14:35:00-03:00", new Date("2026-09-26T12:00:00-03:00")), "Abre en 2 h 35 min");
  assert.equal(openingCountdown("2026-09-27T00:00:00-03:00", now, false), "Abre mañana");
});

test("admite respuestas oficiales vacías", () => assert.deepEqual(mergeTrainingData([], [], now), []));

test("propaga una caída temporal para conservar los datos almacenados", async () => {
  const load = async (fetcher: () => Promise<Parameters<typeof mergeTrainingData>[0]>) => mergeTrainingData(await fetcher(), [], now);
  await assert.rejects(load(async () => { throw new Error("API temporalmente caída"); }), /temporalmente caída/);
});
