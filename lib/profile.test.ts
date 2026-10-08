import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { hydrateProfile, profileStorage, PROFILE_BOOTSTRAP_SQL } from "./profile.ts";

test("cargar una cuenta no sobrescribe datos de un perfil existente con valores vacíos", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE profiles(user_id TEXT PRIMARY KEY,name TEXT,email TEXT)");
    db.prepare("INSERT INTO profiles VALUES ('account-a','Nombre existente','correo-privado@example.invalid')").run();
    db.prepare(PROFILE_BOOTSTRAP_SQL).run("account-a", "Cuenta DocenteTuc", "");
    const existing = db.prepare("SELECT name,email FROM profiles WHERE user_id='account-a'").get() as { name: string; email: string };
    assert.equal(existing.name, "Nombre existente");
    assert.equal(existing.email, "correo-privado@example.invalid");
    db.prepare(PROFILE_BOOTSTRAP_SQL).run("account-b", "Nueva cuenta", "");
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM profiles").get() as { count: number }).count, 2);
  } finally { db.close(); }
});

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
