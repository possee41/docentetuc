"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { UserRound } from "lucide-react";
import { publicAvatarAssetPath, type PublicAvatarId } from "@/lib/public-profile";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

type Author = { displayName: string; avatarId: PublicAvatarId };
type Report = { id: string; targetType: "post" | "comment"; targetId: string; reason: string; createdAt: string; text: string; author: Author };
type Hidden = { targetType: "post" | "comment"; targetId: string; text: string; moderatedAt: string; reason: string; author: Author };
type Overview = { reports: Report[]; hidden: Hidden[]; recent: { action: string; reason: string; createdAt: string }[] };
type Pending = { targetType: "post" | "comment"; targetId: string; text: string; categories: string[];
  confidence: number; reason: string; createdAt: string; author: Author; context: { postText: string } | null };
type ReviewData = { items: Pending[]; total: number; pendingTotal: number; page: number; pageSize: number; totalPages: number;
  history: { targetType: string; action: string; reason: string; createdAt: string; reviewer: string }[] };
type Context = { post: { text: string; createdAt: string; status: string; displayName: string; avatarId: PublicAvatarId } | null;
  comments: { text: string; createdAt: string; status: string; displayName: string; avatarId: PublicAvatarId }[] };

function PublicAvatar({ author }: { author: Author }) {
  const [failed, setFailed] = useState(false);
  const src = publicAvatarAssetPath(author.avatarId, failed);
  return <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-sky-100">
    {src ? <Image src={src} alt="" width={42} height={42} onError={() => setFailed(true)} className="size-full object-cover" /> : <UserRound className="size-5 text-sky-800" aria-hidden="true" />}
  </span>;
}

