export type MatchProfile = {
  level?: string; levels?: string[]; area?: string; areas?: string[]; subjects?: string | string[]; junta?: string; boards?: string[]; department?: string;
  locality?: string; shifts?: string | string[]; roles?: string | string[]; wantsInterim?: boolean; wantsSubstitute?: boolean; trainingInterests?: string | string[];
};

export type MatchPublication = {
  kind: string; title: string; summary?: string; level?: string; area?: string; junta?: string;
  location?: string; shift?: string; character?: string;
};

export type MatchCriterion = { key: string; label: string; expected: string; matched: boolean; available: boolean; required: boolean };
export type MatchResult = { status: "exact" | "partial" | "none" | "unconfigured"; score: number; confidence: number; matched: number; total: number; criteria: MatchCriterion[] };

const normalize = (value = "") => value.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
type ProfileValue = string | string[] | undefined;
const values = (value: ProfileValue) => (Array.isArray(value) ? value : (value || "").split(/[,;|]/)).map((term) => term.trim()).filter((term) => term.length > 2);
const alternatives = (value: ProfileValue) => values(value).map(normalize);
const together = (...groups: ProfileValue[]) => groups.flatMap(values);

export function profileMatch(publication: MatchPublication, profile: MatchProfile): MatchResult {
  const criteria: MatchCriterion[] = [];
  const add = (key: string, label: string, expected: ProfileValue, actual: (string | undefined)[], required = true) => {
    const wanted = alternatives(expected), visible = normalize(actual.filter(Boolean).join(" "));
    if (!wanted.length) return;
    criteria.push({ key, label, expected: values(expected).join(" o "), matched: Boolean(visible) && wanted.some((term) => visible.includes(term)), available: Boolean(visible), required });
  };

  add("level", "Nivel", profile.levels?.length ? profile.levels : profile.level, [publication.level, publication.junta, publication.title, publication.summary]);
  add("area", "Área o materia", together(profile.areas?.length ? profile.areas : profile.area, profile.subjects), [publication.area, publication.title, publication.summary]);
  if (publication.kind === "vacante") add("role", "Cargo o rol", profile.roles, [publication.area, publication.title, publication.summary]);
  if (publication.kind !== "capacitacion") add("junta", "Junta", profile.boards?.length ? profile.boards : profile.junta, [publication.junta, publication.level, publication.summary]);
  add("location", "Localidad o departamento", together(profile.locality, profile.department), [publication.location, publication.summary]);
  add("shift", "Turno", profile.shifts, [publication.shift, publication.summary]);
  if (publication.kind === "capacitacion") add("training", "Interés de capacitación", profile.trainingInterests, [publication.area, publication.title, publication.summary]);

  const character = normalize(publication.character);
  if (publication.kind === "vacante" && character.includes("interin")) criteria.push({ key: "character", label: "Carácter", expected: "Interinato", matched: profile.wantsInterim !== false, available: true, required: true });
  if (publication.kind === "vacante" && character.includes("supl")) criteria.push({ key: "character", label: "Carácter", expected: "Suplencia", matched: profile.wantsSubstitute !== false, available: true, required: true });

  const matched = criteria.filter((criterion) => criterion.matched).length, total = criteria.length;
  if (!total) return { status: "unconfigured", score: 0, confidence: 0, matched: 0, total: 0, criteria };
  const score = Math.round(matched / total * 100), available = criteria.filter((criterion) => criterion.available).length, confidence = Math.round(available / total * 100), missingRequired = criteria.some((criterion) => criterion.required && !criterion.matched);
  return { status: !matched ? "none" : missingRequired ? "partial" : "exact", score, confidence, matched, total, criteria };
}

export const matchScore = (publication: MatchPublication, profile: MatchProfile) => profileMatch(publication, profile).score / 100;
export const matchesProfile = (publication: MatchPublication, profile: MatchProfile) => {
  const result = profileMatch(publication, profile);
  return result.status === "exact" || (result.status === "partial" && result.score >= 50);
};
