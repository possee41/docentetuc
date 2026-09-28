import assert from "node:assert/strict";
import test from "node:test";
import { hydrateProfile, profileStorage } from "./profile.ts";

test("migra el perfil anterior sin perder selecciones", () => {
  const profile = hydrateProfile({ user_id: "u1", name: "Docente", level: "Secundario", area: "Ciencias Sociales", subjects: "Psicología, Ciudadanía", junta: "Secundaria", roles: "Profesor, Preceptor", shifts: "Mañana, Tarde" });
  assert.deepEqual(profile.levels, ["Secundario"]);
  assert.deepEqual(profile.subjects, ["Psicología", "Ciudadanía"]);
  assert.deepEqual(profile.shifts, ["Mañana", "Tarde"]);
  assert.deepEqual(profile.roles, ["Profesor", "Preceptor"]);
  assert.deepEqual(profile.characters, []);
  assert.deepEqual(profile.circuits, []);
  assert.equal(profile.personal_match_threshold, 85);
});

test("conserva circuitos, carácter y umbral personalizado", () => {
  const profile = hydrateProfile({ user_id: "u1", name: "Docente", characters: "Suplente, Titular", circuits: "II, III", personal_match_threshold: 90 });
  assert.deepEqual(profile.characters, ["Suplente", "Titular"]);
  assert.deepEqual(profile.circuits, ["II", "III"]);
  assert.equal(profile.personal_match_threshold, 90);
});

test("serializa y recupera todas las selecciones", () => {
  const stored = profileStorage(["Secundario", "Superior"]);
  assert.deepEqual(hydrateProfile({ user_id: "u1", name: "Docente", level: stored }).levels, ["Secundario", "Superior"]);
});
