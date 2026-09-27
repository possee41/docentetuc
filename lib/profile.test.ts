import assert from "node:assert/strict";
import test from "node:test";
import { hydrateProfile, profileStorage } from "./profile.ts";

test("migra el perfil anterior sin perder selecciones", () => {
  const profile = hydrateProfile({ user_id: "u1", name: "Docente", level: "Secundario", area: "Ciencias Sociales", subjects: "Psicología, Ciudadanía", junta: "Secundaria", roles: "Profesor, Preceptor", shifts: "Mañana, Tarde" });
  assert.deepEqual(profile.levels, ["Secundario"]);
  assert.deepEqual(profile.subjects, ["Psicología", "Ciudadanía"]);
  assert.deepEqual(profile.shifts, ["Mañana", "Tarde"]);
  assert.deepEqual(profile.roles, ["Profesor", "Preceptor"]);
});

test("serializa y recupera todas las selecciones", () => {
  const stored = profileStorage(["Secundario", "Superior"]);
  assert.deepEqual(hydrateProfile({ user_id: "u1", name: "Docente", level: stored }).levels, ["Secundario", "Superior"]);
});
