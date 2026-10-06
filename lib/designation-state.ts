type DesignationProfile = {
  level?: string; levels?: string[]; area?: string; areas?: string[]; subjects?: string[]; junta?: string; boards?: string[];
  roles?: string[]; department?: string; locality?: string; shifts?: string[]; characters?: string[]; circuits?: string[];
  wants_interim?: number | boolean; wants_substitute?: number | boolean;
} | null | undefined;

const hasValues = (value?: string | string[]) => Array.isArray(value) ? value.some((item) => item.trim()) : Boolean(value?.trim());

export function hasDesignationProfilePreferences(profile: DesignationProfile) {
  if (!profile) return false;
  return [profile.level, profile.levels, profile.area, profile.areas, profile.subjects, profile.junta, profile.boards,
    profile.roles, profile.department, profile.locality, profile.shifts, profile.characters, profile.circuits]
    .some((value) => hasValues(value as string | string[] | undefined)) || Boolean(profile.wants_interim || profile.wants_substitute);
}

export function designationEmptyState(input: {
  filter: string;
  profileConfigured: boolean;
  availableCount: number;
  sourceStatus?: string | null;
}) {
  return {
    profileRequired: input.filter === "para-mi" && !input.profileConfigured,
    sourceUnavailable: input.availableCount === 0 && input.sourceStatus !== "OK",
    sourceVerifiedEmpty: input.availableCount === 0 && input.sourceStatus === "OK",
  };
}
