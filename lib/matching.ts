import { circuitMatches, inferCircuit, profileCircuitIds } from "./circuits.ts";
import type { CircuitId } from "./circuits.ts";

export type MatchProfile = {
  level?: string; levels?: string[]; area?: string; areas?: string[]; subjects?: string | string[]; junta?: string; boards?: string[];
  department?: string; locality?: string; shifts?: string | string[]; roles?: string | string[]; characters?: string[]; circuits?: string[];
  wantsInterim?: boolean; wantsSubstitute?: boolean; trainingInterests?: string | string[]; personalMatchThreshold?: number;
};

export type MatchPublication = {
  kind: string; title: string; summary?: string; level?: string; area?: string; role?: string; junta?: string;
  location?: string; department?: string; locality?: string; shift?: string; character?: string; circuit?: string;
  sourceCircuitRaw?: string; circuitInferenceSource?: string; recipients?: string;
};

export type MatchCriterion = { key: string; label: string; expected: string; matched: boolean; available: boolean; outcome: "MATCH" | "NO_MATCH" | "UNKNOWN"; required: boolean };
export type MatchResult = { status: "exact" | "partial" | "none" | "unknown" | "unconfigured"; outcome: "MATCH" | "NO_MATCH" | "UNKNOWN"; score: number; compatibility: number; compatibilityScore: number; confidence: number; matchConfidence: number; matched: number; total: number; reasons: string[]; criteria: MatchCriterion[] };

const normalize = (value = "") => value.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
type ProfileValue = string | string[] | undefined;
const values = (value: ProfileValue) => (Array.isArray(value) ? value : (value || "").split(/[,;|]/)).map((term) => term.trim()).filter((term) => term.length > 1);
const together = (...groups: ProfileValue[]) => groups.flatMap(values);
const phraseMatches = (text: string, term: string) => {
  const haystack = ` ${normalize(text)} `, needle = normalize(term);
  if (!needle) return false;
  if (haystack.includes(` ${needle} `)) return true;
  const genderVariant = needle.endsWith("o") ? `${needle.slice(0, -1)}a` : needle.endsWith("a") ? `${needle.slice(0, -1)}o` : "";
  return Boolean(genderVariant && haystack.includes(` ${genderVariant} `));
};

export function designationRoleFromTitle(title: string) {
  const parts = title.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
  return parts.length > 2 ? parts.slice(2).join(" - ") : parts.length === 2 ? parts[1] : parts[0];
}

function publicationCircuit(publication: MatchPublication) {
  const value = normalize(publication.circuit || "");
  const id = value.match(/^(i{1,3}|iv|v|[1-5])$/)?.[1];
  if (id) return inferCircuit({ explicit: `Circuito ${id}` });
  if (value === "all") return inferCircuit({ explicit: "todos los circuitos" });
  if (value === "multiple") return inferCircuit({ explicit: publication.sourceCircuitRaw || "" });
  return inferCircuit({ explicit: publication.sourceCircuitRaw || "", department: publication.department, locality: publication.locality || publication.location });
}

