import test from "node:test";
import assert from "node:assert/strict";
import { calendarDayDistance, compareHomePriority, homePriority, type HomePriorityCandidate } from "./home-dashboard.ts";

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
  assert.deepEqual(ordered.map((item) => homePriority(item, now)), [0, 1, 2, 3, 4, 5]);
});
