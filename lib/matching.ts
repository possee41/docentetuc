export type MatchProfile = {
  level?: string; area?: string; subjects?: string; junta?: string; department?: string;
  locality?: string; shifts?: string; wantsInterim?: boolean; wantsSubstitute?: boolean; trainingInterests?: string;
};

export type MatchPublication = {
  kind: string; title: string; summary?: string; level?: string; area?: string; junta?: string;
  location?: string; shift?: string; character?: string;
};

const terms = (value = "") => value.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[,;|]/).map((term) => term.trim()).filter((term) => term.length > 2);

export function matchScore(publication: MatchPublication, profile: MatchProfile) {
  const haystack = terms([publication.title, publication.summary, publication.level, publication.area, publication.junta, publication.location, publication.shift, publication.character].filter(Boolean).join(" | ")).join(" ");
  const profileTerms = terms([profile.level, profile.area, profile.subjects, profile.junta, profile.department, profile.locality, profile.shifts, publication.kind === "capacitacion" ? profile.trainingInterests : ""].filter(Boolean).join(","));
  if (!profileTerms.length) return 0;
  const matches = profileTerms.filter((term) => haystack.includes(term));
  let score = matches.length / profileTerms.length;
  const character = (publication.character || "").toLowerCase();
  if (character.includes("interino") && profile.wantsInterim === false) score *= 0.5;
  if (character.includes("suplente") && profile.wantsSubstitute === false) score *= 0.5;
  return Math.min(1, score);
}

export const matchesProfile = (publication: MatchPublication, profile: MatchProfile) => matchScore(publication, profile) >= 0.2;
