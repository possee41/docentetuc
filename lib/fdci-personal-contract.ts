import type { CatalogItem, FdciCatalog } from "./fdci-static-catalog.ts";
import type { Publication } from "./types.ts";

export function fdciCatalogReference(publication: Pick<Publication, "metadata">) {
  try {
    const m = JSON.parse(publication.metadata);
    return Number.isSafeInteger(m.catalogGeneration) && m.catalogGeneration > 0 && /^[a-f0-9]{64}$/.test(m.catalogSha256)
      ? { generation: m.catalogGeneration as number, catalogSha256: m.catalogSha256 as string } : null;
  } catch { return null; }
}
export function fdciPersonalMetadata(catalog: FdciCatalog, item: CatalogItem, generation: number) {
  const evidence = catalog.reminderEvidence?.[item.id!];
  return { source: "FDCI Tucumán", sourceUrl: item.officialUrl, entity: "commission", commissionId: item.externalId,
    trainingId: evidence?.trainingId ?? "", registrationOpensAt: item.registrationOpenAt, registrationClosesAt: item.registrationCloseAt,
    registrationHasTime: evidence?.registrationHasTime ?? false, dateStatus: evidence?.dateStatus ?? "unknown",
    ...(evidence?.availablePreCapacity == null ? {} : { availablePreCapacity: evidence.availablePreCapacity }),
    catalogOrigin: "fdci-versioned", catalogOnly: true, catalogGeneration: generation, catalogSha256: catalog.sha256,
    catalogCompletedAt: catalog.updatedAt, catalogStale: false };
}
export function fdciPersonalBlocked(publication: Pick<Publication, "metadata" | "source">) {
  try {
    const m = JSON.parse(publication.metadata);
    if (m?.fdciCanaryFixture === true && !(Date.parse(m.fixtureExpiresAt) > Date.now())) return true;
    return ["Capacitación Docente", "FDCI"].includes(publication.source) && m.catalogOnly === true &&
      !((m.catalogOrigin === "fdci-versioned" || m.catalogOrigin === "fdci-canary-fixture" && m.fdciCanaryFixture === true && m.preview === true) && m.catalogPersonalEligible === true && m.catalogStale === false && fdciCatalogReference(publication));
  } catch { return false; }
}
export function withFdciPersonalCapability(publications: Publication[], enabled: boolean, now = Date.now()) {
  return publications.map(p => {
    let m; try { m = JSON.parse(p.metadata); } catch { return p; }
    if (!["fdci-versioned", "fdci-canary-fixture"].includes(m?.catalogOrigin)) return p;
    const age = now - Date.parse(m.catalogCompletedAt);
    return { ...p, metadata: JSON.stringify({ ...m, catalogPersonalEligible: enabled && !m.catalogStale && age >= 0 && age <= 86_400_000 &&
      (m.fdciCanaryFixture !== true || Date.parse(m.fixtureExpiresAt) > now) && Boolean(fdciCatalogReference(p)) }) };
  });
}
