"use client";

import { useEffect, useRef, useState } from "react";
import { deviceRequestHeaders } from "@/lib/device-user";
import type { PersonalKind } from "@/lib/personalized-catalog";
import type { PersonalFilters } from "@/lib/personalized-filters";
import type { Publication } from "@/lib/types";

type Page = { items: Publication[]; nextCursor: string | null; scanned: number; profileRequired?: boolean };
type State = Page & { key: string; loading: boolean; error: string; page: number; totalMatches: number };
const empty: State = { key: "", items: [], nextCursor: null, scanned: 0, loading: false, error: "", page: 0, totalMatches: 0 };

async function fetchChunk(kind: PersonalKind, cursor: string, filters: PersonalFilters, signal: AbortSignal) {
  const items: Publication[] = [];
  let scanned = 0, profileRequired = false, nextCursor: string | null = cursor;
  // Four small Worker invocations at most per explicit page action.
  for (let step = 0; step < 4 && nextCursor !== null; step++) {
    const params = new URLSearchParams({ kind, cursor: nextCursor, ...filters });
    const url = `/api/personalized?${params}`;
    const response = await fetch(url, { headers: deviceRequestHeaders(localStorage.getItem("docentetuc-device-id")), cache: "no-store", signal });
    if (!response.ok) throw new Error("No pudimos consultar tus coincidencias.");
    const page = await response.json() as Page;
    items.push(...page.items);
    scanned += page.scanned;
    profileRequired ||= Boolean(page.profileRequired);
    nextCursor = page.nextCursor;
  }
  return { items, scanned, nextCursor, profileRequired };
}

export function usePersonalizedCatalog(kind: PersonalKind | null, profileKey: string, filtersKey: string) {
  const key = kind ? `${kind}:${profileKey}:${filtersKey}` : "";
  const [state, setState] = useState<State>(empty);
  const [retry, setRetry] = useState(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    controller.current?.abort();
    if (!kind || !profileKey) { queueMicrotask(() => setState(empty)); return; }
    const request = new AbortController();
    controller.current = request;
    queueMicrotask(() => setState({ ...empty, key, loading: true }));
    void fetchChunk(kind, "", JSON.parse(filtersKey) as PersonalFilters, request.signal).then(page => {
      if (!request.signal.aborted) setState({ ...page, key, loading: false, error: "", page: 1, totalMatches: page.items.length });
    }).catch(() => { if (!request.signal.aborted) setState({ ...empty, key, error: "No pudimos consultar tus coincidencias." }); });
    return () => request.abort();
  }, [key, kind, profileKey, filtersKey, retry]);

  const current = state.key === key ? state : { ...empty, loading: Boolean(kind && profileKey) };
  const loadMore = async () => {
    if (!kind || !current.nextCursor || current.loading || !controller.current) return;
    const request = controller.current;
    setState(previous => ({ ...previous, loading: true, error: "" }));
    try {
      const page = await fetchChunk(kind, current.nextCursor, JSON.parse(filtersKey) as PersonalFilters, request.signal);
      if (!request.signal.aborted) setState(previous => previous.key === key ? { ...page, key, loading: false, error: "", scanned: previous.scanned + page.scanned, page: previous.page + 1, totalMatches: previous.totalMatches + page.items.length } : previous);
    } catch { if (!request.signal.aborted) setState(previous => ({ ...previous, loading: false, error: "No pudimos cargar más coincidencias." })); }
  };
  return { ...current, loadMore, retry: () => setRetry(value => value + 1) };
}
