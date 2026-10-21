import { inferCircuit } from "./circuits.ts";
import { publicationLifecycle } from "./publication-lifecycle.ts";
import { hashSourceSnapshot } from "./sync-diff.ts";
import { mergeTrainingData, type OfficialCommission, type OfficialCourse } from "./training.ts";

export const FDCI_BATCH_SIZE = 5;
export async function authorizedFdciImport(header: string | null, secret: string | undefined) {
  const bearer = header?.match(/^Bearer ([A-Za-z0-9_-]{32,})$/)?.[1];
  if (!secret || !bearer) return false;
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  const [expected, actual] = await Promise.all([digest(secret), digest(bearer)]);
  let difference = 0;
  for (let index = 0; index < expected.length; index++) difference |= expected[index] ^ actual[index];
  return difference === 0;
}
export type FdciImport = {
  id: string; externalId: string; category: string; title: string; summary: string;
  level: string; area: string; location: string; character: string;
  startsAt: string | null; endsAt: string | null; status: string; officialUrl: string;
  metadata: string; contentHash: string; sourceUpdatedAt: string | null;
  registrationOpenAt: string | null; registrationCloseAt: string | null;
  expiresAt: string | null; normalizedStatus: string;
  circuit: string; sourceCircuitRaw: string; circuitInferenceSource: string; circuitConfidence: number;
};

export async function prepareFdciImports(courses: OfficialCourse[], commissions: OfficialCommission[], now = new Date()): Promise<FdciImport[]> {
  return Promise.all(mergeTrainingData(courses, commissions, now).map(async (item) => {
    const metadata = JSON.stringify(item.metadata);
    const inferred = inferCircuit({ locality: item.location });
    const sourceHash = await hashSourceSnapshot(item.raw, { metadata: item.metadata, status: item.status, startsAt: item.startsAt, endsAt: item.endsAt });
    const contentHash = await hashSourceSnapshot(sourceHash, { circuit: inferred.normalizedCircuit, raw: inferred.sourceCircuitRaw, via: inferred.circuitInferenceSource });
    const registrationOpenAt = item.metadata.registrationOpensAt || null;
    const registrationCloseAt = item.metadata.registrationClosesAt || null;
    const expiresAt = item.metadata.courseEndsAt || null;
    return {
      id: item.id, externalId: item.externalId,
      category: item.metadata.entity === "commission" ? `Comisión #${item.metadata.commissionId}` : "Capacitación",
      title: item.title, summary: item.summary, level: item.level, area: item.area,
      location: item.location, character: item.modality, startsAt: item.startsAt, endsAt: item.endsAt,
      status: item.status, officialUrl: item.officialUrl, metadata, contentHash,
      sourceUpdatedAt: item.sourceUpdatedAt && Number.isFinite(Date.parse(item.sourceUpdatedAt)) ? item.sourceUpdatedAt : null,
      registrationOpenAt, registrationCloseAt, expiresAt,
      normalizedStatus: publicationLifecycle({ sourceStatus: item.status, sourceStatusIsExplicit: true, registrationOpenAt, registrationCloseAt, expiresAt, dateStatus: item.metadata.dateStatus, now }),
      circuit: inferred.normalizedCircuit, sourceCircuitRaw: inferred.sourceCircuitRaw,
      circuitInferenceSource: inferred.circuitInferenceSource, circuitConfidence: inferred.circuitConfidence,
    };
  }));
}

const smallText = (value: unknown, max: number) => typeof value === "string" && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const optionalDate = (value: unknown) => value === null || smallText(value, 40) && Number.isFinite(Date.parse(value as string));
export function validFdciImport(value: unknown): value is FdciImport {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (!/^fdci:(?:course|commission):[A-Za-z0-9_-]{1,80}$/.test(String(row.id)) || !smallText(row.externalId, 80)) return false;
  for (const [key, max] of Object.entries({ category: 120, title: 500, summary: 2000, level: 300, area: 300, location: 300, character: 300, status: 100, metadata: 6000, contentHash: 64, circuit: 20, sourceCircuitRaw: 300, circuitInferenceSource: 30 })) {
    if (!smallText(row[key], max)) return false;
  }
  if (!/^[a-f0-9]{64}$/.test(String(row.contentHash))) return false;
  if (!["ACTIVE", "UPCOMING", "CLOSED", "EXPIRED", "UNKNOWN"].includes(String(row.normalizedStatus))) return false;
  if (!["UNKNOWN", "I", "II", "III", "IV", "V", "ALL", "MULTIPLE"].includes(String(row.circuit))) return false;
  if (!Number.isInteger(row.circuitConfidence) || Number(row.circuitConfidence) < 0 || Number(row.circuitConfidence) > 100) return false;
  if (![row.startsAt, row.endsAt, row.sourceUpdatedAt, row.registrationOpenAt, row.registrationCloseAt, row.expiresAt].every(optionalDate)) return false;
  try {
    const url = new URL(String(row.officialUrl));
    if (url.protocol !== "https:" || url.hostname !== "capacitaciondocente.educaciontuc.gov.ar" || url.username || url.password) return false;
    const metadata = JSON.parse(String(row.metadata)) as Record<string, unknown>;
    if (metadata.entity !== (String(row.id).startsWith("fdci:commission:") ? "commission" : "course") || !metadata.trainingId) return false;
    if (metadata.entity === "commission" && String(metadata.commissionId) !== row.externalId) return false;
  } catch { return false; }
  return true;
}
