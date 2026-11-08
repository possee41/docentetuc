import type { Publication } from "./types.ts";
import { catalogHash, validateFdciCatalog, type FdciCatalog } from "./fdci-static-catalog.ts";
import { canScheduleTrainingReminder, parseTrainingMetadata } from "./training.ts";
import { isPublicPublication } from "./publication-visibility.ts";
import { fdciPersonalMetadata } from "./fdci-personal-contract.ts";
import { isKnownFdciSynthetic } from "./fdci-canary-synthetic.ts";
export function fdciPilotAllowed(host: string, query: string) {
  return ["canary.docentetuc.com.ar", "docentetuc.com.ar"].includes(host) || ["localhost", "127.0.0.1"].includes(host) && new URLSearchParams(query).get("fdciCatalogTest") === "1";
}

export function fdciPublicVerification(item: Pick<Publication, "metadata" | "source">) {
  if (!["Capacitación Docente", "FDCI"].includes(item.source)) return null;
  try {
    const m = JSON.parse(item.metadata);
    return ["verified", "historical", "unverified"].includes(m.fdciPublicStatus) && typeof m.fdciPublicCheckedAt === "string"
      ? { status: m.fdciPublicStatus as "verified" | "historical" | "unverified", checkedAt: m.fdciPublicCheckedAt as string } : null;
  } catch { return null; }
}

// Read-only client projection. Never changes D1 snapshots, titles or private relationships.
export function withFdciPublicVerification(publications: Publication[], catalog: FdciCatalog, freshness: "ready" | "stale") {
  return publications.map(p => {
    if (p.kind !== "capacitacion" || !["Capacitación Docente", "FDCI"].includes(p.source)) return p;
    const item = catalog.items.find(i => i.id === p.id || i.externalId === p.external_id);
    let metadata; try { metadata = JSON.parse(p.metadata); } catch { metadata = {}; }
    return { ...p, metadata: JSON.stringify({ ...metadata,
      fdciPublicStatus: freshness === "stale" ? "unverified" : item ? "verified" : "historical",
      fdciPublicCheckedAt: item && catalog.observations?.[item.id!]?.checkedAt || catalog.updatedAt }) };
  });
}

export function fdciCatalogMessage(status: string, count: number | null) {
  if (status === "loading") return "Comprobando catálogo oficial…";
  if (status === "unavailable") return "No pudimos comprobar el catálogo oficial. La información histórica no acredita inscripciones abiertas.";
  if (status === "stale") return "La última versión válida está desactualizada o su actualización quedó incompleta. No acredita inscripciones activas actuales.";
  return count === 0 ? "No hay inscripciones activas verificadas" : `${count} ${count === 1 ? "comisión" : "comisiones"} en el catálogo oficial verificado. Consultá fechas y requisitos en la fuente oficial.`;
}

// Opt-in composition only. Existing queries, private APIs and app state untouched.
export async function integrateFdciCatalog(current: Publication[], input: FdciCatalog, freshness: "ready" | "stale", now = Date.now(), generation: number | null = null) {
  const catalog = await validateFdciCatalog(input);
  if (Date.parse(catalog.updatedAt) > now + 300_000) throw Error("FDCI_CATALOG_FUTURE_DATE");
  const stale = freshness === "stale" || now - Date.parse(catalog.updatedAt) > 86_400_000;
  // D1 rows obey public policy; only validated feed items may become opt-in read-only projections.
  const publications = current.filter(isPublicPublication);
  const items = catalog.items.filter(item => !isKnownFdciSynthetic(item.id!));
  const info: Record<string, { backend: boolean; stale: boolean; checkedAt: string | null; sourceUpdatedAt: string | null; lastDetectedChangeAt: string | null; canSave: boolean; canSchedule: boolean; canRemind: boolean }> = {};
  const conflicts: string[] = [];
  for (const item of items) {
    const same = current.find(p => p.id === item.id || ["Capacitación Docente", "FDCI"].includes(p.source) && p.external_id === item.externalId);
    if (same && !["Capacitación Docente", "FDCI"].includes(same.source)) { conflicts.push(item.id!); continue; }
    const id = same?.id ?? item.id!, observed = catalog.observations?.[item.id!];
    info[id] = { backend: Boolean(same), stale, checkedAt: observed?.checkedAt ?? null,
      sourceUpdatedAt: item.sourceUpdatedAt, lastDetectedChangeAt: observed?.lastChangedAt ?? null,
      canSave: Boolean(same), canSchedule: Boolean(same),
      canRemind: Boolean(same && canScheduleTrainingReminder(parseTrainingMetadata(same.metadata), same.status, same.normalized_status)) };
    if (same) {
      // An owned, materialized snapshot may reappear only in this opt-in projection, never in public SQL.
      if (!isPublicPublication(same) && !stale) {
        let m; try { m = JSON.parse(same.metadata); } catch { m = null; }
        if (m?.catalogOrigin === "fdci-versioned" && same.content_hash === await catalogHash({ item, evidence: catalog.reminderEvidence?.[item.id!] ?? null })) {
          // Refresh only the client proof after a new generation; never rewrite the stored snapshot.
          publications.push({ ...same, metadata: JSON.stringify({ ...m, catalogGeneration: generation, catalogSha256: catalog.sha256, catalogCompletedAt: catalog.updatedAt, catalogStale: false }) });
        }
      }
      continue; // D1 (including moderation/admin edits) wins; never overwrite.
    }
    publications.push({ id, source: "Capacitación Docente", external_id: item.externalId!, kind: "capacitacion", category: item.category!,
      title: item.title!, summary: item.summary!, level: item.level!, area: item.area!, location: item.location!, character: item.character!,
      junta: "", shift: "", starts_at: item.startsAt, ends_at: item.endsAt, status: item.status!, official_url: item.officialUrl!,
      registration_open_at: item.registrationOpenAt, registration_close_at: item.registrationCloseAt,
      normalized_status: item.normalizedStatus!, source_published_at: null,
      // Unknown official dates remain unknown; checking a feed is not a source update.
      first_seen_at: "", updated_at: item.sourceUpdatedAt ?? "", removed_at: null,
      metadata: JSON.stringify({ ...fdciPersonalMetadata(catalog, item, generation ?? 0), source: "FDCI Tucumán", sourceUrl: item.officialUrl, entity: "commission",
        commissionId: item.externalId, registrationOpensAt: item.registrationOpenAt, registrationClosesAt: item.registrationCloseAt,
        dateStatus: catalog.reminderEvidence?.[item.id!]?.dateStatus ?? "unknown", catalogCheckedAt: observed?.checkedAt ?? null, catalogCompletedAt: catalog.updatedAt,
        catalogOnly: true, catalogStale: stale, catalogGeneration: generation, catalogSha256: catalog.sha256 }),
    });
  }
  // Explicit context for a future chat caller; not injected into backend RAG.
  const aiContext = items.map(i => ({ id: i.id, title: i.title, url: i.officialUrl,
    checkedAt: catalog.observations?.[i.id!]?.checkedAt ?? null, sourceUpdatedAt: i.sourceUpdatedAt, stale }));
  return { publications, info, conflicts, aiContext, catalogCompletedAt: catalog.updatedAt, catalogStatus: stale ? "stale" : "ready" };
}
