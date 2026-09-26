import assert from "node:assert/strict";
import test from "node:test";
import { matchScore, matchesProfile } from "./matching.ts";

test("prioriza publicaciones que coinciden con el perfil", () => {
  const profile = { level: "Secundario", area: "Ciencias Sociales", subjects: "Construcción de Ciudadanía", locality: "Capital", shifts: "Mañana", wantsSubstitute: true };
  const matching = { kind: "vacante", title: "3 hs. Construcción de Ciudadanía", summary: "Escuela secundaria de Capital", level: "Secundario", shift: "Mañana", character: "Suplente" };
  const unrelated = { kind: "vacante", title: "Maestro de grado", summary: "Escuela primaria de Monteros", level: "Primario", shift: "Tarde", character: "Interino" };
  assert.equal(matchesProfile(matching, profile), true);
  assert.ok(matchScore(matching, profile) > matchScore(unrelated, profile));
});
