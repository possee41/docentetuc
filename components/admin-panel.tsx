"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- Use native navigation across the Admin/DocenteApp boundary, as in Comunidad. */

import { useCallback, useEffect, useRef, useState } from "react";
import { CommunityAdminPanel } from "@/components/community-admin-panel";
import { NewsAdminPanel } from "@/components/news-admin-panel";
import type { AdminNotice } from "@/lib/admin-notices";

type Section = "dashboard" | "users" | "publications" | "notices" | "sync" | "ai" | "community" | "news";
type SyncRow = { source: string; lastAttemptAt: string | null; lastSuccessfulSyncAt: string | null; status: string; itemCount: number; errorCode: string | null };
type Dashboard = { counts: Record<string, number>; boardCounts: Record<"acts" | "calls", { indexed: number; classified: number; current: number }>; sync: SyncRow[] };
type User = { name: string; email: string; createdAt: string | number; lastAccess: null; status: string; role: string };
type Publication = { title: string; type: string; source: string; publishedAt: string | null; url: string | null; status: string; updatedAt: string };
type AIStatus = { provider: string; model: string; available: boolean; recentRequests: number; requestWindow: string; recentErrors: string; webFallback: string };
const SECTIONS: [Section, string][] = [["dashboard", "Resumen"], ["users", "Usuarios"], ["publications", "Publicaciones"], ["notices", "Avisos"], ["sync", "Sincronizaciones"], ["ai", "IA"], ["community", "Comunidad"], ["news", "Noticias"]];
const COUNT_LABELS: Record<string, string> = { users: "Usuarios", sime: "Inscripciones SIME", acts: "Actos de designación", calls: "Llamados abiertos", communiques: "Comunicados", padrones: "Padrones", fdci: "FDCI", infod: "INFoD", cenet: "CeNET" };
const fmt = (value: string | number | null | undefined) => value == null || value === "" ? "No disponible" : new Date(value).toLocaleString("es-AR");
const localDate = (value: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "";
};
type NoticeForm = { id?: string; title: string; body: string; priority: AdminNotice["priority"]; startsAt: string; endsAt: string; url: string; active: boolean };
const emptyNotice = (): NoticeForm => ({ title: "", body: "", priority: "normal", startsAt: "", endsAt: "", url: "", active: false });

