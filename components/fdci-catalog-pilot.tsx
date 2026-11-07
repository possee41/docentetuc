"use client";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Publication } from "@/lib/types";
import { createFdciVersionedReader, FDCI_RAW_ACTIVE_URL } from "@/lib/fdci-static-publication";
import { integrateFdciCatalog, fdciPilotAllowed } from "@/lib/fdci-catalog-integration";
import { isPublicPublication } from "@/lib/publication-visibility";
const EMPTY: Publication[] = [];
type ReadResult = Awaited<ReturnType<ReturnType<typeof createFdciVersionedReader>>>;
export function isFdciCatalogOnly(item: Publication) {
  try { return item.kind === "capacitacion" && ["Capacitación Docente", "FDCI"].includes(item.source) && JSON.parse(item.metadata).catalogOnly === true; } catch { return false; }
}
const subscribe = (notify: () => void) => { window.addEventListener("popstate", notify); return () => window.removeEventListener("popstate", notify); };
const pilotEnabled = () => fdciPilotAllowed(window.location.hostname, window.location.search);
export function useFdciCatalogPilot(publications: Publication[] | undefined, active: boolean) {
  const current = publications ?? EMPTY;
  const publicCurrent = useMemo(() => current.filter(isPublicPublication), [current]);
  const enabled = useSyncExternalStore(subscribe, pilotEnabled, () => false);
  const [response, setResponse] = useState<ReadResult | null>(null);
  const [composed, setComposed] = useState<{ input: Publication[]; response: ReadResult; publications: Publication[] } | null>(null);
  const reader = useMemo(() => createFdciVersionedReader(FDCI_RAW_ACTIVE_URL), []);
  const refresh = useCallback(async () => {
    setResponse(await reader());
  }, [reader]);
  useEffect(() => {
    let cancelled = false;
    if (enabled && active) void reader().then(next => { if (!cancelled) setResponse(next); });
    return () => { cancelled = true; };
  }, [enabled, active, reader]);
  useEffect(() => {
    let cancelled = false;
    if (enabled && active && response?.catalog) void integrateFdciCatalog(current, response.catalog, response.status === "ready" ? "ready" : "stale", Date.now(), response.generation)
      .then(result => { if (!cancelled) setComposed({ input: current, response, publications: result.publications }); })
      .catch(() => { if (!cancelled) setComposed(null); });
    return () => { cancelled = true; };
  }, [enabled, active, current, response]);
  return { enabled, status: response?.status ?? "loading", updatedAt: response?.updatedAt,
    generation: response?.generation, interrupted: response?.lastAttempt?.error === "FDCI_CANCELLED",
    publications: enabled && active && composed?.input === current && composed.response === response ? composed.publications : publicCurrent, refresh };
}
export function FdciCatalogPilotBanner({ pilot }: { pilot: ReturnType<typeof useFdciCatalogPilot> }) {
  if (!pilot.enabled) return null;
  return <aside data-testid="fdci-catalog-pilot" role="status" className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
    <strong>Prueba FDCI — catálogo oficial versionado · solo consulta</strong>
    <p>{pilot.status === "loading" ? "Comprobando catálogo público…" : pilot.status === "unavailable" ? "Catálogo no disponible. Se conserva la fuente habitual."
      : pilot.status === "stale" ? "Catálogo desactualizado o no verificable ahora. Se conserva la última versión válida; no es información actual."
        : "D1 conserva prioridad. Los registros externos no admiten Guardados, Agenda, recordatorios ni IA en esta prueba."}</p>
    {pilot.updatedAt && <p>Última actualización exitosa del catálogo: {pilot.updatedAt} · generación {pilot.generation}. No es la fecha de modificación de cada capacitación.</p>}
    {pilot.interrupted && <p>La última verificación registrada fue interrumpida; no acredita un error actual de la fuente oficial.</p>}
    <button type="button" onClick={() => void pilot.refresh()} className="mt-2 underline">Reintentar lectura del catálogo</button>
  </aside>;
}
