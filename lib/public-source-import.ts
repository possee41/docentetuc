import { officialMetadata, readMetadata, type CollectedPublication } from "./official-publication.ts";
import { publicationLifecycle } from "./publication-lifecycle.ts";
import { hashSourceSnapshot } from "./sync-diff.ts";
import type { PublicTraining } from "./external-trainings.ts";

export async function prepareJuntaImport(item: CollectedPublication, now = new Date()) {
  if (item.source !== "Padrones y Comunicados" || !/^(?:padrones|drive|notice):/.test(item.id)) throw new Error("JUNTA_ITEM_INVALID");
  const official = officialMetadata(item);
  if (!official?.sources.some((source) => source.url === item.officialUrl)) throw new Error("JUNTA_EVIDENCE_MISSING");
  const registrationOpenAt = official.facts.registrationStart?.value || null;
  const registrationCloseAt = official.facts.registrationEnd?.value || null;
  const contentHash = await hashSourceSnapshot(item.id, { title: item.title, summary: item.summary, status: item.status,
    startsAt: item.startsAt, endsAt: item.endsAt, sourceUpdatedAt: item.sourceUpdatedAt, metadata: readMetadata(item.metadata) });
  return { id: item.id, source: item.source, externalId: item.externalId, kind: "junta", category: item.category,
    title: item.title, summary: item.summary, level: item.level, area: item.area, junta: item.junta,
    location: item.location, shift: item.shift, character: item.character, startsAt: item.startsAt,
    endsAt: item.endsAt, status: item.status, officialUrl: item.officialUrl, metadata: item.metadata || "{}",
    contentHash, sourceUpdatedAt: item.sourceUpdatedAt, sourcePublishedAt: item.sourcePublishedAt || null,
    registrationOpenAt, registrationCloseAt, expiresAt: registrationCloseAt,
    normalizedStatus: official.entity === "opportunity" && registrationCloseAt
      ? publicationLifecycle({ registrationOpenAt, registrationCloseAt, dateStatus: "confirmed", now }) : "UNKNOWN" };
}

export async function prepareTrainingImport(item: PublicTraining, source: "CeNET / INET" | "INFoD / AulaS-TIC", now = new Date()) {
  if ((source === "CeNET / INET" && !item.id.startsWith("cenet:")) ||
      (source === "INFoD / AulaS-TIC" && !item.id.startsWith("infd:"))) throw new Error("TRAINING_ITEM_INVALID");
  const m = item.metadata, registrationOpenAt = m.registrationOpensAt || null, registrationCloseAt = m.registrationClosesAt || null;
  const contentHash = await hashSourceSnapshot(item.id, { title: item.title, summary: item.summary, status: item.status,
    startsAt: item.startsAt, endsAt: item.endsAt, metadata: m });
  return { id: item.id, source, externalId: item.externalId, kind: "capacitacion", category: m.category || source,
    title: item.title, summary: item.summary, level: item.level, area: item.area, junta: "", location: "Online",
    shift: "", character: item.modality, startsAt: item.startsAt, endsAt: item.endsAt, status: item.status,
    officialUrl: item.officialUrl, metadata: JSON.stringify(m), contentHash, sourceUpdatedAt: null,
    sourcePublishedAt: null, registrationOpenAt, registrationCloseAt, expiresAt: registrationCloseAt,
    normalizedStatus: publicationLifecycle({ sourceStatus: item.status, sourceStatusIsExplicit: true,
      registrationOpenAt, registrationCloseAt, dateStatus: m.dateStatus, now }) };
}
