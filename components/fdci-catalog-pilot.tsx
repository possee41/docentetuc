"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Publication } from "@/lib/types";
import { createFdciCatalogReader } from "@/lib/fdci-static-catalog";
import { integrateFdciCatalog, fdciPilotAllowed } from "@/lib/fdci-catalog-integration";
const EMPTY: Publication[] = [];
const URL = "https://possee41.github.io/docentetuc-fdci-catalog-pilot/catalog.json";
type ReadResult = Awaited<ReturnType<ReturnType<typeof createFdciCatalogReader>>>;
export function isFdciCatalogOnly(item: Publication) {
  try { return item.kind === "capacitacion" && item.source === "Capacitación Docente" && JSON.parse(item.metadata).catalogOnly === true; } catch { return false; }
}
const subscribe = (notify: () => void) => { window.addEventListener("popstate", notify); return () => window.removeEventListener("popstate", notify); };
const pilotEnabled = () => fdciPilotAllowed(window.location.hostname, window.location.search);
export function useFdciCatalogPilot(publications: Publication[] | undefined, active: boolean) {
  const current = publications ?? EMPTY;
  const enabled = useSyncExternalStore(subscribe, pilotEnabled, () => false);
  const [response, setResponse] = useState<ReadResult | null>(null);
  const [composed, setComposed] = useState<{ input: Publication[]; publications: Publication[] } | null>(null);
  const reader = useMemo(() => createFdciCatalogReader(URL), []), accepted = useRef<ReadResult | null>(null);
  const refresh = useCallback(async () => {
    let next = await reader();
    // A test flag must never become an accidental real-data source.
    if (next.catalog && (next.version !== "14ffa0ebd934c43d36757b89be76318ee0053a45352912f758786ee5377c613b" ||
        next.items.length !== 2 || next.items.some(i => !["fdci:commission:9000", "fdci:commission:9001"].includes(i.id!) || i.title !== "DEMO SINTÉTICA — NO OFICIAL"))) {
      next = accepted.current ? { ...accepted.current, status: "stale", error: "PILOT_CONTENT_REJECTED" }
        : { ...next, catalog: null, items: [], observations: {}, status: "unavailable", error: "PILOT_CONTENT_REJECTED" };
    } else accepted.current = next;
    setResponse(next);
  }, [reader]);
  useEffect(() => { if (enabled && active) void refresh(); }, [enabled, active, refresh]);
  useEffect(() => {
    let cancelled = false;
    if (enabled && active && response?.catalog) void integrateFdciCatalog(current, response.catalog, response.status === "ready" ? "ready" : "stale")
      .then(result => { if (!cancelled) setComposed({ input: current, publications: result.publications }); })
      .catch(() => { if (!cancelled) setComposed(null); });
    return () => { cancelled = true; };
  }, [enabled, active, current, response]);
  return { enabled, status: response?.status ?? "loading", updatedAt: response?.updatedAt,
    publications: enabled && active && composed?.input === current ? composed.publications : current, refresh };
}
export function FdciCatalogPilotBanner({ pilot }: { pilot: ReturnType<typeof useFdciCatalogPilot> }) {
  if (!pilot.enabled) return null;
  return <aside data-testid="fdci-catalog-pilot" role="status" className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
    <strong>Prueba FDCI — dos capacitaciones ficticias, no oficiales</strong>
    <p>{pilot.status === "loading" ? "Comprobando catálogo público…" : pilot.status === "unavailable" ? "Catálogo no disponible. Se conserva la fuente habitual."
      : pilot.status === "stale" ? "Catálogo desactualizado o no verificable ahora. Se conserva la última versión válida; no es información actual."
        : "Solo consulta. D1 conserva prioridad; los registros ficticios no admiten Guardados, Agenda, recordatorios ni IA."}</p>
    {pilot.updatedAt && <p>Última comprobación del catálogo: {pilot.updatedAt}. No equivale a una actualización oficial.</p>}
    <button type="button" onClick={() => void pilot.refresh()} className="mt-2 underline">Reintentar lectura del catálogo</button>
  </aside>;
}
