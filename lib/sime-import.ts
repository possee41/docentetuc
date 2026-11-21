import { officialMetadata, readMetadata, type CollectedPublication } from "./official-publication.ts";
import { publicationLifecycle } from "./publication-lifecycle.ts";
import { hashSourceSnapshot } from "./sync-diff.ts";

// Only source-backed fields enter the hash. A detail-check timestamp is not a publication change.
export async function prepareSimeImport(item: CollectedPublication, now = new Date()) {
  const metadata = readMetadata(item.metadata);
  const official = officialMetadata(item);
  if (item.source !== "SIME" || !/^sime:\d+$/.test(item.id) || !official || official.entity !== "opportunity") throw new Error("SIME_ITEM_INVALID");
  const stable = structuredClone(metadata);
  const facts = (stable.official as Record<string, unknown>);
  delete facts.detailAttemptedAt;
  delete facts.detailCheckedAt;
  delete facts.detailStatus;
  const contentHash = await hashSourceSnapshot(item.id, { title: item.title, summary: item.summary, status: item.status, startsAt: item.startsAt, endsAt: item.endsAt, metadata: stable });
  const registrationOpenAt = official.facts.publicationStart?.precision === "datetime" ? official.facts.publicationStart.value : null;
  const registrationCloseAt = official.facts.publicationEnd?.precision === "datetime" ? official.facts.publicationEnd.value : null;
  return {
    id: item.id, externalId: item.externalId, kind: "vacante", category: item.category, title: item.title,
    summary: item.summary, level: item.level, area: item.area, junta: item.junta, location: item.location,
    shift: item.shift, character: item.character, startsAt: item.startsAt, endsAt: item.endsAt,
    status: item.status, officialUrl: item.officialUrl, metadata: item.metadata || "{}", contentHash,
    sourceUpdatedAt: item.sourceUpdatedAt, sourcePublishedAt: item.sourcePublishedAt || null,
    registrationOpenAt, registrationCloseAt, expiresAt: registrationCloseAt,
    normalizedStatus: publicationLifecycle({ sourceStatus: item.status, sourceStatusIsExplicit: true, registrationOpenAt, registrationCloseAt, dateStatus: "confirmed", now }),
  };
}