export function profileMatch(publication: MatchPublication, profile: MatchProfile): MatchResult {
  const criteria: MatchCriterion[] = [];
  const add = (key: string, label: string, expected: ProfileValue, actual: (string | undefined)[], required = true, known?: boolean, inferPositiveMatchWhenUnknown = false) => {
    const wanted = values(expected);
    if (!wanted.length) return;
    const candidates = actual.filter((value): value is string => Boolean(value?.trim()));
    const available = known ?? candidates.length > 0;
    const textMatch = wanted.some((term) => candidates.some((candidate) => phraseMatches(candidate, term)));
    const matched = textMatch && (available || inferPositiveMatchWhenUnknown);
    const hasEvidence = available || matched;
    criteria.push({ key, label, expected: wanted.join(" o "), matched, available: hasEvidence, outcome: !hasEvidence ? "UNKNOWN" : matched ? "MATCH" : "NO_MATCH", required });
  };

  const expectedBoard = profile.boards?.length ? profile.boards : profile.junta;
  const expectedLevel = profile.levels?.length ? profile.levels : profile.level;
  // Junta and level describe the same broad dimension; don't double-count it.
  add(publication.kind === "capacitacion" ? "level" : "junta", publication.kind === "capacitacion" ? "Nivel" : "Junta / nivel", publication.kind === "capacitacion" ? expectedLevel : profile.boards?.length ? expectedBoard : expectedLevel || profile.junta, [publication.junta, publication.level]);

  const role = publication.role || (publication.kind === "vacante" ? designationRoleFromTitle(publication.title) : undefined);
  const preferredAreas = together(profile.areas?.length ? profile.areas : profile.area, profile.subjects);
  if (publication.kind === "vacante") {
    add("area", "Área o materia", preferredAreas, [publication.area, role]);
    add("role", "Cargo o rol", profile.roles, [role]);
  } else if (publication.kind === "capacitacion") {
    add("area", "Área o interés formativo", together(profile.trainingInterests, preferredAreas), [publication.area, publication.title, publication.summary, publication.recipients], true, Boolean(publication.area?.trim() || publication.recipients?.trim()), true);
  }

  const selectedCircuits = profile.circuits || [];
  if (selectedCircuits.length) {
    const circuit = publicationCircuit(publication), circuitOutcome = circuitMatches(circuit, selectedCircuits);
    const wanted = profileCircuitIds(selectedCircuits) as CircuitId[];
    criteria.push({ key: "circuit", label: "Circuito territorial", expected: wanted.length ? wanted.map((item) => `Circuito ${item}`).join(" o ") : selectedCircuits.join(" o "), matched: circuitOutcome === true, available: circuitOutcome !== null, outcome: circuitOutcome === null ? "UNKNOWN" : circuitOutcome ? "MATCH" : "NO_MATCH", required: true });
  }

  add("location", "Localidad o departamento", together(profile.locality, profile.department), [publication.location, publication.locality, publication.department]);
  add("shift", "Turno", profile.shifts, [publication.shift]);

  const character = normalize(publication.character);
  if (publication.kind === "vacante") {
    const configuredCharacters = profile.characters;
    if (configuredCharacters?.length) {
      const actual = character.includes("interin") ? "Interino" : character.includes("supl") ? "Suplente" : character.includes("titular") ? "Titular" : "";
      add("character", "Carácter", configuredCharacters, [actual]);
    } else {
      // Compatibility for old callers; new profiles use explicit optional selections.
      const legacy = [profile.wantsInterim === true ? "Interino" : "", profile.wantsSubstitute === true ? "Suplente" : ""].filter(Boolean);
      if (legacy.length && character) {
        const actual = character.includes("interin") ? "Interino" : character.includes("supl") ? "Suplente" : character.includes("titular") ? "Titular" : "";
        if (actual) add("character", "Carácter", legacy, [actual]);
      }
    }
  }

  const matched = criteria.filter((criterion) => criterion.matched && criterion.available).length;
  const total = criteria.length, available = criteria.filter((criterion) => criterion.available).length;
  if (!total) return result("unconfigured", 0, 0, 0, 0, criteria);
  if (!available) return result("unknown", 0, 0, 0, total, criteria);

  const score = Math.round(matched / available * 100);
  // One dimension can never establish a confident recommendation, even if it
  // is a perfect match. UNKNOWN fields don't reduce compatibility, only confidence.
  const confidence = Math.round(available / Math.max(total, 2) * 100);
  const hasExplicitMismatch = criteria.some((criterion) => criterion.outcome === "NO_MATCH");
  const status: MatchResult["status"] = confidence < 70 ? "unknown" : !matched ? "none" : score === 100 && !hasExplicitMismatch ? "exact" : "partial";
  return result(status, score, confidence, matched, total, criteria);
}

function result(status: MatchResult["status"], score: number, confidence: number, matched: number, total: number, criteria: MatchCriterion[]): MatchResult {
  const outcome: MatchResult["outcome"] = status === "unknown" || status === "unconfigured"
    ? "UNKNOWN"
    : criteria.some((criterion) => criterion.outcome === "NO_MATCH")
      ? "NO_MATCH"
      : score >= 85 ? "MATCH" : "NO_MATCH";
  return {
    status, outcome, score, compatibility: score, compatibilityScore: score, confidence, matchConfidence: confidence, matched, total, criteria,
    reasons: criteria.map((criterion) => criterion.outcome === "MATCH" ? `${criterion.label} coincide con ${criterion.expected}.` : criterion.outcome === "NO_MATCH" ? `${criterion.label} no coincide con ${criterion.expected}.` : `${criterion.label}: dato no informado; compatibilidad desconocida.`),
  };
}

export const matchScore = (publication: MatchPublication, profile: MatchProfile) => profileMatch(publication, profile).score / 100;
export const matchesProfile = (publication: MatchPublication, profile: MatchProfile) => {
  const result = profileMatch(publication, profile);
  return result.outcome === "MATCH" && result.confidence >= 70;
};

export const isEligibleMatchResult = (result: MatchResult, threshold = 85) => result.outcome === "MATCH" && result.score >= Math.min(100, Math.max(0, threshold)) && result.confidence >= 70;
export const isEligibleForPersonalizedHome = (publication: MatchPublication, profile: MatchProfile, threshold = profile.personalMatchThreshold ?? 85) => isEligibleMatchResult(profileMatch(publication, profile), threshold);
