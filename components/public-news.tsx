"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ArrowLeft, ArrowRight, ExternalLink, ListFilter, RefreshCw } from "lucide-react";
import type { PublicNewsItem, PublicNewsSource } from "@/lib/public-news";

type NewsPage = { items: PublicNewsItem[]; nextPage: number | null; topics: string[] };
type NewsDetail = PublicNewsItem & { body: string | null; sources: PublicNewsSource[] };
const sourceLabels: Record<PublicNewsSource["type"], string> = {
  official: "Fuente oficial", public: "Fuente pública", union: "Fuente gremial", media: "Fuente periodística",
};
const date = (value: string) => new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Tucuman", day: "numeric", month: "long", year: "numeric" }).format(new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00-03:00` : value));
const dateTime = (value: string) => new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Tucuman", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
const pageFromParams = (params: URLSearchParams) => Math.min(100, Math.max(0, Number.parseInt(params.get("page") || "0", 10) || 0));

async function getNews<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error || "No pudimos cargar las noticias.");
  return result;
}

function NewsImage({ image, eager = false }: { image: NonNullable<PublicNewsItem["image"]>; eager?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <figure className="mb-4 overflow-hidden rounded-xl bg-[var(--surface-primary)]">
    <Image src={image.url} alt={image.alt} width={1200} height={675} unoptimized loading={eager ? "eager" : "lazy"} referrerPolicy="no-referrer"
      onError={() => setFailed(true)} className="aspect-video max-h-64 w-full object-cover" />
    {image.kind === "illustration" && <figcaption className="px-2 py-1 text-xs text-[var(--text-muted)]">Ilustración de categoría; no es una fotografía del hecho.</figcaption>}
  </figure>;
}

function NewsCard({ item, onOpen, wide = false }: { item: PublicNewsItem; onOpen: () => void; wide?: boolean }) {
  const urgent = item.relevance === "urgente";
  const prominent = urgent || item.featured;
  const linkClass = "text-left decoration-[var(--accent-text)] decoration-2 underline-offset-4 transition group-hover:underline focus-visible:underline";
  return <article className={`group flex min-w-0 flex-col border-b border-[var(--border)] py-5 ${wide ? "lg:col-span-2" : ""} ${urgent ? "border-l-4 border-l-red-600 bg-[var(--surface-primary)] pl-4 pr-3" : item.featured ? "border-t-2 border-t-[var(--accent-text)]" : ""}`}>
    {item.image && <div className="order-3 mt-4 lg:order-1 lg:mt-0"><NewsImage key={item.image.url} image={item.image} /></div>}
    <div className="order-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold uppercase tracking-wide lg:order-2">
      <span className={urgent ? "rounded bg-red-700 px-2 py-1 text-white" : "text-[var(--accent-text)]"}>{urgent ? "Urgente" : item.relevance === "importante" ? "Importante" : "Actualidad"}</span>
      {item.featured && <span className="text-[var(--text-muted)]">Destacada</span>}
      <span className="text-[var(--text-muted)]">{date(item.publishedAt)}</span>
    </div>
    <h3 className={`order-2 mt-3 break-words font-black leading-tight tracking-tight text-[var(--text-primary)] lg:order-3 ${prominent ? "text-2xl sm:text-3xl" : "text-xl sm:text-2xl"}`}>
      <button type="button" onClick={onOpen} className={linkClass}>{item.title}</button>
    </h3>
    <p className="order-4 mt-3 line-clamp-4 whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--text-secondary)] sm:text-base">{item.summary}</p>
    <div className="order-5 mt-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-t border-[var(--border)] pt-3 text-xs text-[var(--text-muted)]">
      <div><span className="font-bold text-[var(--text-secondary)]">{item.topic || "Actualidad docente"}</span><span className="block mt-1">{sourceLabels[item.primarySource.type]} · {item.primarySource.name}</span>{item.validUntil && <span className="block mt-1">Vigente hasta {dateTime(item.validUntil)}</span>}</div>
      <button type="button" onClick={onOpen} className="inline-flex min-h-10 items-center gap-1 font-bold text-[var(--accent-text)]">Leer noticia <ArrowRight className="size-4" /></button>
    </div>
  </article>;
}

export function PublicNewsSection() {
  const [detailId, setDetailId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState("");
  const [relevance, setRelevance] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [ready, setReady] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [list, setList] = useState<NewsPage>({ items: [], nextPage: null, topics: [] });
  const [detail, setDetail] = useState<NewsDetail | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    const onPop = () => { const params = new URLSearchParams(location.search);
      setDetailId(params.get("news")); setQuery(params.get("q") || ""); setDebouncedQuery(params.get("q") || ""); setTopic(params.get("topic") || "");
      setRelevance(params.get("relevance") || ""); setPage(pageFromParams(params)); };
    queueMicrotask(() => { if (active) { onPop(); setReady(true); } });
    window.addEventListener("popstate", onPop);
    return () => { active = false; window.removeEventListener("popstate", onPop); };
  }, []);
  useEffect(() => { const timer = setTimeout(() => setDebouncedQuery(query), 250); return () => clearTimeout(timer); }, [query]);
  useEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams(location.search);
    for (const [key, value] of [["q", debouncedQuery], ["topic", topic], ["relevance", relevance], ["page", page ? String(page) : ""]]) {
      if (value) params.set(key, value); else params.delete(key);
    }
    history.replaceState(history.state, "", `${location.pathname}?${params}`);
  }, [ready, debouncedQuery, topic, relevance, page]);
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000);
    let active = true;
    queueMicrotask(() => { if (active) { setLoading(true); setError(""); } });
    const params = new URLSearchParams({ q: debouncedQuery, topic, relevance, page: String(page) });
    const url = detailId ? `/api/news?id=${encodeURIComponent(detailId)}` : `/api/news?${params}`;
    void getNews<NewsDetail | NewsPage>(url, controller.signal).then((result) => {
      if (!active) return;
      if (detailId) setDetail(result as NewsDetail); else setList(result as NewsPage);
    }).catch(() => { if (active) { setError("No pudimos cargar las noticias. Intentá nuevamente."); if (detailId) setDetail(null); else setList((old) => ({ ...old, items: [] })); } })
      .finally(() => { clearTimeout(timer); if (active) setLoading(false); });
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [ready, detailId, debouncedQuery, topic, relevance, page, retry]);

  const filter = (key: string, value: string) => {
    if (key === "q") setQuery(value);
    if (key === "topic") setTopic(value);
    if (key === "relevance") setRelevance(value);
    setPage(0);
  };
  const open = (id: string) => { const url = new URL(location.href); url.searchParams.set("news", id);
    history.pushState({ ...history.state, newsDetail: true }, "", url); setDetail(null); setDetailId(id); };
  const back = () => {
    if (history.state?.newsDetail) { history.back(); return; }
    const url = new URL(location.href); url.searchParams.delete("news"); history.replaceState(history.state, "", url); setDetailId(null);
  };
  const urgentItems = list.items.filter((entry) => entry.relevance === "urgente");
  const featuredItems = list.items.filter((entry) => entry.relevance !== "urgente" && entry.featured);
  const otherItems = list.items.filter((entry) => entry.relevance !== "urgente" && !entry.featured);

  return <section className="public-news-section mx-auto max-w-5xl space-y-5 pb-10" aria-label="Noticias">
    {detailId ? <>
      <button type="button" onClick={back} className="inline-flex min-h-11 items-center gap-2 font-bold text-[var(--accent-text)]"><ArrowLeft className="size-4" />Volver a Noticias</button>
      {loading ? <p role="status">Cargando noticia…</p> : error ? <div role="alert"><p>{error}</p><button onClick={() => setRetry((value) => value + 1)} className="mt-2 inline-flex min-h-11 items-center gap-2 font-bold"><RefreshCw className="size-4" />Reintentar</button></div>
        : detail && <article className="min-w-0 bg-[var(--surface-primary)] px-4 py-6 sm:px-8 sm:py-9">
          {detail.image && <div className="mb-7"><NewsImage key={detail.image.url} image={detail.image} eager /><p className="text-xs text-[var(--text-muted)]">Imagen: {detail.image.credit} · <a href={detail.image.sourceUrl} target="_blank" rel="noopener noreferrer" className="font-bold text-[var(--accent-text)] underline">Procedencia</a></p></div>}
          <header className="border-b border-[var(--border)] pb-6">
            <p className="text-sm font-black uppercase tracking-widest text-[var(--accent-text)]">{detail.relevance === "urgente" ? <span className="rounded bg-red-700 px-2 py-1 text-white">Urgente</span> : detail.relevance === "importante" ? "Importante" : "Actualidad"}{detail.topic ? ` · ${detail.topic}` : ""}</p>
            <h1 className="mt-4 max-w-4xl break-words text-3xl font-black leading-tight tracking-tight text-[var(--text-primary)] sm:text-5xl">{detail.title}</h1>
            <p className="mt-4 text-sm text-[var(--text-muted)]">Publicada el {date(detail.publishedAt)}{detail.validUntil ? ` · Vigente hasta el ${dateTime(detail.validUntil)}` : ""}</p>
          </header>
          <div className="grid gap-8 pt-7 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="min-w-0">
              <h2 className="text-sm font-black uppercase tracking-wide text-[var(--accent-text)]">Síntesis editorial</h2>
              <p className="mt-3 whitespace-pre-wrap break-words text-lg leading-relaxed text-[var(--text-primary)]">{detail.summary}</p>
              {detail.body ? <><h2 className="mt-8 text-sm font-black uppercase tracking-wide text-[var(--accent-text)]">Contenido editorial</h2>
                <p className="mt-3 whitespace-pre-wrap break-words text-base leading-8 text-[var(--text-primary)]">{detail.body}</p></>
                : <p className="mt-6 text-sm text-[var(--text-secondary)]">Para consultar el contenido completo, abrí la fuente original.</p>}
              <a href={detail.primarySource.url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-11 items-center gap-2 font-bold text-[var(--accent-text)]">Leer en la fuente original <ExternalLink className="size-4" /></a>
            </div>
            <aside className="min-w-0 border-t border-[var(--border)] pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0" aria-label="Fuentes y referencias">
              <h2 className="font-black text-[var(--text-primary)]">Fuentes y referencias</h2>
              <ul className="mt-3 space-y-4">{detail.sources.map((entry) => <li key={entry.url} className="border-b border-[var(--border)] pb-4 text-sm">
                <span className="block font-bold text-[var(--text-primary)]">{sourceLabels[entry.type]} · {entry.name}</span>
                <span className="mt-1 block text-[var(--text-secondary)]">{entry.title}{entry.publishedAt ? ` · ${date(entry.publishedAt)}` : ""}{entry.withdrawn ? " · Fuente retirada" : ""}</span>
                <a href={entry.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-10 items-center gap-1 break-all font-bold text-[var(--accent-text)]">Abrir referencia <ExternalLink className="size-4 shrink-0" /></a>
              </li>)}</ul>
            </aside>
          </div>
          <p className="mt-8 border-t border-[var(--border)] pt-4 text-xs text-[var(--text-muted)]">DocenteTuc es independiente de los organismos y organizaciones citados. Consultá siempre la fuente original.</p>
        </article>}
    </> : <>
      <div><p className="text-sm font-black uppercase tracking-widest text-[var(--accent-text)]">Actualidad docente</p><h1 className="mt-1 text-2xl font-black text-[var(--text-primary)]">Noticias</h1><p className="mt-1 text-sm text-[var(--text-secondary)]">Novedades revisadas por el equipo editorial de DocenteTuc.</p></div>
      <div className="grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-primary)] p-3 lg:grid-cols-3 lg:p-4">
        <div className="flex min-w-0 items-end gap-2"><label className="min-w-0 flex-1 text-sm font-bold text-[var(--text-primary)]">Buscar noticia<input value={query} maxLength={100} onChange={(event) => filter("q", event.target.value)} placeholder="Título o resumen" className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface-primary)] px-3 text-[var(--text-primary)]" /></label>
          <button type="button" aria-controls="news-filters" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)} className={`inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl border px-3 text-sm font-bold lg:hidden ${topic || relevance ? "border-[var(--accent-text)] bg-[var(--accent-soft)] text-[var(--accent-text)]" : "border-[var(--border)] text-[var(--text-primary)]"}`}><ListFilter className="size-4" />Filtros{topic || relevance ? ` (${Number(Boolean(topic)) + Number(Boolean(relevance))})` : ""}</button></div>
        <div id="news-filters" className={`${filtersOpen ? "grid" : "hidden"} grid-cols-2 gap-2 lg:contents`}>
          <label className="min-w-0 text-sm font-bold text-[var(--text-primary)]">Tema<select value={topic} onChange={(event) => filter("topic", event.target.value)} className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface-primary)] px-2 text-[var(--text-primary)]"><option value="">Todos</option>{list.topics.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className="min-w-0 text-sm font-bold text-[var(--text-primary)]">Importancia<select value={relevance} onChange={(event) => filter("relevance", event.target.value)} className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface-primary)] px-2 text-[var(--text-primary)]"><option value="">Todas</option><option value="urgente">Urgente</option><option value="importante">Importante</option><option value="informativa">Informativa</option></select></label>
        </div>
      </div>
      {loading ? <p role="status" className="text-[var(--text-secondary)]">Cargando noticias…</p> : error ? <div role="alert"><p>{error}</p><button onClick={() => setRetry((value) => value + 1)} className="mt-2 inline-flex min-h-11 items-center gap-2 font-bold"><RefreshCw className="size-4" />Reintentar</button></div>
        : list.items.length ? <div className="space-y-8">
          {urgentItems.length > 0 && <section aria-label="Noticias urgentes"><h2 className="mb-2 border-l-4 border-red-600 pl-3 text-lg font-black text-[var(--text-primary)]">Urgentes</h2><div className="grid gap-x-8 lg:grid-cols-2">{urgentItems.map((entry, index) => <NewsCard key={entry.id} item={entry} onOpen={() => open(entry.id)} wide={index === 0 && Boolean(entry.image)} />)}</div></section>}
          {featuredItems.length > 0 && <section aria-label="Noticias destacadas"><h2 className="mb-2 text-lg font-black text-[var(--text-primary)]">Destacadas</h2><div className="grid gap-x-8 lg:grid-cols-2">{featuredItems.map((entry, index) => <NewsCard key={entry.id} item={entry} onOpen={() => open(entry.id)} wide={index === 0 && Boolean(entry.image)} />)}</div></section>}
          {otherItems.length > 0 && <section aria-label="Noticias recientes"><h2 className="mb-2 text-lg font-black text-[var(--text-primary)]">Más noticias</h2><div className="grid gap-x-8 lg:grid-cols-2">{otherItems.map((entry) => <NewsCard key={entry.id} item={entry} onOpen={() => open(entry.id)} />)}</div></section>}
        </div>
          : <p className="rounded-2xl border border-[var(--border)] bg-[var(--surface-primary)] p-5 text-[var(--text-secondary)]">No hay noticias publicadas para estos filtros.</p>}
      {!loading && !error && <div className="flex items-center justify-between gap-3"><button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface-primary)] px-4 font-bold disabled:opacity-50">Anterior</button><span className="text-sm text-[var(--text-muted)]">Página {page + 1}</span><button type="button" disabled={list.nextPage === null} onClick={() => setPage(page + 1)} className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface-primary)] px-4 font-bold disabled:opacity-50">Siguiente</button></div>}
    </>}
  </section>;
}
