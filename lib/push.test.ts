import test from "node:test";
import assert from "node:assert/strict";
import { categoryForNotification, isPushNotificationDue, isQuietTime, publicationFitsProfileCircuit, PUSH_DELIVERY_BATCH_SIZE, scheduledNotificationTypes, validPushEndpoint } from "./push.ts";

test("quiet hours work across midnight in Tucumán", () => {
  assert.equal(isQuietTime(new Date("2026-09-27T02:30:00Z"), "22:00", "07:00", "America/Argentina/Buenos_Aires"), true);
  assert.equal(isQuietTime(new Date("2026-09-27T15:00:00Z"), "22:00", "07:00", "America/Argentina/Buenos_Aires"), false);
});

test("notification types map to user-facing categories", () => {
  assert.equal(categoryForNotification("VACANTE_NUEVA"), "vacancies");
  assert.equal(categoryForNotification("DESIGNACION_EXACTA_CARGO"), "vacancies");
  assert.equal(categoryForNotification("DESIGNACION_RECORDATORIO"), "reminders");
  assert.equal(categoryForNotification("AGENDA_RECORDATORIO"), "reminders");
  assert.equal(categoryForNotification("COMISION_NUEVA"), "commissions");
  assert.equal(categoryForNotification("CIERRE_PROXIMO"), "closing_soon");
  assert.equal(categoryForNotification("CAPACITACION_ACTUALIZADA"), "trainings");
  assert.equal(categoryForNotification("COMUNICADO_ACTUALIZADO"), "boards");
});

test("push endpoints reject arbitrary hosts", () => {
  assert.equal(validPushEndpoint("https://fcm.googleapis.com/fcm/send/example"), true);
  assert.equal(validPushEndpoint("https://example.com/steal"), false);
  assert.equal(validPushEndpoint("http://fcm.googleapis.com/example"), false);
});

test("el despacho programa lotes acotados para respetar el presupuesto de CPU del cron", () => {
  assert.equal(PUSH_DELIVERY_BATCH_SIZE, 10);
});

test("el push no reenvía notificaciones históricas sin programación y respeta las futuras", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  assert.equal(isPushNotificationDue(null, now), false);
  assert.equal(isPushNotificationDue("2026-09-28T13:00:00Z", now), false);
  assert.equal(isPushNotificationDue("2026-09-28T11:59:00Z", now), true);
});

test("closing-soon alerts require a saved training and an opted-in alert profile, never a designation", () => {
  const vacancy = { id: "v1", kind: "vacante", title: "Cargo", summary: "", level: "", area: "", junta: "", location: "", shift: "", character: "", starts_at: null, ends_at: "2026-09-28T15:00:00Z", status: "abierta", metadata: "{}" };
  const training = { ...vacancy, id: "t1", kind: "capacitacion", metadata: JSON.stringify({ dateStatus: "confirmed", registrationClosesAt: "2026-09-28T15:00:00Z" }), normalized_status: "ACTIVE" };
  const profile = { user_id: "u1", notify_new_trainings: 1, training_notify_scope: "all" };
  const now = new Date("2026-09-28T12:00:00Z");
  assert.deepEqual(scheduledNotificationTypes(vacancy, profile, true, now), []);
  assert.deepEqual(scheduledNotificationTypes(training, profile, false, now), []);
  assert.deepEqual(scheduledNotificationTypes(training, profile, true, now), ["CIERRE_PROXIMO"]);
});

test("automatic training alerts respect the explicit opt-in", () => {
  const publication = { id: "t1", kind: "capacitacion", title: "Curso", summary: "", level: "", area: "", junta: "", location: "", shift: "", character: "", starts_at: null, ends_at: null, status: "abierta", normalized_status: "UPCOMING", metadata: JSON.stringify({ dateStatus: "confirmed", registrationOpensAt: "2026-09-29T12:00:00Z" }) };
  const now = new Date("2026-09-28T12:00:00Z");
  assert.deepEqual(scheduledNotificationTypes(publication, { user_id: "u1", notify_new_trainings: 0 }, false, now), []);
  assert.ok(scheduledNotificationTypes(publication, { user_id: "u1", notify_new_trainings: 1, training_notify_scope: "all" }, false, now).includes("CAPACITACION_ABRE_MANANA"));
  assert.deepEqual(scheduledNotificationTypes({ ...publication, metadata: JSON.stringify({ registrationOpensAt: "2026-09-29T12:00:00Z", dateStatus: "general_window" }) }, { user_id: "u1", notify_new_trainings: 1, training_notify_scope: "all" }, false, now), []);
});

test("automatic relevant-training alerts include recipient metadata in matching", () => {
  const publication = { id: "t2", kind: "capacitacion", title: "Herramientas para el aula", summary: "", level: "Secundario", area: "", junta: "", location: "Online", shift: "", character: "virtual", circuit: "UNKNOWN", source_circuit_raw: "", starts_at: null, ends_at: null, status: "próximamente", normalized_status: "UPCOMING", metadata: JSON.stringify({ entity: "course", trainingId: "t2", dateStatus: "confirmed", registrationOpensAt: "2026-09-29T12:00:00Z", recipients: "Docentes de nivel Secundario y Matemática" }) };
  const profile = { user_id: "u1", level: "Secundario", notify_new_trainings: 1, training_notify_scope: "relevant", training_interests: "Matemática" };
  const now = new Date("2026-09-28T12:00:00Z");
  assert.ok(scheduledNotificationTypes(publication, profile, false, now).includes("CAPACITACION_ABRE_MANANA"));
});

test("las alertas territoriales excluyen incompatibilidades y conservan UNKNOWN", () => {
  const profile = { user_id: "u1", circuits: "II, III" };
  assert.equal(publicationFitsProfileCircuit({ circuit: "V", source_circuit_raw: "Circuito V", location: "" }, profile), false);
  assert.equal(publicationFitsProfileCircuit({ circuit: "III", source_circuit_raw: "Circuito III", location: "" }, profile), true);
  assert.equal(publicationFitsProfileCircuit({ circuit: "ALL", source_circuit_raw: "Todos los circuitos", location: "" }, profile), true);
  assert.equal(publicationFitsProfileCircuit({ circuit: "UNKNOWN", source_circuit_raw: "", location: "" }, profile), true);
});
