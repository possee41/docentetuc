export const PUBLIC_AVATAR_IDS = [
  "avatar_01", "avatar_02", "avatar_03", "avatar_04", "avatar_05",
  "avatar_06", "avatar_07", "avatar_08", "avatar_09", "avatar_10",
  "avatar_11", "avatar_12", "avatar_13", "avatar_14", "avatar_15",
  "avatar_16", "avatar_17", "avatar_18", "avatar_19", "avatar_20",
] as const;

export type PublicAvatarId = typeof PUBLIC_AVATAR_IDS[number];
export type PublicProfile = { displayName: string; avatarId: PublicAvatarId; bio: string };

/** A presentation-only shape for future community items; it is not a thread model. */
export type CommunityAuthorPreview = Pick<PublicProfile, "displayName" | "avatarId"> & { publishedAt: string };

export const DEFAULT_PUBLIC_PROFILE: PublicProfile = {
  displayName: "",
  avatarId: "avatar_01",
  bio: "",
};

export const PUBLIC_PROFILE_UPSERT_SQL = `
  INSERT INTO public_profiles (user_id, display_name, avatar_id, bio)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    display_name=excluded.display_name,
    avatar_id=excluded.avatar_id,
    bio=excluded.bio,
    updated_at=CURRENT_TIMESTAMP
  WHERE public_profiles.display_name IS NOT excluded.display_name
    OR public_profiles.avatar_id IS NOT excluded.avatar_id
    OR public_profiles.bio IS NOT excluded.bio
`;

export type PublicProfileValidation =
  | { ok: true; value: PublicProfile }
  | { ok: false; error: string };

const plainText = (value: string) => value.normalize("NFC").replace(/\s+/gu, " ").trim();
const characterCount = (value: string) => [...value].length;

export function validatePublicProfile(input: unknown): PublicProfileValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "El perfil público no es válido." };
  }

  const record = input as Record<string, unknown>;
  if (typeof record.displayName !== "string") return { ok: false, error: "Ingresá un nombre visible." };
  if (typeof record.avatarId !== "string" || !PUBLIC_AVATAR_IDS.includes(record.avatarId as PublicAvatarId)) {
    return { ok: false, error: "Elegí uno de los avatares disponibles." };
  }
  if (record.bio !== undefined && typeof record.bio !== "string") return { ok: false, error: "La biografía no es válida." };

  const displayName = plainText(record.displayName);
  const bio = plainText(typeof record.bio === "string" ? record.bio : "");
  if (!displayName) return { ok: false, error: "El nombre visible es obligatorio." };
  if (characterCount(displayName) > 40) return { ok: false, error: "El nombre visible no puede superar los 40 caracteres." };
  if (characterCount(bio) > 160) return { ok: false, error: "La biografía no puede superar los 160 caracteres." };
  if (/[<>]/u.test(displayName) || /[<>]/u.test(bio)) return { ok: false, error: "Usá texto simple; no se admite HTML." };

  return { ok: true, value: { displayName, avatarId: record.avatarId as PublicAvatarId, bio } };
}

/** Maps only the explicitly public fields. Private profile/identity columns are never returned. */
export function publicProfileForClient(record: Record<string, unknown> | null | undefined): PublicProfile | null {
  if (!record) return null;
  const validated = validatePublicProfile({
    displayName: record.display_name,
    avatarId: record.avatar_id,
    bio: record.bio,
  });
  return validated.ok ? validated.value : { ...DEFAULT_PUBLIC_PROFILE };
}
