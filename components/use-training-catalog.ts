"use client";

import { useEffect, useState } from "react";
import type { Publication } from "@/lib/types";

type State = { items: Publication[]; loading: boolean; complete: boolean; error: string };
const empty: State = { items: [], loading: false, complete: false, error: "" };
export const trainingCatalogFailure = (previous: State): State => ({ ...previous, loading: false, error: "No pudimos cargar el catálogo completo de capacitaciones. Reintentá la lectura." });

export async function fetchTrainingCatalog(fetcher: typeof fetch, signal?: AbortSignal) {
  const items: Publication[] = [], seen = new Set<string>();
  let cursor: string | null = "";
  while (cursor !== null) {
    const params = new URLSearchParams({ kind: "capacitacion", limit: "80" });
    if (cursor) params.set("cursor", cursor);
    const response = await fetcher(`/api/search?${params}`, { cache: "no-store", signal });
    if (!response.ok) throw new Error("TRAINING_CATALOG_UNAVAILABLE");
    const page = await response.json() as { items: Publication[]; nextCursor: string | null };
    if (!Array.isArray(page.items) || page.items.length > 80 ||
        page.nextCursor !== null && (typeof page.nextCursor !== "string" || !page.items.length || seen.has(page.nextCursor)))
      throw new Error("TRAINING_CATALOG_PAGE_INVALID");
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor !== null) seen.add(cursor);
  }
  return items;
}

export function useTrainingCatalog(active: boolean, refreshKey: unknown) {
  const [state, setState] = useState<State>(empty);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) setState(previous => ({ ...previous, loading: true, error: "" })); });
    void fetchTrainingCatalog(fetch, controller.signal)
      .then(items => { if (!controller.signal.aborted) setState({ items, loading: false, complete: true, error: "" }); })
      .catch(() => { if (!controller.signal.aborted) setState(trainingCatalogFailure); });
    return () => controller.abort();
  }, [active, refreshKey]);
  return state;
}