export function AdminPanel() {
  const [section, setSection] = useState<Section>("dashboard");
  const [payload, setPayload] = useState<unknown>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({ source: "", status: "", board: "", level: "", since: "", kind: "", page: 0 });
  const [form, setForm] = useState<NoticeForm>(emptyNotice);
  const [saving, setSaving] = useState(false);
  const loadId = useRef(0);

  const load = useCallback(async () => {
    if (section === "community" || section === "news") return;
    const requestId = ++loadId.current;
    setLoading(true); setError("");
    const params = new URLSearchParams({ section });
    if (section === "users") params.set("q", search);
    if (section === "publications") Object.entries(filters).forEach(([key, value]) => { if (value !== "") params.set(key, String(value)); });
    try {
      const response = await fetch(section === "notices" ? "/api/admin/notices" : `/api/admin/data?${params}`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 403 ? "Tu cuenta no tiene acceso administrativo." : "No se pudo cargar la sección.");
      const data = await response.json();
      if (requestId === loadId.current) setPayload(data);
    } catch (reason) { if (requestId === loadId.current) setError(reason instanceof Error ? reason.message : "No se pudo cargar la sección."); }
    finally { if (requestId === loadId.current) setLoading(false); }
  }, [section, search, filters]);
  useEffect(() => { queueMicrotask(() => { void load(); }); }, [load]);
  const changeSection = (next: Section) => { ++loadId.current; setPayload(null); setError(""); setSection(next); };
  const edit = (notice: AdminNotice) => {
    setForm({ id: notice.id, title: notice.title, body: notice.body, priority: notice.priority,
      startsAt: localDate(notice.startsAt), endsAt: localDate(notice.endsAt), url: notice.url || "", active: notice.active });
  };
  const save = async (next: NoticeForm) => {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/admin/notices", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...next,
          startsAt: next.startsAt ? new Date(next.startsAt).toISOString() : null,
          endsAt: next.endsAt ? new Date(next.endsAt).toISOString() : null,
          url: next.url || null }) });
      if (!response.ok) throw new Error("No se pudo guardar el aviso. Revisá los datos y las fechas.");
      setForm(emptyNotice()); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar el aviso."); }
    finally { setSaving(false); }
  };
  const dashboard = payload as Dashboard | null, users = payload as User[] | null, publications = payload as Publication[] | null;
  const notices = payload as AdminNotice[] | null, sync = payload as SyncRow[] | null, ai = payload as AIStatus | null;

  return <main className="mx-auto min-h-dvh max-w-6xl overflow-x-hidden bg-[#f4f9fe] px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))] text-[#102d55] sm:px-6">
    <a href="/?section=cuentas" className="inline-flex min-h-11 items-center text-sm font-bold text-sky-800">← Volver a Cuenta</a>
    <header className="mb-5"><p className="text-xs font-black uppercase tracking-widest text-sky-700">DocenteTuc</p><h1 className="text-3xl font-black">Administración</h1><p className="mt-1 text-sm text-slate-600">Estado operativo y herramientas de revisión.</p></header>
    <label className="mb-4 block text-sm font-bold sm:hidden">Sección administrativa<select aria-label="Sección administrativa" value={section} onChange={(event) => changeSection(event.target.value as Section)} className="mt-1 min-h-11 w-full rounded-xl border border-sky-200 bg-white px-3">{SECTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    <nav aria-label="Secciones de administración" className="mb-6 hidden max-w-full gap-2 overflow-x-auto pb-2 sm:flex">
      {SECTIONS.map(([key, label]) => <button key={key} type="button" aria-current={section === key ? "page" : undefined} onClick={() => changeSection(key)} className={`min-h-11 shrink-0 rounded-xl px-3 text-sm font-bold ${section === key ? "bg-[#0878be] text-white" : "border border-sky-200 bg-white text-[#102d55]"}`}>{label}</button>)}
    </nav>
    {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {section !== "community" && section !== "news" && loading && <p role="status" className="mb-4 text-sm">Cargando…</p>}
    {section === "dashboard" && dashboard && <div className="space-y-6"><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{Object.entries(dashboard.counts).map(([key, value]) => <div key={key} className="rounded-2xl bg-white p-4 shadow-sm"><p className="text-sm text-slate-600">{COUNT_LABELS[key] || key}{(key === "acts" || key === "calls") && " · vigentes/próximos verificados"}</p><p className="text-2xl font-black">{value}</p>{(key === "acts" || key === "calls") && dashboard.boardCounts?.[key] && <p className="mt-2 text-xs text-slate-600">Indexados: {dashboard.boardCounts[key].indexed} (incluye históricos y referencias sin retirar).<br />Individuales clasificados: {dashboard.boardCounts[key].classified} (cualquier fecha).</p>}</div>)}</div><SyncTable rows={dashboard.sync} /></div>}
    {section === "users" && <section className="space-y-4"><h2 className="text-xl font-black">Usuarios · consulta</h2><label className="block max-w-md text-sm font-bold">Buscar por nombre o email<input value={search} onChange={(event) => setSearch(event.target.value)} maxLength={120} className="mt-1 min-h-11 w-full rounded-xl border border-sky-200 bg-white px-3" /></label><div className="grid gap-3">{users?.map((user, index) => <article key={`${user.email}-${index}`} className="min-w-0 rounded-2xl bg-white p-4 shadow-sm"><p className="break-all font-bold">{user.name || "Sin nombre"} · {user.email}</p><p className="mt-1 text-sm text-slate-600">Registro: {fmt(user.createdAt)} · Último acceso: no disponible</p><p className="mt-1 text-sm">{user.status} · Rol: {user.role}</p></article>)}</div>{users?.length === 0 && <p>No se encontraron usuarios.</p>}</section>}
    {section === "publications" && <section className="space-y-4"><h2 className="text-xl font-black">Publicaciones oficiales · consulta</h2><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{(["source", "kind", "status", "board", "level", "since"] as const).map((key) => <label key={key} className="text-sm font-bold">{{ source: "Fuente / plataforma", kind: "Tipo", status: "Estado", board: "Junta", level: "Nivel", since: "Desde" }[key]}<input type={key === "since" ? "date" : "text"} value={filters[key]} onChange={(event) => setFilters((current) => ({ ...current, [key]: event.target.value, page: 0 }))} className="mt-1 min-h-11 w-full rounded-xl border border-sky-200 bg-white px-3" /></label>)}</div><div className="grid gap-3">{publications?.map((item, index) => <article key={`${item.title}-${index}`} className="min-w-0 rounded-2xl bg-white p-4 shadow-sm"><h3 className="break-words font-bold">{item.title}</h3><p className="mt-1 text-sm text-slate-600">{item.type} · {item.source} · {item.status}</p><p className="text-xs text-slate-600">Publicado: {fmt(item.publishedAt)} · Actualizado: {fmt(item.updatedAt)}</p>{item.url && <a href={item.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-10 items-center text-sm font-bold text-sky-700 underline">Fuente original ↗</a>}</article>)}</div>{publications?.length === 0 && <p>No se encontraron publicaciones.</p>}<div className="flex gap-3"><button type="button" disabled={filters.page === 0} onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))} className="min-h-11 rounded-xl border border-sky-200 bg-white px-4 disabled:opacity-50">Anterior</button><button type="button" disabled={!publications || publications.length < 50} onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))} className="min-h-11 rounded-xl border border-sky-200 bg-white px-4 disabled:opacity-50">Siguiente</button></div></section>}
    {section === "notices" && <section className="space-y-5"><h2 className="text-xl font-black">Avisos importantes de Inicio</h2><form onSubmit={(event) => { event.preventDefault(); void save(form); }} className="grid gap-3 rounded-2xl bg-white p-4 shadow-sm sm:grid-cols-2"><h3 className="sm:col-span-2 font-bold">{form.id ? "Editar aviso" : "Nuevo aviso"}</h3><label className="text-sm font-bold">Título<input required maxLength={140} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-sky-200 px-3" /></label><label className="text-sm font-bold">Prioridad<select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as NoticeForm["priority"] })} className="mt-1 min-h-11 w-full rounded-xl border border-sky-200 px-3"><option value="normal">Normal</option><option value="importante">Importante</option><option value="urgente">Urgente</option></select></label><label className="sm:col-span-2 text-sm font-bold">Texto<textarea required maxLength={2000} value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} rows={4} className="mt-1 w-full rounded-xl border border-sky-200 p-3" /></label><label className="text-sm font-bold">Inicio (opcional)<input type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-sky-200 px-3" /></label><label className="text-sm font-bold">Fin (opcional)<input type="datetime-local" value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-sky-200 px-3" /></label><label className="sm:col-span-2 text-sm font-bold">Enlace HTTPS (opcional)<input type="url" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-sky-200 px-3" /></label><label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} className="size-5" />Activo</label><div className="flex flex-wrap gap-2 sm:col-span-2"><button disabled={saving} className="min-h-11 rounded-xl bg-[#0878be] px-4 font-bold text-white disabled:opacity-50">Guardar aviso</button>{form.id && <button type="button" onClick={() => setForm(emptyNotice())} className="min-h-11 rounded-xl border border-sky-200 px-4">Cancelar edición</button>}</div></form><div className="grid gap-3">{notices?.map((notice) => <article key={notice.id} className="min-w-0 rounded-2xl bg-white p-4 shadow-sm"><h3 className="font-bold">{notice.title}</h3><p className="mt-1 whitespace-pre-wrap break-words text-sm">{notice.body}</p><p className="mt-2 text-xs text-slate-600">{notice.priority} · {notice.active ? "Activo" : "Inactivo"} · {fmt(notice.startsAt)} → {fmt(notice.endsAt)}</p><div className="mt-2 flex flex-wrap gap-2"><button onClick={() => edit(notice)} className="min-h-11 rounded-xl border border-sky-200 px-3 text-sm font-bold">Editar</button><button disabled={saving} onClick={() => void save({ id: notice.id, title: notice.title, body: notice.body, priority: notice.priority, startsAt: localDate(notice.startsAt), endsAt: localDate(notice.endsAt), url: notice.url || "", active: !notice.active })} className="min-h-11 rounded-xl border border-sky-200 px-3 text-sm font-bold">{notice.active ? "Desactivar" : "Activar"}</button></div></article>)}</div></section>}
    {section === "sync" && <SyncTable rows={sync || []} />}
    {section === "ai" && ai && <section className="space-y-3"><h2 className="text-xl font-black">IA · estado operativo</h2><div className="grid gap-3 sm:grid-cols-2">{[["Proveedor", ai.provider], ["Modelo", ai.model], ["Disponibilidad configurada", ai.available ? "Sí" : "No"], ["Consultas agregadas", `${ai.recentRequests} · ${ai.requestWindow}`], ["Búsqueda web", ai.webFallback], ["Errores recientes", ai.recentErrors]].map(([label, value]) => <div key={label} className="rounded-2xl bg-white p-4 shadow-sm"><p className="text-xs font-bold text-slate-600">{label}</p><p className="mt-1 break-words font-semibold">{value}</p></div>)}</div><p className="text-sm text-slate-600">Este panel no muestra claves, prompts ni conversaciones.</p></section>}
    {section === "community" && <CommunityAdminPanel embedded />}
    {section === "news" && <NewsAdminPanel />}
  </main>;
}

function SyncTable({ rows }: { rows: SyncRow[] }) {
  return <section className="space-y-3"><h2 className="text-xl font-black">Sincronizaciones · solo lectura</h2><p className="text-sm text-slate-600">La próxima ejecución por fuente no puede determinarse con fiabilidad desde esta tabla. El cron general se configura por separado.</p><div className="grid gap-3 sm:grid-cols-2">{rows.map((row) => <article key={row.source} className="min-w-0 rounded-2xl bg-white p-4 shadow-sm"><h3 className="font-bold">{row.source}</h3><p className="mt-1 text-sm">{row.status} · {row.itemCount} registros</p><p className="mt-1 text-xs text-slate-600">Último intento: {fmt(row.lastAttemptAt)}<br />Último éxito: {fmt(row.lastSuccessfulSyncAt)}</p>{row.errorCode && <p className="mt-1 text-xs font-semibold text-amber-800">Error: {row.errorCode}</p>}</article>)}</div></section>;
}
