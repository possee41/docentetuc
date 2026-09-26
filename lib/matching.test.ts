import assert from "node:assert/strict";
import test from "node:test";
import { matchScore, matchesProfile, profileMatch } from "./matching.ts";

const profile = { level: "Secundario", area: "Ciencias Sociales", subjects: "Construcción de Ciudadanía", locality: "Capital", shifts: "Mañana", wantsInterim: false, wantsSubstitute: true };
const exact = { kind: "vacante", title: "3 hs. Construcción de Ciudadanía", summary: "Escuela secundaria de Capital", level: "Secundario", shift: "Mañana", character: "Suplente" };

test("sólo considera exacta una publicación que cumple todos los criterios configurados", () => {
  const result = profileMatch(exact, profile);
  assert.equal(result.status, "exact");
  assert.equal(result.score, 100);
  assert.equal(matchesProfile(exact, profile), true);
});

test("marca como parcial cuando falta un criterio obligatorio", () => {
  const result = profileMatch({ ...exact, summary: "Escuela secundaria de Monteros" }, profile);
  assert.equal(result.status, "partial");
  assert.ok(result.criteria.some((criterion) => criterion.key === "location" && !criterion.matched));
  assert.ok(result.score < 100);
});

test("no recomienda resultados que sólo coinciden débilmente", () => {
  const unrelated = { kind: "vacante", title: "Maestro de grado", summary: "Escuela primaria de Monteros", level: "Primario", shift: "Tarde", character: "Interino" };
  assert.equal(profileMatch(unrelated, profile).status, "none");
  assert.equal(matchesProfile(unrelated, profile), false);
  assert.ok(matchScore(exact, profile) > matchScore(unrelated, profile));
});

test("una preferencia de carácter deshabilitada impide la coincidencia exacta", () => {
  const result = profileMatch({ ...exact, character: "Interino" }, profile);
  assert.equal(result.status, "partial");
  assert.equal(result.criteria.find((criterion) => criterion.key === "character")?.matched, false);
});