export function CommunityAdminPanel({ embedded = false }: { embedded?: boolean }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [context, setContext] = useState<Context | null>(null);
  const [contextId, setContextId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<ReviewData | null>(null);
  const [type, setType] = useState("all");
  const [priority, setPriority] = useState("all");
  const [order, setOrder] = useState("oldest");
  const [page, setPage] = useState(1);
  const [blockTarget, setBlockTarget] = useState<Pending | null>(null);
  const queueUrl = `/api/admin/community/pre-moderation?${new URLSearchParams({ type, priority, order, page: String(page) })}`;

  const load = useCallback(async () => {
    const [response, pre] = await Promise.all([
      fetch("/api/admin/community", { cache: "no-store", credentials: "same-origin" }),
      fetch(queueUrl, { cache: "no-store", credentials: "same-origin" }),
    ]);
    if (!response.ok || !pre.ok) throw new Error("No se pudo cargar la administración.");
    setOverview(await response.json() as Overview); setReview(await pre.json() as ReviewData);
  }, [queueUrl]);
  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch("/api/admin/community", { cache: "no-store", credentials: "same-origin" }),
      fetch(queueUrl, { cache: "no-store", credentials: "same-origin" }),
    ]).then(async ([response, pre]) => {
      if (!response.ok || !pre.ok) throw new Error("No se pudo cargar la administración.");
      return [await response.json() as Overview, await pre.json() as ReviewData] as const;
    })
      .then(([value, queue]) => { if (active) { setOverview(value); setReview(queue); } })
      .catch(() => { if (active) setError("No se pudo cargar la administración."); });
    return () => { active = false; };
  }, [queueUrl]);

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
  const reviewAction = async (item: Pending, action: "approve" | "reject" | "block") => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/community/pre-moderation", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: item.targetType, targetId: item.targetId, action }) });
      if (!response.ok) throw new Error("No se pudo completar la revisión.");
      await load();
      setBlockTarget(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo completar la revisión."); }
    finally { setBusy(false); }
  };

  return <div className={embedded ? "space-y-6" : "mx-auto min-h-dvh max-w-3xl space-y-6 bg-[#f4f9fe] px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[calc(1.5rem+env(safe-area-inset-top))] text-[#102d55] sm:px-6"}>
    {!embedded && <Link href="/?section=cuentas" className="inline-flex min-h-11 items-center text-sm font-bold text-sky-800">← Volver a Cuenta</Link>}
    <header><h2 className="text-2xl font-black">Moderación de Comunidad Docente</h2></header>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {!overview ? <p role="status">Cargando moderación…</p> : <>
      <section className="space-y-3" aria-labelledby="pre-moderation-heading"><h2 id="pre-moderation-heading" className="text-xl font-black">Moderación pendiente</h2>
        {!review && <p role="status">Cargando revisiones…</p>}
        {review && <p className="rounded-2xl bg-white p-4 text-sm shadow-sm">Pendientes de moderación: <strong className="text-lg">{review.pendingTotal}</strong>{type !== "all" || priority !== "all" ? ` · Coincidencias: ${review.total}` : ""}</p>}
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="grid gap-1 text-sm font-semibold">Contenido<select aria-label="Filtrar por contenido" value={type} onChange={(event) => { setType(event.target.value); setPage(1); }} className="min-h-11 rounded-xl border bg-white px-3"><option value="all">Todos</option><option value="post">Publicaciones</option><option value="comment">Comentarios</option></select></label>
          <label className="grid gap-1 text-sm font-semibold">Prioridad<select aria-label="Filtrar por prioridad" value={priority} onChange={(event) => { setPriority(event.target.value); setPage(1); }} className="min-h-11 rounded-xl border bg-white px-3"><option value="all">Todas las prioridades</option><option value="high">Alta prioridad</option></select></label>
          <label className="grid gap-1 text-sm font-semibold">Orden<select aria-label="Ordenar pendientes" value={order} onChange={(event) => { setOrder(event.target.value); setPage(1); }} className="min-h-11 rounded-xl border bg-white px-3"><option value="oldest">Más antiguos</option><option value="newest">Más recientes</option></select></label>
        </div>
        {review?.items.length === 0 && <p className="text-sm">No hay contenido pendiente con estos filtros.</p>}
        {review?.items.map((item) => <article key={`${item.targetType}-${item.targetId}`} className="min-w-0 space-y-3 rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex min-w-0 items-center gap-3"><PublicAvatar author={item.author} /><div className="min-w-0"><p className="truncate font-bold">{item.author.displayName}</p><p className="text-xs text-slate-600">{item.targetType === "post" ? "Publicación" : "Comentario"} · {new Date(item.createdAt).toLocaleString("es-AR")} · pendiente</p></div></div>
          {item.context && <p className="break-words rounded-xl bg-sky-50 p-3 text-xs">Contexto de publicación: {item.context.postText}</p>}
          <p className="whitespace-pre-wrap break-words text-sm">{item.text}</p>
          <p className="break-words text-xs text-slate-600">Categorías: {item.categories.join(", ") || "sin categoría"} · confianza: {Math.round(item.confidence * 100)} %</p>
          <p className="break-words text-xs text-slate-600">Señal detectada: {item.categories.filter((category) => category !== "uncertain").join(", ") || "No informada"}. Motivo: {item.reason || "No informado"}</p>
          <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void reviewAction(item, "approve")} className="min-h-11 rounded-xl border border-sky-200 px-3 text-sm font-bold">Aprobar / descartar alerta</button><button type="button" disabled={busy} onClick={() => void reviewAction(item, "reject")} className="min-h-11 rounded-xl border border-rose-200 px-3 text-sm font-bold text-rose-800">Rechazar</button><button type="button" disabled={busy} onClick={() => setBlockTarget(item)} className="min-h-11 rounded-xl border border-rose-200 px-3 text-sm font-bold text-rose-800">Bloquear usuario</button></div>
        </article>)}
        {review && <nav aria-label="Páginas de moderación" className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white p-3 text-sm shadow-sm"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="min-h-11 rounded-xl border px-3 disabled:opacity-50">Anterior</button><span>Página {review.page} de {review.totalPages} · {review.pageSize} por página</span><button type="button" disabled={review.page >= review.totalPages} onClick={() => setPage(review.page + 1)} className="min-h-11 rounded-xl border px-3 disabled:opacity-50">Siguiente</button></nav>}
      </section>
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
      <section className="space-y-2" aria-labelledby="pre-history-heading"><h2 id="pre-history-heading" className="text-xl font-black">Historial de revisión preventiva</h2><div className="rounded-2xl bg-white p-4 shadow-sm">{review?.history.length ? review.history.map((item, index) => <p key={index} className="break-words border-b py-2 text-sm last:border-0">{item.targetType} · {item.action} · {item.reviewer} · {new Date(item.createdAt).toLocaleString("es-AR")}</p>) : <p className="text-sm">Todavía no hay decisiones.</p>}</div></section>
    </>}
    <AlertDialog open={blockTarget !== null} onOpenChange={(open) => { if (!open) setBlockTarget(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>¿Restringir participación?</AlertDialogTitle><AlertDialogDescription>Esta cuenta no podrá publicar ni comentar en Comunidad. La acción quedará registrada para auditoría.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={() => { if (blockTarget) void reviewAction(blockTarget, "block"); }}>Restringir cuenta</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}
