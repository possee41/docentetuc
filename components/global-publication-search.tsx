"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { officialDestination } from "@/lib/official-publication";
import type { Publication } from "@/lib/types";
import type { PublicationSearchKind } from "@/lib/publication-search";

type SearchPage = { items: Publication[]; nextCursor: string | null };
type SearchState = SearchPage & { term: string; error: string };
const emptyState: SearchState = { term: "", items: [], nextCursor: null, error: "" };

const sectionLabel = (item: Publication) => item.kind === "vacante" ? "Designaciones / SIME"
  : item.kind === "capacitacion" ? "Capacitaciones"
  : item.kind === "informacion" ? "Información útil"
  : ({ padrones: "Padrones", comunicados: "Comunicados", actos: "Actos de designación", llamados: "Llamados abiertos", vacantes: "Designaciones / SIME" } as Record<string, string>)[officialDestination(item)] || item.category || "Juntas";

export function GlobalPublicationSearch({ query, onQuery, kind, onKind, onOpen }: { query: string; onQuery: (query: string) => void; kind: PublicationSearchKind; onKind: (kind: PublicationSearchKind) => void; onOpen: (item: Publication) => void }) {
  const [state, setState] = useState<SearchState>(emptyState);
  const [loadingMore, setLoadingMore] = useState(false);
  const [retry, setRetry] = useState(0);
  const searchKey = `${kind}:${query.trim()}`;
  const current = state.term === searchKey ? state : emptyState;
  const pending = state.term !== searchKey;

  useEffect(() => {
    const term = query.trim();
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(term)}&kind=${kind}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("No pudimos completar la búsqueda.");
        const page = await response.json() as SearchPage;
        if (!controller.signal.aborted) setState({ ...page, term: searchKey, error: "" });
      } catch {
        if (!controller.signal.aborted) setState({ ...emptyState, term: searchKey, error: "No pudimos buscar ahora. Intentá nuevamente." });
      }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, kind, searchKey, retry]);

  async function loadMore() {
    if (!current.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}&kind=${kind}&cursor=${encodeURIComponent(current.nextCursor)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("No pudimos cargar más resultados.");
      const page = await response.json() as SearchPage;
      setState(previous => previous.term === searchKey ? { ...previous, items: [...previous.items, ...page.items], nextCursor: page.nextCursor, error: "" } : previous);
    } catch {
      setState(previous => previous.term === searchKey ? { ...previous, error: "No pudimos cargar más resultados. Intentá nuevamente." } : previous);
    } finally { setLoadingMore(false); }
  }

  return <section className="space-y-4 pb-20 md:pb-6" aria-labelledby="global-search-title">
    <div className="rounded-3xl border border-[#c8e1f1] bg-white p-5 shadow-sm sm:p-7">
      <h1 id="global-search-title" className="text-2xl font-black text-[#062b55]">Buscar en DocenteTuc</h1>
      <p className="mt-1 text-sm text-[#315d7a]">Designaciones, capacitaciones, documentos de Juntas e información útil. Solo contenido público.</p>
      <div className="relative mt-4 max-w-2xl"><Search className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[#52708c]" />
        <Input value={query} onChange={event => onQuery(event.target.value)} maxLength={120} aria-label="Buscar publicaciones públicas" placeholder="Título, organismo, materia o localidad" className="h-12 rounded-2xl border-[#c8e1f1] pl-12" />
      </div>
      <select aria-label="Sección del catálogo" value={kind} onChange={event => onKind(event.target.value as PublicationSearchKind)} className="mt-3 min-h-11 rounded-xl border border-[#c8e1f1] bg-white px-3 text-sm text-[#062b55]">
        <option value="all">Todas las secciones</option><option value="vacante">Designaciones SIME</option><option value="capacitacion">Capacitaciones</option><option value="junta">Juntas</option><option value="informacion">Información útil</option>
      </select>
    </div>
    {pending ? <p role="status" className="rounded-2xl bg-white p-5 text-sm text-[#315d7a]">Cargando publicaciones…</p>
      : <>
        {current.error && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><span>{current.error}</span><Button type="button" variant="outline" onClick={() => setRetry(value => value + 1)}>Reintentar</Button></div>}
        {!current.error && current.items.length === 0 && <p role="status" className="rounded-2xl bg-white p-5 text-sm text-[#315d7a]">No encontramos resultados para esta búsqueda.</p>}
        <div className="space-y-3">{current.items.map(item => <article key={item.id} className="rounded-2xl border border-[#c8e1f1] bg-white p-4 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-[#0878be]">{sectionLabel(item)} · {item.source}</p>
          <h2 className="mt-1 font-bold text-[#062b55]">{item.title}</h2>
          {item.summary && <p className="mt-1 line-clamp-2 text-sm text-[#315d7a]">{item.summary}</p>}
          <Button type="button" variant="outline" className="mt-3 min-h-10 rounded-xl" onClick={() => onOpen(item)}>Ver detalle</Button>
        </article>)}</div>
        {current.nextCursor && <Button type="button" variant="outline" disabled={loadingMore} onClick={() => void loadMore()} className="min-h-11 rounded-xl">{loadingMore ? "Cargando…" : "Cargar más resultados"}</Button>}
      </>}
  </section>;
}
