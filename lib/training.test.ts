import assert from "node:assert/strict";
import test from "node:test";
import { enrollmentState, mergeTrainingData, openingCountdown, trainingStatus } from "./training.ts";

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

test("una comisión repetida por la API conserva un único identificador estable", () => {
  const result = mergeTrainingData([course, course], [commission, commission], now);
  assert.deepEqual(result.map((item) => item.id), ["fdci:commission:20"]);
});

test("mantiene una capacitación sin comisión como consultable", () => {
  const [result] = mergeTrainingData([course], [], now);
  assert.equal(result.status, "consultar");
  assert.equal(result.metadata.entity, "course");
  assert.equal(result.metadata.registrationOpensAt, undefined);
  assert.equal(result.metadata.registrationClosesAt, undefined);
  assert.equal(result.metadata.dateStatus, "unknown");
});

test("FDCI no infiere inscripción cerrada a partir de un inicio futuro sin fechas de inscripción", () => {
  const [result] = mergeTrainingData([course], [{ ...commission, fecha_apertura_preinscripcion: undefined, fecha_cierre_preinscripcion: undefined, fecha_inicio: "2026-10-01", fecha_fin: "2026-10-10", comision_cerrada: 0 }], now);
  assert.equal(result.status, "consultar");
  assert.equal(result.metadata.dateStatus, "confirmed", "la fuente confirma el cursado, no la inscripción");
  assert.equal(result.metadata.registrationOpensAt, undefined);
});

test("FDCI descarta fechas inválidas en vez de declararlas confirmadas", () => {
  const [result] = mergeTrainingData([course], [{ ...commission, fecha_apertura_preinscripcion: "próximamente", fecha_cierre_preinscripcion: undefined, fecha_inicio: undefined, fecha_fin: undefined }], now);
  assert.equal(result.metadata.registrationOpensAt, undefined);
  assert.equal(result.metadata.dateStatus, "unknown");
  assert.equal(result.status, "consultar");
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

test("una inscripción vencida no permanece abierta por una etiqueta antigua de FDCI", () => {
  const metadata = { entity: "commission" as const, trainingId: "10", registrationOpensAt: "2026-09-25T08:00:00-03:00", registrationClosesAt: "2026-09-28T08:00:00-03:00", dateStatus: "confirmed" as const };
  assert.equal(enrollmentState(metadata, "inscripción abierta", "ACTIVE", new Date("2026-09-29T12:00:00-03:00")), "CERRADA");
  assert.equal(enrollmentState(metadata, "inscripción abierta", "CLOSED", now), "CERRADA");
});

test("apertura futura, hoy y abierta se distinguen por la hora de inscripción", () => {
  const metadata = { entity: "course" as const, trainingId: "10", registrationOpensAt: "2026-09-27T23:00:00-03:00", registrationClosesAt: "2026-09-29T08:00:00-03:00", dateStatus: "confirmed" as const };
  assert.equal(enrollmentState(metadata, "próximamente", "UPCOMING", now), "PROXIMAMENTE");
  assert.equal(enrollmentState(metadata, "próximamente", "UPCOMING", new Date("2026-09-27T12:00:00-03:00")), "ABRE_HOY");
  assert.equal(enrollmentState(metadata, "inscripción abierta", "ACTIVE", new Date("2026-09-27T23:01:00-03:00")), "ABIERTA");
  assert.equal(enrollmentState(metadata, "inscripción abierta", "ACTIVE", new Date("2026-09-29T08:01:00-03:00")), "CERRADA");
});

test("una fecha de apertura sin hora no se anuncia abierta a medianoche", () => {
  const metadata = { entity: "course" as const, trainingId: "11", registrationOpensAt: "2026-09-27T00:00:00-03:00", registrationHasTime: false, registrationClosesAt: "2026-09-30T23:59:59-03:00", dateStatus: "confirmed" as const };
  assert.equal(enrollmentState(metadata, "consultar", "UPCOMING", new Date("2026-09-27T12:00:00-03:00")), "ABRE_HOY");
});

test("inicio de cursado y ventana general no se convierten en apertura de curso", () => {
  assert.equal(enrollmentState({ entity: "course", trainingId: "10", courseStartsAt: "2026-10-01T00:00:00-03:00", dateStatus: "course_confirmed" }, "consultar", "UNKNOWN", now), "SIN_FECHA_CONFIRMADA");
  assert.equal(enrollmentState({ entity: "course", trainingId: "11", generalWindowOpensAt: "2026-10-01T00:00:00-03:00", dateStatus: "general_window" }, "consultar", "UNKNOWN", now), "SIN_FECHA_CONFIRMADA");
});

test("cohorte tentativa CeNET se anuncia antes, pero no se declara abierta sin confirmación", () => {
  const metadata = { entity: "course" as const, trainingId: "cenet:2026:6", registrationOpensAt: "2026-10-05T00:00:00-03:00", registrationClosesAt: "2026-10-12T23:59:59-03:00", dateStatus: "tentative" as const };
  assert.equal(enrollmentState(metadata, "próximamente", "UNKNOWN", now), "PROXIMAMENTE");
  assert.equal(enrollmentState(metadata, "próximamente", "UNKNOWN", new Date("2026-10-06T12:00:00-03:00")), "SIN_FECHA_CONFIRMADA");
  assert.equal(enrollmentState(metadata, "próximamente", "UNKNOWN", new Date("2026-10-13T12:00:00-03:00")), "CERRADA");
});
