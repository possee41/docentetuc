"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { NEWS_RELEVANCE, NEWS_SOURCE_TYPES, NEWS_STATUSES, normalizeNewsImage } from "@/lib/news-editorial";

type NewsItem = { id: string; status: string; editorial_title: string; editorial_summary: string; topic: string | null;
  relevance: string; featured: number; valid_from: string | null; valid_until: string | null; updated_at: string;
  editorial_body: string | null; hero_image_url: string | null; hero_image_alt: string | null; hero_image_credit: string | null;
  hero_image_source_url: string | null; hero_image_rights_note: string | null; hero_image_rights_url: string | null;
  origin_title?: string | null; origin_removed_at?: string | null; origin_url?: string | null };
type NewsSource = { id: string; source_name: string; source_title: string; url: string; source_type: string; is_primary: number;
  publication_id: string | null; source_published_at: string | null; source_removed_at: string | null };
type NewsEvent = { action: string; actor_kind: string; previous_status: string | null; next_status: string | null;
  details: string; created_at: string; actor_name: string };
type Detail = { item: NewsItem; sources: NewsSource[]; events: NewsEvent[]; sharedSourceIds: string[] };
type Origin = { id: string; title: string; source: string; official_url: string; removed_at: string | null; existing_news_id: string | null };
type Draft = { title: string; summary: string; body: string; topic: string; relevance: string; validFrom: string; validUntil: string;
  imageUrl: string; imageAlt: string; imageCredit: string; imageSourceUrl: string; imageRightsNote: string; imageRightsUrl: string };
const localDate = (value: string | null) => value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "";
const iso = (value: string) => value ? new Date(value).toISOString() : null;
const rejectionReason = (details: string) => { try { return String((JSON.parse(details) as { reason?: string }).reason || ""); } catch { return ""; } };

