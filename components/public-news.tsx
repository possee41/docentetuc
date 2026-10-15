"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, RefreshCw } from "lucide-react";
import { sectionUrl } from "@/lib/app-navigation";
import type { PublicNewsItem, PublicNewsSource } from "@/lib/public-news";

type NewsPage = { items: PublicNewsItem[]; nextPage: number | null; topics: string[] };
type NewsDetail = PublicNewsItem & { sources: PublicNewsSource[] };
const sourceLabels: Record<PublicNewsSource["type"], string> = {
  official: "Fuente oficial", public: "Fuente pública", union: "Fuente gremial", media: "Fuente periodística",
};
const date = (value: string) => new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Tucuman", day: "numeric", month: "long", year: "numeric" }).format(new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00-03:00` : value));
const dateTime = (value: string) => new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Tucuman", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
const initialParams = () => typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(location.search);
const pageFromParams = (params: URLSearchParams) => Math.min(100, Math.max(0, Number.parseInt(params.get("page") || "0", 10) || 0));

async function getNews<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error || "No pudimos cargar las noticias.");
  return result;
}

function NewsCard({ item, onOpen, href }: { item: PublicNewsItem; onOpen?: () => void; href?: string }) {
  return <article className="min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--surface-primary)] p-4 shadow-sm sm:p-5">
    <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
      <span className={`rounded-full px-2.5 py-1 ${item.relevance === "urgente" ? "bg-red-100 text-red-900" : item.relevance === "importante" ? "bg-amber-100 text-amber-900" : "bg-sky-100 text-sky-900"}`}>{item.relevance === "urgente" ? "Urgente" : item.relevance === "importante" ? "Importante" : "Informativa"}</span>
      {item.featured && <span className="text-[var(--accent-text)]">Destacada</span>}
      <span className="text-[var(--text-muted)]">{date(item.publishedAt)}</span>
      {item.validUntil && <span className="text-[var(--text-muted)]">Vigente hasta {dateTime(item.validUntil)}</span>}
    </div>
    <h3 className="mt-3 break-words text-lg font-black text-[var(--text-primary)]">{href ? <a href={href} className="hover:underline">{item.title}</a> : <button type="button" onClick={onOpen} className="text-left hover:underline">{item.title}</button>}</h3>
    <p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words text-sm text-[var(--text-secondary)]">{item.summary}</p>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
      <span>{item.topic || "Actualidad docente"} · {sourceLabels[item.primarySource.type]} · {item.primarySource.name}</span>
      {href ? <a href={href} className="inline-flex min-h-10 items-center gap-1 font-bold text-[var(--accent-text)]">Leer noticia <ArrowRight className="size-4" /></a> : <button type="button" onClick={onOpen} className="inline-flex min-h-10 items-center gap-1 font-bold text-[var(--accent-text)]">Leer noticia <ArrowRight className="size-4" /></button>}
    </div>
  </article>;
}

