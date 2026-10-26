import { designationFacts } from "./designations.ts";
import { isEligibleMatchResult, profileMatch, type MatchProfile, type MatchPublication } from "./matching.ts";
import { hasOfficialTopic, officialLifecycle, officialMetadata } from "./official-publication.ts";
import { publicationLifecycle } from "./publication-lifecycle.ts";
import { enrollmentState, parseTrainingMetadata } from "./training.ts";
import type { Profile, Publication } from "./types.ts";

export type PersonalKind = "vacante" | "capacitacion";
export const PERSONAL_SCAN_SIZE = 120;
export const PERSONAL_PAGE_SIZE = 20;

export function matchProfileFromUser(profile: Profile): MatchProfile {
  return { levels: profile.levels, areas: profile.areas, subjects: profile.subjects, boards: profile.boards,
    roles: profile.roles, department: profile.department, locality: profile.locality, shifts: profile.shifts,
    characters: profile.characters, circuits: profile.circuits, personalMatchThreshold: profile.personal_match_threshold,
    wantsInterim: Boolean(profile.wants_interim), wantsSubstitute: Boolean(profile.wants_substitute), trainingInterests: profile.training_interests };
}

export function hasPersonalCriteria(profile: Profile, kind: PersonalKind) {
  const fields = kind === "vacante"
    ? [profile.levels, profile.boards, profile.areas, profile.subjects, profile.roles, profile.shifts, profile.characters, profile.circuits, profile.locality, profile.department]
    : [profile.levels, profile.boards, profile.areas, profile.subjects, profile.training_interests, profile.shifts, profile.circuits, profile.locality, profile.department];
  return fields.some(value => Array.isArray(value) ? value.some(Boolean) : Boolean(value));
}

export function publicationForMatch(publication: Publication): MatchPublication {
  const training = publication.kind === "capacitacion" ? parseTrainingMetadata(publication.metadata) : null;
  return { kind: publication.kind, title: publication.title, summary: publication.summary, level: publication.level,
    area: publication.area, role: publication.kind === "vacante" ? designationFacts(publication).role : undefined,
    junta: publication.junta, location: publication.location, shift: publication.shift, character: publication.character,
    circuit: publication.circuit, sourceCircuitRaw: publication.source_circuit_raw || (training ? [training.recipients, training.content].filter(Boolean).join(" ") : ""),
    circuitInferenceSource: publication.circuit_inference_source, recipients: training?.recipients };
}

export function publicationLifecycleForDisplay(item: Publication, now = new Date()) {
  const official = officialLifecycle(item, now);
  if (official) return official;
  const metadata = parseTrainingMetadata(item.metadata);
  const designation = item.kind === "vacante";
  return publicationLifecycle({ normalizedStatus: item.normalized_status, sourceStatus: item.source_status || item.status,
    sourceStatusIsExplicit: true, registrationOpenAt: designation ? item.starts_at : metadata?.registrationOpensAt,
    registrationCloseAt: designation ? item.ends_at : metadata?.registrationClosesAt,
    expiresAt: designation ? item.ends_at : metadata?.courseEndsAt, dateStatus: designation ? "confirmed" : metadata?.dateStatus, now });
}

export function enrollmentForDisplay(item: Publication, now = new Date()) {
  return enrollmentState(parseTrainingMetadata(item.metadata), item.source_status || item.status, item.normalized_status, now);
}

export function eligiblePersonalPublication(item: Publication, profile: Profile, kind: PersonalKind, now = new Date()) {
  if (item.kind !== kind || officialMetadata(item)?.canonicalId) return false;
  if (kind === "vacante" && (!hasOfficialTopic(item, "INSCRIPCION_SIME") || publicationLifecycleForDisplay(item, now) !== "ACTIVE")) return false;
  if (kind === "capacitacion" && !["ABRE_HOY", "PROXIMAMENTE", "ABIERTA"].includes(enrollmentForDisplay(item, now))) return false;
  return isEligibleMatchResult(profileMatch(publicationForMatch(item), matchProfileFromUser(profile)), profile.personal_match_threshold);
}

export const PERSONAL_CATALOG_SQL = `SELECT * FROM publications WHERE kind=? AND id>? ORDER BY id LIMIT ${PERSONAL_SCAN_SIZE + 1}`;

type CatalogDB = { prepare(sql: string): { bind(...values: string[]): { all<T>(): Promise<{ results: T[]; meta?: { rows_read?: number } }> } } };

export async function personalizedCatalogPage(db: CatalogDB, profile: Profile, kind: PersonalKind, cursor = "", now = new Date(), accepts: (item: Publication) => boolean = () => true) {
  const result = await db.prepare(PERSONAL_CATALOG_SQL).bind(kind, cursor).all<Publication>();
  const items: Publication[] = [];
  let scanned = 0;
  for (const item of result.results.slice(0, PERSONAL_SCAN_SIZE)) {
    scanned++;
    if (eligiblePersonalPublication(item, profile, kind, now) && accepts(item)) items.push(item);
    if (items.length === PERSONAL_PAGE_SIZE) break;
  }
  const nextCursor = (scanned < result.results.length || result.results.length > PERSONAL_SCAN_SIZE)
    ? result.results[scanned - 1]?.id || null : null;
  return { items, nextCursor, scanned, rowsRead: result.meta?.rows_read ?? null };
}
