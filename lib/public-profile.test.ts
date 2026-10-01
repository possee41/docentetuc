import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_PUBLIC_PROFILE, PUBLIC_AVATAR_IDS, PUBLIC_PROFILE_UPSERT_SQL, publicProfileForClient, validatePublicProfile } from "./public-profile.ts";

test("crea y edita un perfil público sin afectar a otra identidad", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE public_profiles (
      user_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, avatar_id TEXT NOT NULL,
      bio TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    const first = validatePublicProfile({ displayName: "  Ana   Docente ", avatarId: "avatar_01", bio: " Inicial " });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    db.prepare(PUBLIC_PROFILE_UPSERT_SQL).run("user-a", first.value.displayName, first.value.avatarId, first.value.bio);
    const second = validatePublicProfile({ displayName: "Ana del Norte", avatarId: "avatar_20", bio: "Docente de nivel inicial" });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    db.prepare(PUBLIC_PROFILE_UPSERT_SQL).run("user-a", second.value.displayName, second.value.avatarId, second.value.bio);
    db.prepare(PUBLIC_PROFILE_UPSERT_SQL).run("user-b", "Otro nombre", "avatar_02", "");
    assert.deepEqual({ ...db.prepare("SELECT display_name, avatar_id, bio FROM public_profiles WHERE user_id=?").get("user-a") as Record<string, unknown> }, {
      display_name: "Ana del Norte", avatar_id: "avatar_20", bio: "Docente de nivel inicial",
    });
    assert.deepEqual({ ...db.prepare("SELECT display_name, avatar_id, bio FROM public_profiles WHERE user_id=?").get("user-b") as Record<string, unknown> }, {
      display_name: "Otro nombre", avatar_id: "avatar_02", bio: "",
    });
  } finally { db.close(); }
});

test("acepta únicamente los veinte identificadores de avatar permitidos", () => {
  assert.equal(PUBLIC_AVATAR_IDS.length, 20);
  for (const avatarId of PUBLIC_AVATAR_IDS) assert.equal(validatePublicProfile({ displayName: "Docente", avatarId, bio: "" }).ok, true);
  assert.deepEqual(validatePublicProfile({ displayName: "Docente", avatarId: "avatar_21", bio: "" }), {
    ok: false, error: "Elegí uno de los avatares disponibles.",
  });
});

test("rechaza nombre visible demasiado largo y HTML arbitrario", () => {
  assert.equal(validatePublicProfile({ displayName: "a".repeat(41), avatarId: "avatar_01", bio: "" }).ok, false);
  assert.equal(validatePublicProfile({ displayName: "<script>alert(1)</script>", avatarId: "avatar_01", bio: "" }).ok, false);
});

test("rechaza biografía demasiado larga y HTML arbitrario", () => {
  assert.equal(validatePublicProfile({ displayName: "Docente", avatarId: "avatar_01", bio: "a".repeat(161) }).ok, false);
  assert.equal(validatePublicProfile({ displayName: "Docente", avatarId: "avatar_01", bio: "<img src=x>" }).ok, false);
});

test("solo entrega campos públicos y nunca copia nombre privado ni identificadores", () => {
  const result = publicProfileForClient({
    user_id: "device:secret-uuid", email: "private@example.test", name: "Nombre privado",
    locality: "Capital", circuits: "II", display_name: "Nombre elegido", avatar_id: "avatar_03", bio: "Docente",
  });
  assert.deepEqual(result, { displayName: "Nombre elegido", avatarId: "avatar_03", bio: "Docente" });
  assert.deepEqual(DEFAULT_PUBLIC_PROFILE, { displayName: "", avatarId: "avatar_01", bio: "" });
  assert.equal(publicProfileForClient(null), null);
});