export function PublicNewsSection() {
  const [detailId, setDetailId] = useState(() => initialParams().get("news"));
  const [query, setQuery] = useState(() => initialParams().get("q") || "");
  const [topic, setTopic] = useState(() => initialParams().get("topic") || "");
  const [relevance, setRelevance] = useState(() => initialParams().get("relevance") || "");
  const [page, setPage] = useState(() => pageFromParams(initialParams()));
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [list, setList] = useState<NewsPage>({ items: [], nextPage: null, topics: [] });
  const [detail, setDetail] = useState<NewsDetail | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [retry, setRetry] = useState(0);

  useEffect(() => {
    const onPop = () => { const params = new URLSearchParams(location.search);
      setDetailId(params.get("news")); setQuery(params.get("q") || ""); setTopic(params.get("topic") || "");
      setRelevance(params.get("relevance") || ""); setPage(pageFromParams(params)); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => { const timer = setTimeout(() => setDebouncedQuery(query), 250); return () => clearTimeout(timer); }, [query]);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    for (const [key, value] of [["q", debouncedQuery], ["topic", topic], ["relevance", relevance], ["page", page ? String(page) : ""]]) {
      if (value) params.set(key, value); else params.delete(key);
    }
    history.replaceState(history.state, "", `${location.pathname}?${params}`);
  }, [debouncedQuery, topic, relevance, page]);
  useEffect(() => {
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
  }, [detailId, debouncedQuery, topic, relevance, page, retry]);

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

  return <section className="mx-auto max-w-5xl space-y-5" aria-label="Noticias">
    {detailId ? <>
      <button type="button" onClick={back} className="inline-flex min-h-11 items-center gap-2 font-bold text-[var(--accent-text)]"><ArrowLeft className="size-4" />Volver a Noticias</button>
      {loading ? <p role="status">Cargando noticia…</p> : error ? <div role="alert"><p>{error}</p><button onClick={() => setRetry((value) => value + 1)} className="mt-2 inline-flex min-h-11 items-center gap-2 font-bold"><RefreshCw className="size-4" />Reintentar</button></div>
        : detail && <article className="min-w-0 rounded-3xl border border-[var(--border)] bg-[var(--surface-primary)] p-5 shadow-sm sm:p-8">
          <p className="text-sm font-bold text-[var(--accent-text)]">{detail.relevance === "urgente" ? "Urgente" : detail.relevance === "importante" ? "Importante" : "Noticia"}{detail.topic ? ` · ${detail.topic}` : ""}</p>
          <h1 className="mt-2 break-words text-2xl font-black text-[var(--text-primary)] sm:text-3xl">{detail.title}</h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">Publicada el {date(detail.publishedAt)}{detail.validUntil ? ` · Vigente hasta el ${dateTime(detail.validUntil)}` : ""}</p>
          <p className="mt-5 whitespace-pre-wrap break-words leading-relaxed text-[var(--text-primary)]">{detail.summary}</p>
          <h2 className="mt-7 font-black text-[var(--text-primary)]">Fuentes y referencias</h2>
          <ul className="mt-2 space-y-2">{detail.sources.map((entry) => <li key={entry.url} className="rounded-xl border border-[var(--border)] p-3 text-sm">
            <span className="block font-bold text-[var(--text-primary)]">{sourceLabels[entry.type]} · {entry.name}</span>
            <span className="block text-[var(--text-secondary)]">{entry.title}{entry.publishedAt ? ` · ${date(entry.publishedAt)}` : ""}{entry.withdrawn ? " · Fuente retirada" : ""}</span>
            <a href={entry.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-10 items-center gap-1 break-all font-bold text-[var(--accent-text)]">Abrir fuente original <ExternalLink className="size-4 shrink-0" /></a>
          </li>)}</ul>
          <p className="mt-6 border-t border-[var(--border)] pt-4 text-xs text-[var(--text-muted)]">DocenteTuc es independiente de los organismos y organizaciones citados. Consultá siempre la fuente original.</p>
        </article>}
    </> : <>
      <div><p className="text-sm font-black uppercase tracking-widest text-[var(--accent-text)]">Actualidad docente</p><h1 className="mt-1 text-2xl font-black text-[var(--text-primary)]">Noticias</h1><p className="mt-1 text-sm text-[var(--text-secondary)]">Novedades revisadas por el equipo editorial de DocenteTuc.</p></div>
      <div className="grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-primary)] p-4 sm:grid-cols-3">
        <label className="text-sm font-bold text-[var(--text-primary)]">Buscar noticia<input value={query} maxLength={100} onChange={(event) => filter("q", event.target.value)} placeholder="Título o resumen" className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface-primary)] px-3 text-[var(--text-primary)]" /></label>
        <label className="text-sm font-bold text-[var(--text-primary)]">Tema<select value={topic} onChange={(event) => filter("topic", event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-primary)] px-3"><option value="">Todos</option>{list.topics.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="text-sm font-bold text-[var(--text-primary)]">Importancia<select value={relevance} onChange={(event) => filter("relevance", event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-primary)] px-3"><option value="">Todas</option><option value="urgente">Urgente</option><option value="importante">Importante</option><option value="informativa">Informativa</option></select></label>
      </div>
      {loading ? <p role="status" className="text-[var(--text-secondary)]">Cargando noticias…</p> : error ? <div role="alert"><p>{error}</p><button onClick={() => setRetry((value) => value + 1)} className="mt-2 inline-flex min-h-11 items-center gap-2 font-bold"><RefreshCw className="size-4" />Reintentar</button></div>
        : list.items.length ? <div className="space-y-5">
          {page === 0 && list.items.some((entry) => entry.featured) && <section aria-label="Noticias destacadas"><h2 className="mb-3 text-lg font-black text-[var(--text-primary)]">Destacadas</h2><div className="grid gap-4 lg:grid-cols-2">{list.items.filter((entry) => entry.featured).map((entry) => <NewsCard key={entry.id} item={entry} onOpen={() => open(entry.id)} />)}</div></section>}
          {list.items.some((entry) => page > 0 || !entry.featured) && <section aria-label="Noticias recientes"><h2 className="mb-3 text-lg font-black text-[var(--text-primary)]">Noticias recientes</h2><div className="grid gap-4 lg:grid-cols-2">{list.items.filter((entry) => page > 0 || !entry.featured).map((entry) => <NewsCard key={entry.id} item={entry} onOpen={() => open(entry.id)} />)}</div></section>}
        </div>
          : <p className="rounded-2xl border border-[var(--border)] bg-[var(--surface-primary)] p-5 text-[var(--text-secondary)]">No hay noticias publicadas para estos filtros.</p>}
      {!loading && !error && <div className="flex items-center justify-between gap-3"><button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface-primary)] px-4 font-bold disabled:opacity-50">Anterior</button><span className="text-sm text-[var(--text-muted)]">Página {page + 1}</span><button type="button" disabled={list.nextPage === null} onClick={() => setPage(page + 1)} className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface-primary)] px-4 font-bold disabled:opacity-50">Siguiente</button></div>}
    </>}
  </section>;
}

