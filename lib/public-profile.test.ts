import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { DEFAULT_PUBLIC_PROFILE, PUBLIC_AVATAR_IDS, PUBLIC_PROFILE_UPSERT_SQL, publicAvatarAssetPath, publicProfileForClient, validatePublicProfile } from "./public-profile.ts";

const avatarDirectory = fileURLToPath(new URL("../public/avatars/", import.meta.url));

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
    const second = validatePublicProfile({ displayName: "Ana del Norte", avatarId: "avatar_24", bio: "Docente de nivel inicial" });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    db.prepare(PUBLIC_PROFILE_UPSERT_SQL).run("user-a", second.value.displayName, second.value.avatarId, second.value.bio);
    db.prepare(PUBLIC_PROFILE_UPSERT_SQL).run("user-b", "Otro nombre", "avatar_02", "");
    assert.deepEqual({ ...db.prepare("SELECT display_name, avatar_id, bio FROM public_profiles WHERE user_id=?").get("user-a") as Record<string, unknown> }, {
      display_name: "Ana del Norte", avatar_id: "avatar_24", bio: "Docente de nivel inicial",
    });
    assert.deepEqual({ ...db.prepare("SELECT display_name, avatar_id, bio FROM public_profiles WHERE user_id=?").get("user-b") as Record<string, unknown> }, {
      display_name: "Otro nombre", avatar_id: "avatar_02", bio: "",
    });
  } finally { db.close(); }
});

test("acepta los IDs 01, 20, 21 y 24 y rechaza avatar_25", () => {
  assert.equal(PUBLIC_AVATAR_IDS.length, 24);
  for (const avatarId of ["avatar_01", "avatar_20", "avatar_21", "avatar_24"]) {
    assert.equal(validatePublicProfile({ displayName: "Docente", avatarId, bio: "" }).ok, true);
  }
  assert.deepEqual(validatePublicProfile({ displayName: "Docente", avatarId: "avatar_25", bio: "" }), {
    ok: false, error: "Elegí uno de los avatares disponibles.",
  });
});

test("los 24 assets son WebP compactos y el fallback genérico se usa si una imagen falla", () => {
  const files = readdirSync(avatarDirectory).filter((file) => /^avatar_\d{2}\.webp$/u.test(file)).sort();
  assert.equal(files.length, 24);
  for (const avatarId of PUBLIC_AVATAR_IDS) {
    const file = `${avatarId}.webp`;
    const path = `${avatarDirectory}\\${file}`;
    const header = readFileSync(path).subarray(0, 12);
    assert.equal(header.subarray(0, 4).toString("ascii"), "RIFF");
    assert.equal(header.subarray(8, 12).toString("ascii"), "WEBP");
    assert.ok(statSync(path).size < 30_000, `${file} should remain optimized`);
  }
  assert.equal(publicAvatarAssetPath("avatar_24"), "/avatars/avatar_24.webp");
  assert.equal(publicAvatarAssetPath("avatar_01", true), null);
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
