import test from "node:test";
import assert from "node:assert/strict";
import { calendarDayDistance, compareHomePriority, homePriority, registrationState, trainingPriorityScore, type HomePriorityCandidate } from "./home-dashboard.ts";
import { isEligibleForPersonalizedHome, profileMatch } from "./matching.ts";

const now = new Date("2026-09-27T12:00:00-03:00");
const candidate = (overrides: Partial<HomePriorityCandidate>): HomePriorityCandidate => ({ kind: "junta", matched: false, inAgenda: false, updatedAt: "2026-09-27T10:00:00-03:00", ...overrides });

test("calcula hoy y mañana según el calendario de Tucumán", () => {
  assert.equal(calendarDayDistance("2026-09-27T23:30:00-03:00", now), 0);
  assert.equal(calendarDayDistance("2026-09-28T00:05:00-03:00", now), 1);
});

test("prioriza aperturas antes que vacantes, agenda y novedades", () => {
  const ordered = [
    candidate({ kind: "junta", matched: true }),
    candidate({ kind: "vacante", matched: true }),
    candidate({ inAgenda: true, eventAt: "2026-09-27T18:00:00-03:00" }),
    candidate({ kind: "capacitacion", registrationOpensAt: "2026-09-29T09:00:00-03:00", matched: true }),
    candidate({ kind: "capacitacion", registrationOpensAt: "2026-09-28T09:00:00-03:00", matched: true }),
    candidate({ kind: "capacitacion", registrationOpensAt: "2026-09-27T17:00:00-03:00", matched: true }),
  ].sort((left, right) => compareHomePriority(left, right, now));
  assert.deepEqual(ordered.map((item) => homePriority(item, now)), [0, 1, 2, 6, 7, 8]);
});

test("clasifica toda la ventana de inscripción y descarta cerradas", () => {
  assert.equal(registrationState("2026-09-27T17:00:00-03:00", "2026-10-01T23:59:59-03:00", now), "today");
  assert.equal(registrationState("2026-09-28T00:00:00-03:00", null, now), "tomorrow");
  assert.equal(registrationState("2026-09-30T00:00:00-03:00", null, now), "two-three");
  assert.equal(registrationState("2026-10-07T00:00:00-03:00", null, now), "eight-fourteen");
  assert.equal(registrationState("2026-10-17T00:00:00-03:00", null, now), "future");
  assert.equal(registrationState("2026-09-20T00:00:00-03:00", "2026-09-30T23:59:59-03:00", now), "open");
  assert.equal(registrationState("2026-09-20T00:00:00-03:00", "2026-09-26T23:59:59-03:00", now), "closed");
});

test("combina compatibilidad y urgencia aun sin perfil", () => {
  const strong = candidate({ kind: "capacitacion", registrationOpensAt: "2026-10-01T00:00:00-03:00", matchScore: 95 });
  const urgent = candidate({ kind: "capacitacion", registrationOpensAt: "2026-09-28T00:00:00-03:00", matchScore: 40 });
  assert.ok(trainingPriorityScore(strong, now) > trainingPriorityScore(urgent, now));
  assert.ok(compareHomePriority(strong, urgent, now) < 0);
  assert.ok(trainingPriorityScore(candidate({ kind: "capacitacion", registrationOpensAt: "2026-10-01T00:00:00-03:00" }), now) > 0);
});

test("FDCI: excluye del Inicio una abierta al 67% si hay una próxima altamente compatible", () => {
  const profile = { levels: ["Secundario"], areas: ["Ciencias Sociales"], circuits: ["II"] };
  const open = { kind: "capacitacion", title: "Curso abierto", level: "Secundario", area: "Ciencias Sociales", circuit: "V" };
  const upcoming = { kind: "capacitacion", title: "Próxima cohorte", level: "Secundario", area: "Ciencias Sociales", circuit: "II" };
  const openMatch = profileMatch(open, profile), upcomingMatch = profileMatch(upcoming, profile);
  assert.equal(openMatch.score, 67);
  assert.equal(isEligibleForPersonalizedHome(open, profile), false);
  assert.ok(upcomingMatch.score >= 85);
  assert.equal(isEligibleForPersonalizedHome(upcoming, profile), true);

  const recommendations = [open, upcoming].filter((item) => isEligibleForPersonalizedHome(item, profile));
  const cards = recommendations.sort((a, b) => compareHomePriority(
    candidate({ kind: "capacitacion", matched: true, matchScore: profileMatch(a, profile).score, registrationOpensAt: a.title === "Próxima cohorte" ? "2026-10-02T09:00:00-03:00" : "2026-09-20T09:00:00-03:00", registrationClosesAt: a.title === "Curso abierto" ? "2026-10-02T23:59:59-03:00" : null }),
    candidate({ kind: "capacitacion", matched: true, matchScore: profileMatch(b, profile).score, registrationOpensAt: b.title === "Próxima cohorte" ? "2026-10-02T09:00:00-03:00" : "2026-09-20T09:00:00-03:00", registrationClosesAt: b.title === "Curso abierto" ? "2026-10-02T23:59:59-03:00" : null }),
    now,
  ));
  assert.equal(cards[0].title, "Próxima cohorte");
});