export function HomeNews({ excludedOriginIds }: { excludedOriginIds: string[] }) {
  const [items, setItems] = useState<PublicNewsItem[]>([]);
  const excluded = excludedOriginIds.join(",");
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void getNews<{ items: PublicNewsItem[] }>(`/api/news?home=1&exclude=${encodeURIComponent(excluded)}`, controller.signal)
      .then((result) => { if (active) setItems(result.items); }).catch(() => { if (active) setItems([]); });
    return () => { active = false; controller.abort(); };
  }, [excluded]);
  if (!items.length) return null;
  const urgent = items.find((entry) => entry.relevance === "urgente");
  const otherItems = items.filter((entry) => entry.id !== urgent?.id);
  return <section className="home-section space-y-3" aria-label="Noticias destacadas">
    <div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-xs font-black uppercase tracking-widest text-[var(--accent-text)]">NOTICIAS</p><h2 className="text-xl font-black text-[var(--text-primary)]">Actualidad docente</h2></div><a href={sectionUrl("noticias")} className="inline-flex min-h-10 items-center gap-1 text-sm font-bold text-[var(--accent-text)]">Ver todas las noticias <ArrowRight className="size-4" /></a></div>
    {urgent && <NewsCard item={urgent} href={`${sectionUrl("noticias")}&news=${encodeURIComponent(urgent.id)}`} />}
    <div className="grid gap-3 lg:grid-cols-2">{otherItems.map((entry) => <NewsCard key={entry.id} item={entry} href={`${sectionUrl("noticias")}&news=${encodeURIComponent(entry.id)}`} />)}</div>
  </section>;
}
