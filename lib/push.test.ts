import test from "node:test";
import assert from "node:assert/strict";
import { categoryForNotification, isQuietTime, scheduledNotificationTypes, validPushEndpoint } from "./push.ts";

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
});

test("push endpoints reject arbitrary hosts", () => {
  assert.equal(validPushEndpoint("https://fcm.googleapis.com/fcm/send/example"), true);
  assert.equal(validPushEndpoint("https://example.com/steal"), false);
  assert.equal(validPushEndpoint("http://fcm.googleapis.com/example"), false);
});

test("closing-soon alerts are only materialized for saved publications", () => {
  const publication = { id: "v1", kind: "vacante", title: "Cargo", summary: "", level: "", area: "", junta: "", location: "", shift: "", character: "", starts_at: null, ends_at: "2026-09-28T15:00:00Z", status: "abierta", metadata: "{}" };
  const profile = { user_id: "u1" };
  const now = new Date("2026-09-28T12:00:00Z");
  assert.deepEqual(scheduledNotificationTypes(publication, profile, false, now), []);
  assert.deepEqual(scheduledNotificationTypes(publication, profile, true, now), ["CIERRE_PROXIMO"]);
});

test("automatic training alerts respect the explicit opt-in", () => {
  const publication = { id: "t1", kind: "capacitacion", title: "Curso", summary: "", level: "", area: "", junta: "", location: "", shift: "", character: "", starts_at: null, ends_at: null, status: "abierta", metadata: JSON.stringify({ registrationOpensAt: "2026-09-29T12:00:00Z" }) };
  const now = new Date("2026-09-28T12:00:00Z");
  assert.deepEqual(scheduledNotificationTypes(publication, { user_id: "u1", notify_new_trainings: 0 }, false, now), []);
  assert.ok(scheduledNotificationTypes(publication, { user_id: "u1", notify_new_trainings: 1, training_notify_scope: "all" }, false, now).includes("CAPACITACION_ABRE_MANANA"));
});