async function api(params: string, body?: Record<string, unknown>) {
  const response = await fetch(`/api/admin/news${params}`, { method: body ? "POST" : "GET", credentials: "same-origin",
    cache: "no-store", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "No se pudo completar la operación.");
  return data;
}

export function NewsAdminPanel() {
  const [status, setStatus] = useState("candidate"), [query, setQuery] = useState(""), [page, setPage] = useState(0);
  const [list, setList] = useState<{ counts: Record<string, number>; items: NewsItem[] }>({ counts: {}, items: [] });
  const [detail, setDetail] = useState<Detail | null>(null), [draft, setDraft] = useState<Draft | null>(null);
  const [originQuery, setOriginQuery] = useState(""), [origins, setOrigins] = useState<Origin[]>([]);
  const [source, setSource] = useState({ sourceName: "", sourceTitle: "", url: "", sourceType: "official", isPrimary: false });
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const loadList = useCallback(async () => {
    const params = new URLSearchParams({ status, q: query, page: String(page) });
    try { setList(await api(`?${params}`) as unknown as typeof list); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo cargar la cola."); }
  }, [status, query, page]);
  useEffect(() => { queueMicrotask(() => { void loadList(); }); }, [loadList]);
  useEffect(() => {
    if (originQuery.trim().length < 2) { queueMicrotask(() => setOrigins([])); return; }
    let active = true;
    const timer = setTimeout(() => { void api(`?publicationQuery=${encodeURIComponent(originQuery)}`)
      .then((rows) => { if (active) setOrigins(rows as unknown as Origin[]); })
      .catch(() => { if (active) setOrigins([]); }); }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [originQuery]);
  const open = async (newsId: string) => {
    setError("");
    try {
      const value = await api(`?id=${encodeURIComponent(newsId)}`) as unknown as Detail;
      setDetail(value);
      setDraft({ title: value.item.editorial_title, summary: value.item.editorial_summary, topic: value.item.topic || "",
        body: value.item.editorial_body || "", relevance: value.item.relevance, validFrom: localDate(value.item.valid_from), validUntil: localDate(value.item.valid_until),
        imageUrl: value.item.hero_image_url || "", imageAlt: value.item.hero_image_alt || "", imageCredit: value.item.hero_image_credit || "",
        imageSourceUrl: value.item.hero_image_source_url || "", imageRightsNote: value.item.hero_image_rights_note || "",
        imageRightsUrl: value.item.hero_image_rights_url || "" });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo cargar la noticia."); }
  };
  const submit = async (body: Record<string, unknown>) => {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api("", body);
      if (typeof result.warning === "string") setNotice(result.warning);
      await loadList();
      await open(String(result.id));
      if (body.action === "source_add") setSource({ sourceName: "", sourceTitle: "", url: "", sourceType: "official", isPrimary: false });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar. Recargá la noticia antes de reintentar."); }
    finally { setBusy(false); }
  };
  const act = (action: string, extra: Record<string, unknown> = {}) => {
    if (!detail || busy) return;
    if (action === "approve" && detail.item.hero_image_url) {
      if (!window.confirm("¿Verificaste la procedencia, la autorización o licencia y el contenido de la imagen? Esta confirmación quedará auditada.")) return;
      extra.confirmImageRights = true;
    }
    if (["publish", "reject", "archive"].includes(action) && !window.confirm(`¿Confirmás ${action === "publish" ? "publicar" : action === "reject" ? "rechazar" : "archivar"} esta noticia?`)) return;
    if (action === "reject") {
      const reason = window.prompt("Motivo breve del rechazo (obligatorio):");
      if (!reason?.trim()) return;
      extra.reason = reason;
    }
    if (action === "publish" && detail.item.origin_removed_at) {
      if (!window.confirm("La publicación de origen fue retirada. ¿Revisaste la evidencia y confirmás publicar de todos modos?")) return;
      extra.confirmWithdrawnOrigin = true;
    }
    void submit({ action, id: detail.item.id, updatedAt: detail.item.updated_at, ...extra });
  };

  return <section className="space-y-5" aria-label="Noticias editoriales">
    <div><h2 className="text-xl font-black">Noticias · revisión editorial</h2><p className="text-sm text-slate-600">Ninguna publicación sincronizada se convierte automáticamente en noticia.</p></div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{notice}</p>}
    <div className="grid gap-3 rounded-2xl bg-white p-4 shadow-sm sm:grid-cols-2">
      <label className="text-sm font-bold">Estado<select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} className="mt-1 min-h-11 w-full rounded-xl border border-sky-200 px-3">
        {NEWS_STATUSES.map((value) => <option key={value} value={value}>{value} · {list.counts[value] || 0}</option>)}<option value="all">Todos</option>
      </select></label>
      <label className="text-sm font-bold">Buscar noticia<input value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} maxLength={100} className="mt-1 min-h-11 w-full rounded-xl border border-sky-200 px-3" /></label>
    </div>
    <div className="grid gap-3 lg:grid-cols-2">{list.items.map((item) => <button key={item.id} type="button" onClick={() => void open(item.id)}
      className="min-h-16 rounded-2xl bg-white p-4 text-left shadow-sm"><strong className="block break-words">{item.editorial_title || item.origin_title || "Sin título"}</strong>
      <span className="text-xs text-slate-600">{item.status} · {item.relevance}{item.featured ? " · Destacada" : ""}</span></button>)}</div>
    {list.items.length === 0 && <p className="text-sm text-slate-600">No hay noticias para este filtro.</p>}
    <div className="flex gap-2"><button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className="min-h-11 rounded-xl border border-sky-200 bg-white px-4 disabled:opacity-50">Anterior</button>
      <button type="button" disabled={list.items.length < 30} onClick={() => setPage(page + 1)} className="min-h-11 rounded-xl border border-sky-200 bg-white px-4 disabled:opacity-50">Siguiente</button></div>

    <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm" aria-label="Crear candidata"><h3 className="font-bold">Crear candidata desde publicación</h3>
      <label className="block text-sm">Buscar publicación existente<input value={originQuery} onChange={(e) => setOriginQuery(e.target.value)} maxLength={100} className="mt-1 min-h-11 w-full rounded-xl border border-sky-200 px-3" /></label>
      {origins.map((origin) => <div key={origin.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-sky-100 pt-2 text-sm">
        <span className="min-w-0 break-words"><strong>{origin.title}</strong> · {origin.source}{origin.removed_at && " · retirada"}</span>
        <button type="button" disabled={busy || Boolean(origin.existing_news_id)} onClick={() => void submit({ action: "create_candidate", publicationId: origin.id })}
          className="min-h-11 rounded-xl border border-sky-200 px-3 font-bold disabled:opacity-50">{origin.existing_news_id ? "Ya es candidata" : "Crear candidata"}</button>
      </div>)}
    </section>

    {detail && draft && <section className="space-y-5 rounded-2xl bg-white p-4 shadow-sm" aria-label="Ficha editorial">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-lg font-black">Ficha editorial · {detail.item.status}</h3>
        <p className="text-xs text-slate-600">Actualizada: {new Date(detail.item.updated_at).toLocaleString("es-AR")}</p></div>
        <button type="button" onClick={() => void open(detail.item.id)} className="min-h-11 rounded-xl border border-sky-200 px-3">Recargar noticia</button></div>
      {detail.item.origin_removed_at && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">La publicación de origen fue retirada. Revisá la evidencia antes de publicar.</p>}
      {detail.item.origin_url?.startsWith("https://") && <a href={detail.item.origin_url} target="_blank" rel="noreferrer" className="text-sm font-bold text-sky-700 underline">Ver publicación de origen ↗</a>}
      {detail.item.hero_image_url && <div className="space-y-1 rounded-xl border border-sky-200 p-3 text-sm"><p className="font-bold">Procedencia y derechos de la imagen</p>
        <p>{detail.item.hero_image_credit} · {detail.item.hero_image_rights_note}</p>
        {detail.item.hero_image_source_url && <a href={detail.item.hero_image_source_url} target="_blank" rel="noopener noreferrer" className="mr-4 font-bold text-sky-700 underline">Ver procedencia ↗</a>}
        {detail.item.hero_image_rights_url && <a href={detail.item.hero_image_rights_url} target="_blank" rel="noopener noreferrer" className="font-bold text-sky-700 underline">Ver constancia de derechos ↗</a>}
      </div>}
      {detail.item.status === "published" && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Para corregir contenido o imagen de una noticia publicada, archivala y reabrila como candidata. Deberá aprobarse nuevamente antes de publicarse.</p>}
      <form onSubmit={(e) => { e.preventDefault(); try { act("edit", { title: draft.title, summary: draft.summary, topic: draft.topic,
        body: draft.body, relevance: draft.relevance, validFrom: iso(draft.validFrom), validUntil: iso(draft.validUntil),
        imageUrl: draft.imageUrl, imageAlt: draft.imageAlt, imageCredit: draft.imageCredit,
        imageSourceUrl: draft.imageSourceUrl, imageRightsNote: draft.imageRightsNote, imageRightsUrl: draft.imageRightsUrl }); } catch { setError("Revisá las fechas ingresadas."); } }}
        className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-bold">Título editorial<input value={draft.title} maxLength={160} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-sky-200 px-3" /></label>
        <label className="text-sm font-bold">Tema<input value={draft.topic} maxLength={80} onChange={(e) => setDraft({ ...draft, topic: e.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-sky-200 px-3" /></label>
        <label className="text-sm font-bold sm:col-span-2">Resumen editorial<textarea value={draft.summary} maxLength={1200} rows={4} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} className="mt-1 w-full rounded-xl border border-sky-200 p-3" /></label>
        <label className="text-sm font-bold sm:col-span-2">Contenido editorial original<textarea value={draft.body} maxLength={20000} rows={10} onChange={(e) => setDraft({ ...draft, body: e.target.value })} className="mt-1 w-full rounded-xl border border-sky-200 p-3" /><span className="block text-xs font-normal text-slate-600">Solo texto propio o autorizado; no pegues artículos completos de terceros.</span></label>
        <fieldset className="grid gap-3 rounded-xl border border-sky-200 p-3 sm:col-span-2 sm:grid-cols-2"><legend className="px-1 text-sm font-bold">Imagen destacada · opcional</legend>
          <p className="text-xs text-slate-600 sm:col-span-2">Para mostrarla al público completá todos los datos de procedencia y derechos. No se descarga ni aloja desde aquí.</p>
          <label className="text-sm">URL HTTPS de imagen<input type="url" maxLength={2048} value={draft.imageUrl} onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })} className="mt-1 min-h-11 w-full rounded-xl border px-3" /></label>
          <label className="text-sm">Texto alternativo<input maxLength={240} value={draft.imageAlt} onChange={(e) => setDraft({ ...draft, imageAlt: e.target.value })} className="mt-1 min-h-11 w-full rounded-xl border px-3" /></label>
          <label className="text-sm">Crédito o autor<input maxLength={160} value={draft.imageCredit} onChange={(e) => setDraft({ ...draft, imageCredit: e.target.value })} className="mt-1 min-h-11 w-full rounded-xl border px-3" /></label>
          <label className="text-sm">URL HTTPS de procedencia<input type="url" maxLength={2048} value={draft.imageSourceUrl} onChange={(e) => setDraft({ ...draft, imageSourceUrl: e.target.value })} className="mt-1 min-h-11 w-full rounded-xl border px-3" /></label>
          <label className="text-sm">Autorización o licencia<textarea maxLength={500} rows={2} value={draft.imageRightsNote} onChange={(e) => setDraft({ ...draft, imageRightsNote: e.target.value })} className="mt-1 w-full rounded-xl border p-3" /></label>
          <label className="text-sm">URL HTTPS de constancia de derechos<input type="url" maxLength={2048} value={draft.imageRightsUrl} onChange={(e) => setDraft({ ...draft, imageRightsUrl: e.target.value })} className="mt-1 min-h-11 w-full rounded-xl border px-3" /></label>
          <button type="button" disabled={busy || detail.item.status === "published"} onClick={() => setDraft({ ...draft, imageUrl: "", imageAlt: "", imageCredit: "", imageSourceUrl: "", imageRightsNote: "", imageRightsUrl: "" })} className="min-h-11 rounded-xl border border-sky-200 px-3 text-sm font-bold disabled:opacity-50 sm:col-span-2">Retirar imagen del borrador</button>
        </fieldset>
        <label className="text-sm font-bold">Relevancia<select value={draft.relevance} onChange={(e) => setDraft({ ...draft, relevance: e.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-sky-200 px-3">
          {NEWS_RELEVANCE.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="text-sm font-bold">Visible desde<input type="datetime-local" value={draft.validFrom} onChange={(e) => setDraft({ ...draft, validFrom: e.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-sky-200 px-3" /></label>
        <label className="text-sm font-bold">Caduca<input type="datetime-local" value={draft.validUntil} onChange={(e) => setDraft({ ...draft, validUntil: e.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-sky-200 px-3" /></label>
        <button disabled={busy || !["candidate", "approved"].includes(detail.item.status)} className="min-h-11 rounded-xl bg-[#0878be] px-4 font-bold text-white disabled:opacity-50">Guardar edición</button>
      </form>
      <details className="border-t border-sky-100 pt-4"><summary className="cursor-pointer font-bold">Previsualizar noticia sin publicar</summary>
        <article className="mt-4 max-w-2xl overflow-hidden rounded-xl border border-sky-200">
          {normalizeNewsImage(draft)?.url && <figure><Image src={normalizeNewsImage(draft)!.url} alt={draft.imageAlt} width={1200} height={675} unoptimized referrerPolicy="no-referrer" className="aspect-video w-full object-cover" /><figcaption className="px-4 pt-2 text-xs text-slate-600">Imagen: {draft.imageCredit}</figcaption></figure>}
          <div className="space-y-3 p-4"><p className="text-xs font-bold uppercase text-sky-700">{draft.topic || "Actualidad docente"} · Vista previa</p>
            <h4 className="text-2xl font-black">{draft.title || "Sin título"}</h4><p className="line-clamp-4 text-sm">{draft.summary || "Sin síntesis"}</p>
            {draft.body && <p className="whitespace-pre-wrap text-sm leading-relaxed">{draft.body}</p>}</div>
        </article>
      </details>
      <div className="flex flex-wrap gap-2 border-t border-sky-100 pt-4">{([
        ["approve", "Aprobar", detail.item.status === "candidate"], ["publish", "Publicar", detail.item.status === "approved"],
        ["reject", "Rechazar", ["candidate", "approved"].includes(detail.item.status)],
        ["archive", "Archivar", ["approved", "published"].includes(detail.item.status)],
        ["reopen", "Reabrir como candidata", ["rejected", "archived"].includes(detail.item.status)],
        [detail.item.featured ? "unfeature" : "feature", detail.item.featured ? "Quitar destaque" : "Destacar", detail.item.status === "published"],
      ] as const).filter(([, , shown]) => shown).map(([action, label]) => <button key={action} type="button" disabled={busy} onClick={() => act(action)}
        className="min-h-11 rounded-xl border border-sky-300 px-3 text-sm font-bold disabled:opacity-50">{label}</button>)}</div>
      <section className="space-y-3 border-t border-sky-100 pt-4"><h4 className="font-bold">Evidencia y fuentes</h4>
        {detail.sources.map((entry) => <div key={entry.id} className="rounded-xl border border-sky-100 p-3 text-sm"><a href={entry.url} target="_blank" rel="noreferrer" className="break-all font-bold text-sky-700 underline">{entry.source_title} ↗</a>
          <p>{entry.source_name} · {entry.source_type}{entry.is_primary ? " · principal" : ""}{entry.source_published_at ? ` · ${entry.source_published_at}` : ""}</p>
          {entry.source_removed_at && <p className="text-amber-800">Esta publicación de apoyo fue retirada; revisá o reemplazá la fuente antes de publicar.</p>}
          {detail.sharedSourceIds.includes(entry.id) && <p className="text-amber-800">Esta URL también aparece en otra noticia: revisá posibles duplicados.</p>}
          <button type="button" disabled={busy || !["candidate", "approved", "published"].includes(detail.item.status) || Boolean(detail.item.status === "published" && entry.is_primary)} onClick={() => act("source_remove", { sourceId: entry.id })}
            className="mt-2 min-h-11 rounded-xl border border-sky-200 px-3 disabled:opacity-50">Quitar fuente</button></div>)}
        <form onSubmit={(e) => { e.preventDefault(); act("source_add", source); }} className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Nombre de fuente<input required maxLength={120} value={source.sourceName} onChange={(e) => setSource({ ...source, sourceName: e.target.value })} className="mt-1 min-h-11 w-full rounded-xl border px-3" /></label>
          <label className="text-sm">Título de fuente<input required maxLength={160} value={source.sourceTitle} onChange={(e) => setSource({ ...source, sourceTitle: e.target.value })} className="mt-1 min-h-11 w-full rounded-xl border px-3" /></label>
          <label className="text-sm sm:col-span-2">URL HTTPS<input required type="url" value={source.url} onChange={(e) => setSource({ ...source, url: e.target.value })} className="mt-1 min-h-11 w-full rounded-xl border px-3" /></label>
          <label className="text-sm">Tipo<select value={source.sourceType} onChange={(e) => setSource({ ...source, sourceType: e.target.value })} className="mt-1 min-h-11 w-full rounded-xl border px-3">
            {NEWS_SOURCE_TYPES.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={source.isPrimary} onChange={(e) => setSource({ ...source, isPrimary: e.target.checked })} className="size-5" />Fuente principal</label>
          <button disabled={busy || !["candidate", "approved", "published"].includes(detail.item.status)} className="min-h-11 rounded-xl border border-sky-300 px-4 font-bold disabled:opacity-50">Agregar fuente</button>
        </form>
      </section>
      <section className="border-t border-sky-100 pt-4"><h4 className="font-bold">Historial editorial</h4><ol className="mt-2 space-y-2 text-sm">{detail.events.map((entry, index) => <li key={`${entry.created_at}-${index}`} className="rounded-xl bg-sky-50 p-3">
        <strong>{entry.action}</strong> · {entry.actor_kind === "system" ? "Sistema" : entry.actor_name} · {new Date(entry.created_at).toLocaleString("es-AR")}
        {entry.previous_status !== entry.next_status && <span> · {entry.previous_status || "nuevo"} → {entry.next_status}</span>}
        {entry.action === "reject" && <span> · {rejectionReason(entry.details)}</span>}
      </li>)}</ol></section>
    </section>}
  </section>;
}
