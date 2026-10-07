"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { UserRound } from "lucide-react";
import { publicAvatarAssetPath, type PublicAvatarId } from "@/lib/public-profile";

type Author = { displayName: string; avatarId: PublicAvatarId };
type Report = { id: string; targetType: "post" | "comment"; targetId: string; reason: string; createdAt: string; text: string; author: Author };
type Hidden = { targetType: "post" | "comment"; targetId: string; text: string; moderatedAt: string; reason: string; author: Author };
type Overview = { reports: Report[]; hidden: Hidden[]; recent: { action: string; reason: string; createdAt: string }[] };
type Context = { post: { text: string; createdAt: string; status: string; displayName: string; avatarId: PublicAvatarId } | null;
  comments: { text: string; createdAt: string; status: string; displayName: string; avatarId: PublicAvatarId }[] };

function PublicAvatar({ author }: { author: Author }) {
  const [failed, setFailed] = useState(false);
  const src = publicAvatarAssetPath(author.avatarId, failed);
  return <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-sky-100">
    {src ? <Image src={src} alt="" width={42} height={42} onError={() => setFailed(true)} className="size-full object-cover" /> : <UserRound className="size-5 text-sky-800" aria-hidden="true" />}
  </span>;
}

export function CommunityAdminPanel() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [context, setContext] = useState<Context | null>(null);
  const [contextId, setContextId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/community", { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) throw new Error("No se pudo cargar la administración.");
    setOverview(await response.json() as Overview);
  }, []);
  useEffect(() => {
    let active = true;
    void fetch("/api/admin/community", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error("No se pudo cargar la administración.");
        return await response.json() as Overview;
      })
      .then((value) => { if (active) setOverview(value); })
      .catch(() => { if (active) setError("No se pudo cargar la administración."); });
    return () => { active = false; };
  }, []);

  const act = async (body: Record<string, string>) => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/community", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error("No se pudo completar la acción.");
      await load();
      setContext(null); setContextId(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo completar la acción."); }
    finally { setBusy(false); }
  };
  const showContext = async (reportId: string) => {
    if (contextId === reportId) { setContextId(null); setContext(null); return; }
    setError("");
    const response = await fetch(`/api/admin/community?reportId=${encodeURIComponent(reportId)}`, { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) { setError("No se pudo cargar el contexto."); return; }
    setContext(await response.json() as Context); setContextId(reportId);
  };

  return <main className="mx-auto min-h-dvh max-w-3xl space-y-6 bg-[#f4f9fe] px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[calc(1.5rem+env(safe-area-inset-top))] text-[#102d55] sm:px-6">
    <Link href="/?section=cuentas" className="inline-flex min-h-11 items-center text-sm font-bold text-sky-800">← Volver a Cuenta</Link>
    <header><p className="text-xs font-black uppercase tracking-widest text-sky-700">Administración</p><h1 className="text-3xl font-black">Moderación de Comunidad Docente</h1></header>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {!overview ? <p role="status">Cargando moderación…</p> : <>
      <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-2xl bg-white p-4 shadow-sm"><p className="text-sm">Reportes pendientes</p><p className="text-2xl font-black">{overview.reports.length}</p></div><div className="rounded-2xl bg-white p-4 shadow-sm"><p className="text-sm">Contenido oculto</p><p className="text-2xl font-black">{overview.hidden.length}</p></div></div>
      <section className="space-y-3" aria-labelledby="reports-heading"><h2 id="reports-heading" className="text-xl font-black">Reportes pendientes</h2>
        {overview.reports.length === 0 && <p className="text-sm">No hay reportes pendientes.</p>}
        {overview.reports.map((report) => <article key={report.id} className="min-w-0 rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3"><PublicAvatar author={report.author} /><div className="min-w-0"><p className="truncate font-bold">{report.author.displayName}</p><p className="text-xs text-slate-500">{report.targetType === "post" ? "Publicación" : "Comentario"} · {new Date(report.createdAt).toLocaleString("es-AR")}</p></div></div>
          <p className="mt-3 whitespace-pre-wrap break-words text-sm">{report.text}</p><p className="mt-2 text-xs font-semibold">Motivo: {report.reason}</p>
          <div className="mt-3 flex flex-wrap gap-2">{[
            ["Ver contexto", () => void showContext(report.id)],
            ["Ocultar contenido", () => void act({ targetType: report.targetType, targetId: report.targetId, action: "hide", reason: report.reason })],
            ["Resolver reporte", () => void act({ reportId: report.id, action: "resolve" })],
            ["Descartar reporte", () => void act({ reportId: report.id, action: "dismiss" })],
          ].map(([label, onClick]) => <button key={label as string} type="button" disabled={busy} onClick={onClick as () => void} className="min-h-11 rounded-xl border border-sky-200 px-3 text-sm font-bold text-sky-900 disabled:opacity-50">{label as string}</button>)}</div>
          {contextId === report.id && context && <div className="mt-3 space-y-2 rounded-xl bg-sky-50 p-3 text-sm"><p className="font-bold">Contexto</p>{context.post && <p className="whitespace-pre-wrap break-words"><b>{context.post.displayName}:</b> {context.post.text}</p>}{context.comments.map((comment, index) => <p key={index} className="whitespace-pre-wrap break-words"><b>{comment.displayName}:</b> {comment.text}</p>)}</div>}
        </article>)}
      </section>
      <section className="space-y-3" aria-labelledby="hidden-heading"><h2 id="hidden-heading" className="text-xl font-black">Contenido oculto</h2>
        {overview.hidden.length === 0 && <p className="text-sm">No hay contenido oculto.</p>}
        {overview.hidden.map((item) => <article key={`${item.targetType}-${item.targetId}`} className="min-w-0 rounded-2xl bg-white p-4 shadow-sm"><div className="flex items-center gap-3"><PublicAvatar author={item.author} /><b className="truncate">{item.author.displayName}</b></div><p className="mt-3 whitespace-pre-wrap break-words text-sm">{item.text}</p><button type="button" disabled={busy} onClick={() => void act({ targetType: item.targetType, targetId: item.targetId, action: "restore", reason: item.reason || "other" })} className="mt-3 min-h-11 rounded-xl border border-sky-200 px-3 text-sm font-bold text-sky-900">Restaurar contenido</button></article>)}
      </section>
      <section className="space-y-2" aria-labelledby="actions-heading"><h2 id="actions-heading" className="text-xl font-black">Acciones recientes</h2><div className="rounded-2xl bg-white p-4 shadow-sm">{overview.recent.length ? overview.recent.map((item, index) => <p key={index} className="border-b py-2 text-sm last:border-0">{item.action} · {new Date(item.createdAt).toLocaleString("es-AR")}</p>) : <p className="text-sm">Todavía no hay acciones.</p>}</div></section>
    </>}
  </main>;
}
