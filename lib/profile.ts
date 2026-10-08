import type { Profile } from "./types";

export const PROFILE_BOOTSTRAP_SQL = "INSERT OR IGNORE INTO profiles (user_id, name, email) VALUES (?, ?, ?)";

export function profileList(input: unknown): string[] {
  const values = Array.isArray(input) ? input : typeof input === "string" ? input.split(/[,;|]/) : [];
  const seen = new Set<string>();
  return values.map((item) => String(item).trim()).filter((item) => {
    const key = item.toLocaleLowerCase("es");
    if (!item || seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export const profileStorage = (input: unknown, max = 300) => profileList(input).join(", ").slice(0, max);

export function hydrateProfile(record: Record<string, unknown>): Profile {
  const levels = profileList(record.levels ?? record.level), areas = profileList(record.areas ?? record.area), boards = profileList(record.boards ?? record.junta);
  return {
    ...record,
    user_id: String(record.user_id || ""), name: String(record.name || "Docente"), email: record.email ? String(record.email) : undefined,
    level: levels.join(", "), levels, area: areas.join(", "), areas, subjects: profileList(record.subjects), junta: boards.join(", "), boards, roles: profileList(record.roles),
    department: String(record.department || ""), locality: String(record.locality || ""), shifts: profileList(record.shifts),
    wants_interim: Boolean(record.wants_interim), wants_substitute: Boolean(record.wants_substitute), characters: profileList(record.characters), circuits: profileList(record.circuits), training_interests: profileList(record.training_interests),
    notify_new_trainings: Boolean(record.notify_new_trainings), training_notify_scope: (record.training_notify_scope || "relevant") as Profile["training_notify_scope"],
    training_match_threshold: Math.min(100, Math.max(0, Number(record.training_match_threshold) || 80)),
    personal_match_threshold: Math.min(100, Math.max(70, Number(record.personal_match_threshold) || 85)),
  };
}
