import test from "node:test";
import assert from "node:assert/strict";
import { categoryForNotification, isQuietTime, validPushEndpoint } from "./push.ts";

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
