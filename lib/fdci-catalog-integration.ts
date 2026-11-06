import type { Publication } from "./types.ts";
import { validateFdciCatalog, type FdciCatalog } from "./fdci-static-catalog.ts";
import { canScheduleTrainingReminder, parseTrainingMetadata } from "./training.ts";
export function fdciPilotAllowed(host: string, query: string) {
  return ["localhost", "127.0.0.1", "canary.docentetuc.com.ar"].includes(host) && new URLSearchParams(query).get("fdciCatalogTest") === "1";
}

// Opt-in composition only. Existing queries, private APIs and app state untouched.
export async function integrateFdciCatalog(current: Publication[], input: FdciCatalog, freshness: "ready" | "stale", now = Date.now()) {
  const catalog = await validateFdciCatalog(input);
  if (Date.parse(catalog.updatedAt) > now + 300_000) throw Error("FDCI_CATALOG_FUTURE_DATE");
  const stale = freshness === "stale" || now - Date.parse(catalog.updatedAt) > 86_400_000;
  // Remove only previous external projections before composing this snapshot.
  // A verified empty catalog must not retain old catalog-only rows as active.
  const backend = current.filter(p => {
    try { return !(p.source === "Capacitación Docente" && p.kind === "capacitacion" && JSON.parse(p.metadata).catalogOnly === true); }
    catch { return true; }
  });
  const publications = [...backend];
  const activePublications: Publication[] = [];
  const activeAt = (status: string | undefined | null, closesAt: string | null | undefined, endsAt: string | null | undefined) =>
    !["CLOSED", "EXPIRED", "REMOVED_FROM_SOURCE"].includes(status ?? "") && ![closesAt, endsAt].some(d => d && Date.parse(d) <= now);
  const info: Record<string, { backend: boolean; stale: boolean; checkedAt: string | null; sourceUpdatedAt: string | null; lastDetectedChangeAt: string | null; canSave: boolean; canSchedule: boolean; canRemind: boolean }> = {};
  const conflicts: string[] = [];
  for (const item of catalog.items) {
    const same = backend.find(p => p.id === item.id || p.source === "Capacitación Docente" && p.external_id === item.externalId);
    if (same && same.source !== "Capacitación Docente") { conflicts.push(item.id!); continue; }
    const id = same?.id ?? item.id!, observed = catalog.observations?.[item.id!];
    info[id] = { backend: Boolean(same), stale, checkedAt: observed?.checkedAt ?? null,
      sourceUpdatedAt: item.sourceUpdatedAt, lastDetectedChangeAt: observed?.lastChangedAt ?? null,
      canSave: Boolean(same), canSchedule: Boolean(same),
      canRemind: Boolean(same && canScheduleTrainingReminder(parseTrainingMetadata(same.metadata), same.status, same.normalized_status)) };
    if (same) {
      if (!stale && activeAt(item.normalizedStatus, item.registrationCloseAt, item.endsAt) &&
          activeAt(same.normalized_status, same.registration_close_at, same.ends_at)) activePublications.push(same);
      continue; // D1 wins; active-list membership is a separate projection.
    }
    publications.push({ id, source: "Capacitación Docente", external_id: item.externalId!, kind: "capacitacion", category: item.category!,
      title: item.title!, summary: item.summary!, level: item.level!, area: item.area!, location: item.location!, character: item.character!,
      junta: "", shift: "", starts_at: item.startsAt, ends_at: item.endsAt, status: item.status!, official_url: item.officialUrl!,
      registration_open_at: item.registrationOpenAt, registration_close_at: item.registrationCloseAt,
      normalized_status: item.normalizedStatus!, source_published_at: null,
      // Unknown official dates remain unknown; checking a feed is not a source update.
      first_seen_at: "", updated_at: item.sourceUpdatedAt ?? "", removed_at: null,
      metadata: JSON.stringify({ source: "FDCI Tucumán", sourceUrl: item.officialUrl, entity: "commission",
        commissionId: item.externalId, registrationOpensAt: item.registrationOpenAt, registrationClosesAt: item.registrationCloseAt,
        dateStatus: "unknown", catalogCheckedAt: observed?.checkedAt ?? null, catalogCompletedAt: catalog.updatedAt,
        catalogOnly: true, catalogStale: stale }),
    });
    if (!stale && activeAt(item.normalizedStatus, item.registrationCloseAt, item.endsAt)) activePublications.push(publications.at(-1)!);
  }
  // Explicit context for a future chat caller; not injected into backend RAG.
  const aiContext = catalog.items.map(i => ({ id: i.id, title: i.title, url: i.officialUrl,
    checkedAt: catalog.observations?.[i.id!]?.checkedAt ?? null, sourceUpdatedAt: i.sourceUpdatedAt, stale }));
  return { publications, activePublications, info, conflicts, aiContext, catalogCompletedAt: catalog.updatedAt,
    catalogAgeMs: Math.max(0, now - Date.parse(catalog.updatedAt)), catalogStatus: stale ? "stale" : "ready" };
}
