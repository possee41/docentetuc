"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- vinext Link currently throws during client navigation from Comunidad. */

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { ArrowUpRight, Bookmark, BookmarkCheck, BookOpen, Check, ChevronDown, CircleUserRound, Clock3, Flag, Home, MessageCircle, MessagesSquare, MoreHorizontal, Send, ShieldCheck, UserRound, UsersRound, X } from "lucide-react";
import { COMMUNITY_REPORT_REASONS, type CommunityComment, type CommunityFeedSort, type CommunityPost } from "@/lib/community";
import { publicAvatarAssetPath, type PublicAvatarId, type PublicProfile } from "@/lib/public-profile";
import { AppSidebar, AppSidebarEdge, AppSidebarTrigger, useAppSidebarState } from "@/components/app-sidebar";
import { CommunityRulesCard } from "@/components/community-rules-card";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

type CommunityStatus = {
  authenticated: boolean;
  profileConfigured: boolean;
  publicProfile: PublicProfile | null;
  rulesVersion: string;
  acceptedRulesVersion: string | null;
  rulesText: string;
};
type CommunityResponse = { status: CommunityStatus; posts: CommunityPost[]; nextCursor: string | null; hasMore: boolean };
type Block = { id: string; profile: { displayName: string; avatarId: PublicAvatarId; bio: string } };
type OwnReview = { type: "post" | "comment"; decision: "pending_review" | "rejected"; text: string; createdAt: string };
type Reason = typeof COMMUNITY_REPORT_REASONS[number];

const reasonLabels: Record<Reason, string> = {
  off_topic: "No relacionado con docencia",
  harassment: "Agresión u hostigamiento",
  discrimination: "Discriminación",
  personal_data: "Datos personales o sensibles",
  spam: "Spam o publicidad engañosa",
  illegal: "Actividad ilegal",
  other: "Otro incumplimiento",
};

async function readResponse<T>(response: Response): Promise<T> {
  const result = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(result.error || "No se pudo completar la acción.");
  return result as T;
}
const loadingError = (reason: unknown, fallback: string) => reason instanceof DOMException && reason.name === "TimeoutError" ? "La consulta tardó demasiado. Intentá nuevamente." : reason instanceof Error ? reason.message : fallback;

function jsonRequest(body: unknown, method = "POST") {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function relativeDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Fecha no disponible";
  const minutes = Math.round((date.getTime() - Date.now()) / 60_000);
  const absolute = Math.abs(minutes);
  const [amount, unit] = absolute < 60 ? [minutes, "minute"] : absolute < 1_440 ? [Math.round(minutes / 60), "hour"] : [Math.round(minutes / 1_440), "day"];
  return new Intl.RelativeTimeFormat("es-AR", { numeric: "auto" }).format(amount, unit as Intl.RelativeTimeFormatUnit);
}

function AuthorAvatar({ avatarId, name, size = "size-11" }: { avatarId: PublicAvatarId; name: string; size?: string }) {
  const [failed, setFailed] = useState(false);
  const path = publicAvatarAssetPath(avatarId, failed);
  return <span className={`${size} relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-sky-100 ring-2 ring-white shadow-sm`}>
    {path ? <Image src={path} width={96} height={96} alt={`Avatar público de ${name}`} unoptimized onError={() => setFailed(true)} className="size-full object-cover" /> : <UserRound aria-hidden="true" className="size-5 text-sky-700" />}
  </span>;
}

function ReportControl({ targetType, targetId, onDone }: { targetType: "post" | "comment"; targetId: string; onDone: (message: string, isError?: boolean) => void }) {
  const [reason, setReason] = useState<Reason>("off_topic");
  const [busy, setBusy] = useState(false);
  return <details className="group relative text-sm">
    <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-xl px-3 font-semibold text-slate-600 hover:bg-sky-50 [&::-webkit-details-marker]:hidden"><Flag className="size-4" />Reportar</summary>
    <form className="absolute right-0 z-20 mt-1 w-[min(18rem,calc(100vw-3rem))] rounded-2xl border border-sky-100 bg-white p-3 shadow-xl" onSubmit={async (event) => {
      event.preventDefault();
      const details = event.currentTarget.closest("details");
      setBusy(true);
      try {
        await readResponse(await fetch("/api/community/reports", jsonRequest({ targetType, targetId, reason })));
        onDone("Gracias. Enviamos el reporte para revisión.");
        details?.removeAttribute("open");
      } catch (error) { onDone(error instanceof Error ? error.message : "No se pudo enviar el reporte.", true); }
      finally { setBusy(false); }
    }}>
      <label className="text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor={`report-${targetType}-${targetId}`}>Motivo</label>
      <select id={`report-${targetType}-${targetId}`} value={reason} onChange={(event) => setReason(event.target.value as Reason)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
        {COMMUNITY_REPORT_REASONS.map((item) => <option key={item} value={item}>{reasonLabels[item]}</option>)}
      </select>
      <button type="submit" disabled={busy} className="mt-2 min-h-10 w-full rounded-xl bg-[#0878be] px-3 font-bold text-white disabled:opacity-50">{busy ? "Enviando…" : `Enviar reporte de ${targetType === "post" ? "publicación" : "comentario"}`}</button>
    </form>
  </details>;
}

function CommentList({ post, canContribute, onNotice, onRefresh }: {
  post: CommunityPost;
  canContribute: boolean;
  onNotice: (message: string, isError?: boolean) => void;
  onRefresh: () => void;
}) {
  const [comments, setComments] = useState<CommunityComment[]>([]);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const result = await readResponse<{ comments: CommunityComment[] }>(await fetch(`/api/community/posts/${post.id}/comments`, { cache: "no-store", credentials: "same-origin" }));
    setComments(result.comments);
  }, [post.id]);
  const toggle = async () => {
    if (open) { setOpen(false); return; }
    setLoading(true);
    try { await load(); setOpen(true); }
    catch (error) { onNotice(error instanceof Error ? error.message : "No se cargaron las respuestas.", true); }
    finally { setLoading(false); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      const created = await readResponse<{ moderationStatus: "approved" | "pending_review" | "rejected" }>(await fetch(`/api/community/posts/${post.id}/comments`, jsonRequest({ text })));
      setText(""); await load(); onRefresh(); onNotice(created.moderationStatus === "approved" ? "Respuesta publicada." : created.moderationStatus === "pending_review" ? "Tu respuesta está siendo revisada antes de aparecer en Comunidad." : "No pudimos publicar este contenido porque incumple las normas de Comunidad.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "No se pudo agregar la respuesta.", true); }
    finally { setBusy(false); }
  };
  return <div className="mt-4 border-t border-slate-100 pt-3">
    <button type="button" onClick={() => void toggle()} className="inline-flex min-h-10 items-center gap-2 rounded-xl px-2 font-bold text-[#27628b] hover:bg-sky-50" aria-expanded={open}>
      <MessageCircle className="size-4" />{loading ? "Cargando…" : open ? "Ocultar respuestas" : `${post.commentCount} ${post.commentCount === 1 ? "respuesta" : "respuestas"}`}
    </button>
    {open && <div className="mt-2 space-y-3 rounded-2xl bg-[#f4f9fd] p-3 sm:p-4">
      {comments.length === 0 && <p className="px-1 py-2 text-sm text-slate-500">Todavía no hay respuestas. Podés iniciar la conversación.</p>}
      {comments.map((comment) => <article key={comment.id} className="border-b border-sky-100 pb-3 last:border-0 last:pb-0">
        <div className="flex items-center gap-2.5"><AuthorAvatar avatarId={comment.author.avatarId} name={comment.author.displayName} size="size-9" /><div className="min-w-0"><p className="truncate text-sm font-extrabold text-[#0c2b59]">{comment.author.displayName}</p><time title={new Date(comment.createdAt).toLocaleString("es-AR")} className="text-xs text-slate-500">{relativeDate(comment.createdAt)}{comment.editedAt ? " · editada" : ""}</time></div>
          {comment.isMine ? <details className="relative ml-auto"><summary aria-label="Opciones de mi respuesta" className="grid size-9 cursor-pointer list-none place-items-center rounded-full text-slate-500 hover:bg-white [&::-webkit-details-marker]:hidden"><MoreHorizontal className="size-5" /></summary><div className="absolute right-0 z-10 mt-1 w-36 rounded-xl border border-slate-100 bg-white p-1 shadow-lg"><button type="button" onClick={() => setEditing({ id: comment.id, text: comment.text })} className="min-h-10 w-full rounded-lg px-3 text-left text-sm font-semibold hover:bg-sky-50">Editar</button><button type="button" onClick={async () => {
            if (!window.confirm("¿Eliminar tu respuesta?")) return;
            try { await readResponse(await fetch(`/api/community/comments/${comment.id}`, { method: "DELETE", credentials: "same-origin" })); await load(); onRefresh(); onNotice("Respuesta eliminada."); }
            catch (error) { onNotice(error instanceof Error ? error.message : "No se pudo eliminar.", true); }
          }} className="min-h-10 w-full rounded-lg px-3 text-left text-sm font-semibold text-rose-700 hover:bg-rose-50">Eliminar</button></div></details>
            : canContribute && <ReportControl targetType="comment" targetId={comment.id} onDone={onNotice} />}
        </div>
        {editing?.id === comment.id ? <form className="mt-2" onSubmit={async (event) => {
          event.preventDefault(); setBusy(true);
          try { const result = await readResponse<{ moderationStatus: "approved" | "pending_review" | "rejected" }>(await fetch(`/api/community/comments/${comment.id}`, jsonRequest({ text: editing.text }, "PATCH"))); setEditing(null); await load(); onRefresh(); onNotice(result.moderationStatus === "approved" ? "Respuesta actualizada." : result.moderationStatus === "pending_review" ? "Tu respuesta está siendo revisada antes de aparecer en Comunidad." : "No pudimos publicar este contenido porque incumple las normas de Comunidad."); }
          catch (error) { onNotice(error instanceof Error ? error.message : "No se pudo editar.", true); }
          finally { setBusy(false); }
        }}><textarea value={editing.text} maxLength={1000} onChange={(event) => setEditing({ ...editing, text: event.target.value })} rows={3} className="w-full resize-y rounded-xl border border-sky-100 bg-white p-3 text-base outline-none focus:border-sky-400" /><div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => setEditing(null)} className="min-h-10 rounded-lg px-3 text-sm font-semibold">Cancelar</button><button disabled={busy || !editing.text.trim()} className="min-h-10 rounded-lg bg-[#0878be] px-4 text-sm font-bold text-white disabled:opacity-50">Guardar</button></div></form>
          : <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{comment.text}</p>}
      </article>)}
      {canContribute && <form onSubmit={(event) => void submit(event)} className="space-y-2 border-t border-sky-100 pt-3">
        <label htmlFor={`comment-${post.id}`} className="sr-only">Escribir una respuesta</label>
        <textarea id={`comment-${post.id}`} value={text} maxLength={1000} onChange={(event) => setText(event.target.value)} rows={2} placeholder="Escribí una respuesta sobre docencia…" className="w-full resize-y rounded-xl border border-sky-100 bg-white p-3 text-base outline-none placeholder:text-slate-400 focus:border-sky-400" />
        <div className="flex items-center justify-between gap-2"><span className="text-xs text-slate-500">Solo texto · {[...text].length}/1000</span><button type="submit" disabled={busy || !text.trim()} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#0878be] px-4 text-sm font-bold text-white disabled:opacity-50">{busy ? "Enviando…" : "Responder"}<Send className="size-4" /></button></div>
      </form>}
    </div>}
  </div>;
}

function PostCard({ post, canContribute, canSave, saved, saving, onToggleSaved, onNotice, onRefresh, onEdit, onDelete, onBlock }: {
  post: CommunityPost;
  canContribute: boolean;
  canSave: boolean;
  saved: boolean;
  saving: boolean;
  onToggleSaved: (post: CommunityPost) => void;
  onNotice: (message: string, isError?: boolean) => void;
  onRefresh: () => void;
  onEdit: (post: CommunityPost) => void;
  onDelete: (post: CommunityPost) => void;
  onBlock: (post: CommunityPost) => void;
}) {
  return <article className="overflow-visible rounded-[1.6rem] border border-sky-100/80 bg-white p-4 shadow-[0_8px_30px_rgba(17,79,125,.06)] sm:p-5">
    <div className="flex items-start gap-3">
      <AuthorAvatar avatarId={post.author.avatarId} name={post.author.displayName} size="size-12" />
      <div className="min-w-0 flex-1 pt-0.5"><p className="truncate font-extrabold leading-5 text-[#0a2b59]">{post.author.displayName}</p><div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-slate-500"><time title={new Date(post.createdAt).toLocaleString("es-AR")}>{relativeDate(post.createdAt)}</time>{post.editedAt && <span>· editada</span>}{post.author.bio && <><span aria-hidden="true">·</span><span className="max-w-full truncate">{post.author.bio}</span></>}</div></div>
      <details className="group relative -mr-1 -mt-1">
        <summary aria-label="Más opciones de la publicación" className="grid size-10 cursor-pointer list-none place-items-center rounded-full text-slate-500 hover:bg-sky-50 [&::-webkit-details-marker]:hidden"><MoreHorizontal className="size-5" /></summary>
        <div className="absolute right-0 z-20 mt-1 w-48 rounded-2xl border border-slate-100 bg-white p-1 shadow-xl">
          {canSave && <button type="button" disabled={saving} onClick={(event) => { onToggleSaved(post); event.currentTarget.closest("details")?.removeAttribute("open"); }} className="inline-flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm font-semibold hover:bg-sky-50 disabled:opacity-50">{saved ? <BookmarkCheck className="size-4 text-sky-700" /> : <Bookmark className="size-4" />}{saved ? "Quitar de Guardadas" : "Guardar publicación"}</button>}
          {post.isMine ? <><button type="button" onClick={() => onEdit(post)} className="min-h-11 w-full rounded-xl px-3 text-left text-sm font-semibold hover:bg-sky-50">Editar publicación</button><button type="button" onClick={() => onDelete(post)} className="min-h-11 w-full rounded-xl px-3 text-left text-sm font-semibold text-rose-700 hover:bg-rose-50">Eliminar publicación</button></>
            : canContribute && <><div className="px-2"><ReportControl targetType="post" targetId={post.id} onDone={onNotice} /></div><button type="button" onClick={() => onBlock(post)} className="min-h-11 w-full rounded-xl px-3 text-left text-sm font-semibold hover:bg-sky-50">Bloquear a esta persona</button></>}
        </div>
      </details>
    </div>
    <p className="mt-4 whitespace-pre-wrap break-words text-[15px] leading-6 text-[#172f4f] sm:text-base">{post.text}</p>
    <CommentList post={post} canContribute={canContribute} onNotice={onNotice} onRefresh={onRefresh} />
  </article>;
}

export function CommunityPhase3A() {
  const sidebar = useAppSidebarState(false);
  const [snapshot, setSnapshot] = useState<CommunityResponse | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState<{ posts: CommunityPost[]; nextCursor: string | null; hasMore: boolean } | null>(null);
  const [view, setView] = useState<"feed" | "saved">("feed");
  const [savedPostIds, setSavedPostIds] = useState<Set<string>>(() => new Set());
  const [savingPostId, setSavingPostId] = useState<string | null>(null);
  const [snapshotSort, setSnapshotSort] = useState<CommunityFeedSort | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [ownReviews, setOwnReviews] = useState<OwnReview[]>([]);
  const [sort, setSort] = useState<CommunityFeedSort>("recent");
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [normsChecked, setNormsChecked] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedLoadingMore, setSavedLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadPage = useCallback(async (cursor: string | null = null, append = false) => {
    setError("");
    if (append) setLoadingMore(true); else setLoading(true);
    if (!append) setSavedPostIds(new Set());
    try {
      const result = await readResponse<CommunityResponse>(await fetch(`/api/community/posts?sort=${sort}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(15000) }));
      setSnapshot((current) => append && current ? { ...result, posts: [...current.posts, ...result.posts] } : result);
      setSnapshotSort(sort);
      if (result.status.authenticated) {
        const visibleIds = [...new Set((append && snapshot ? [...snapshot.posts, ...result.posts] : result.posts).map((post) => post.id))].slice(0, 30);
        if (visibleIds.length) {
          const query = new URLSearchParams();
          visibleIds.forEach((id) => query.append("postId", id));
          const response = await fetch(`/api/community/saved-posts/status?${query}`, { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(15000) });
          if (response.ok) setSavedPostIds(new Set(((await response.json()) as { postIds: string[] }).postIds));
        } else setSavedPostIds(new Set());
      } else setSavedPostIds(new Set());
      if (!append && result.status.authenticated) {
        const blockResult = await fetch("/api/community/blocks", { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(15000) });
        setBlocks(blockResult.ok ? ((await blockResult.json()) as { blocks: Block[] }).blocks : []);
      } else if (!result.status.authenticated) setBlocks([]);
    } catch (reason) { setError(loadingError(reason, "No se pudo cargar Comunidad.")); }
    finally { setLoading(false); setLoadingMore(false); }
  }, [sort, snapshot]);

  const loadSavedPage = useCallback(async (cursor: string | null = null, append = false) => {
    setError("");
    if (append) setSavedLoadingMore(true); else setSavedLoading(true);
    if (!append) { setSavedSnapshot(null); setSavedPostIds(new Set()); }
    try {
      const result = await readResponse<{ posts: CommunityPost[]; nextCursor: string | null; hasMore: boolean }>(await fetch(`/api/community/saved-posts${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(15000) }));
      setSavedSnapshot((current) => append && current ? { ...result, posts: [...current.posts, ...result.posts] } : result);
      setSavedPostIds((current) => new Set([...current, ...result.posts.map((post) => post.id)]));
    } catch (reason) { setError(loadingError(reason, "No se pudieron cargar tus publicaciones guardadas.")); }
    finally { setSavedLoading(false); setSavedLoadingMore(false); }
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("docentetuc-theme");
    document.documentElement.dataset.theme = saved === "dark" || saved === "light" ? saved : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }, []);

  useEffect(() => {
    let active = true;
    const loadInitial = async () => {
      try {
        const result = await readResponse<CommunityResponse>(await fetch(`/api/community/posts?sort=${sort}`, { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(15000) }));
        if (!active) return;
        setSnapshot(result);
        setSnapshotSort(sort);
        if (result.status.authenticated) {
          const query = new URLSearchParams();
          result.posts.forEach((post) => query.append("postId", post.id));
          const response = result.posts.length ? await fetch(`/api/community/saved-posts/status?${query}`, { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(15000) }) : null;
          if (active) setSavedPostIds(response?.ok ? new Set(((await response.json()) as { postIds: string[] }).postIds) : new Set());
        } else if (active) setSavedPostIds(new Set());
        if (result.status.authenticated) {
          const blockResult = await fetch("/api/community/blocks", { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(15000) });
          if (active) setBlocks(blockResult.ok ? ((await blockResult.json()) as { blocks: Block[] }).blocks : []);
        } else setBlocks([]);
      } catch (reason) {
        if (active) setError(loadingError(reason, "No se pudo cargar Comunidad."));
      } finally { if (active) setLoading(false); }
    };
    void loadInitial();
    return () => { active = false; };
  }, [sort]);

  const status = snapshot?.status;
  const loadOwnReviews = useCallback(async () => {
    const response = await fetch("/api/community/my-moderation", { cache: "no-store", credentials: "same-origin" });
    if (response.ok) setOwnReviews(((await response.json()) as { items: OwnReview[] }).items);
  }, []);
  useEffect(() => {
    queueMicrotask(() => { if (status?.authenticated) void loadOwnReviews(); else setOwnReviews([]); });
  }, [status?.authenticated, loadOwnReviews]);
  const accepted = Boolean(status && status.acceptedRulesVersion === status.rulesVersion);
  const canContribute = Boolean(status?.authenticated && status.profileConfigured && accepted);
  const feedLoading = loading || (snapshotSort !== sort && !error);
  const viewLoading = view === "saved" ? savedLoading : feedLoading;
  const visiblePosts = view === "saved" ? savedSnapshot?.posts : snapshot?.posts;
  const visibleHasMore = view === "saved" ? savedSnapshot?.hasMore : snapshot?.hasMore;
  const visibleCursor = view === "saved" ? savedSnapshot?.nextCursor : snapshot?.nextCursor;
  const moreLoading = view === "saved" ? savedLoadingMore : loadingMore;
  const setNoticeState = (message: string, isError = false) => { setNotice(isError ? "" : message); setError(isError ? message : ""); if (!isError) void loadOwnReviews(); };

  const refreshCurrentView = () => { if (view === "saved") void loadSavedPage(); else void loadPage(); };

  const toggleSaved = async (post: CommunityPost) => {
    const wasSaved = savedPostIds.has(post.id);
    setSavingPostId(post.id);
    setSavedPostIds((current) => { const next = new Set(current); if (wasSaved) next.delete(post.id); else next.add(post.id); return next; });
    if (wasSaved && view === "saved") setSavedSnapshot((current) => current ? { ...current, posts: current.posts.filter((item) => item.id !== post.id) } : current);
    try {
      const response = await fetch(`/api/community/posts/${post.id}/saved`, { method: wasSaved ? "DELETE" : "POST", credentials: "same-origin" });
      const result = await readResponse<{ saved: boolean }>(response);
      setSavedPostIds((current) => { const next = new Set(current); if (result.saved) next.add(post.id); else next.delete(post.id); return next; });
      setNotice(result.saved ? "Publicación guardada." : "Se quitó de Guardadas.");
    } catch (reason) {
      setSavedPostIds((current) => { const next = new Set(current); if (wasSaved) next.add(post.id); else next.delete(post.id); return next; });
      if (wasSaved && view === "saved") setSavedSnapshot((current) => current ? { ...current, posts: [post, ...current.posts] } : current);
      setError(reason instanceof Error ? reason.message : "No se pudo actualizar Guardadas.");
    } finally { setSavingPostId(null); }
  };

  const openSaved = () => { setView("saved"); void loadSavedPage(); };
  const openFeed = () => { setView("feed"); void loadPage(); };

  const acceptRules = async () => {
    setBusy(true); setError("");
    try {
      await readResponse(await fetch("/api/community/rules", jsonRequest({ accepted: normsChecked })));
      setNotice("Aceptaste las Normas de Comunidad vigentes."); await loadPage();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo registrar la aceptación."); }
    finally { setBusy(false); }
  };

  const submitPost = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const created = await readResponse<{ moderationStatus: "approved" | "pending_review" | "rejected" }>(await fetch("/api/community/posts", jsonRequest({ text })));
      setText(""); setNotice(created.moderationStatus === "approved" ? "Publicación creada." : created.moderationStatus === "pending_review" ? "Tu publicación está siendo revisada antes de aparecer en Comunidad." : "No pudimos publicar este contenido porque incumple las normas de Comunidad."); await Promise.all([loadPage(), loadOwnReviews()]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo crear la publicación."); }
    finally { setBusy(false); }
  };

  const deletePost = async (post: CommunityPost) => {
    if (!window.confirm("¿Eliminar tu publicación y sus respuestas? Esta acción no se puede deshacer.")) return;
    try { await readResponse(await fetch(`/api/community/posts/${post.id}`, { method: "DELETE", credentials: "same-origin" })); setSavedPostIds((current) => { const next = new Set(current); next.delete(post.id); return next; }); setNotice("Publicación eliminada."); refreshCurrentView(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo eliminar la publicación."); }
  };

  const blockAuthor = async (post: CommunityPost) => {
    if (!window.confirm(`¿Bloquear a ${post.author.displayName}? Sus publicaciones y respuestas dejarán de aparecerte.`)) return;
    try { await readResponse(await fetch("/api/community/blocks", jsonRequest({ postId: post.id }))); refreshCurrentView(); setNotice("Cuenta bloqueada."); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo bloquear a esta persona."); }
  };

  return <SidebarProvider open={sidebar.open} onOpenChange={sidebar.onOpenChange} data-sidebar-pinned={sidebar.pinned} className="dt-community-shell" style={{ "--sidebar-width": "17rem" } as CSSProperties}>
    <AppSidebarEdge pinned={sidebar.pinned} onEnter={sidebar.enter} onLeave={sidebar.leave} />
    <AppSidebar view="comunidad" pinned={sidebar.pinned} onTogglePin={sidebar.togglePin} onHoverEnter={sidebar.enter} onHoverLeave={sidebar.leave} />
    <SidebarInset className="min-w-0">
    <div className="community-theme min-h-dvh w-full bg-[radial-gradient(ellipse_at_top,_#dff2ff_0%,_#f3f9fd_38%,_#f7fafc_100%)] pb-[calc(7rem+env(safe-area-inset-bottom))] text-[#0c2d5b] md:pb-8">
    <div className="mx-auto max-w-6xl px-3 pt-3 sm:px-6 sm:pt-5">
      <nav aria-label="Cabecera de DocenteTuc" className="mb-3 flex items-center justify-between gap-3 rounded-full border border-white/80 bg-white/75 px-3 py-2 shadow-sm backdrop-blur sm:mb-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
        <AppSidebarTrigger pinned={sidebar.pinned} open={sidebar.open} onTogglePin={sidebar.togglePin} />
        <a href="/" className="flex min-h-11 min-w-0 items-center gap-2.5 rounded-full pr-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600">
          <Image src="/icon-192.png" alt="" width={38} height={38} unoptimized className="size-9 shrink-0 rounded-xl" />
          <span className="truncate text-lg font-black tracking-tight sm:text-xl">Docente<span className="text-sky-600">Tuc</span></span>
        </a>
        </div>
        <a href="/" className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-bold text-sky-800 hover:bg-sky-50"><Home className="size-4" /><span className="hidden sm:inline">Inicio</span><ArrowUpRight className="size-3.5" /></a>
      </nav>

      <header className="community-hero relative isolate flex min-h-[220px] items-center overflow-hidden rounded-[1.7rem] border border-white/80 bg-[#d7efff] shadow-[0_14px_36px_rgba(32,111,173,.12)] sm:min-h-[290px]">
        <Image src="/assets/docentetuc/community-header.webp" alt="" fill priority sizes="(max-width: 640px) 100vw, 1152px" className="-z-20 object-cover object-[center_42%]" />
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-r from-white/90 via-white/72 to-white/5 sm:from-white/95 sm:via-white/76 sm:to-white/10" />
        <div className="max-w-2xl px-5 py-7 sm:px-10 sm:py-10">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/90 bg-white/75 px-3 py-1.5 text-[11px] font-black uppercase tracking-[.15em] text-sky-800 shadow-sm"><UsersRound className="size-4" />Comunidad DocenteTuc</span>
          <h1 className="mt-4 max-w-xl text-3xl font-black leading-[1.06] tracking-tight text-[#0a2a5b] sm:text-5xl">Comunidad Docente</h1>
          <p className="mt-3 max-w-lg text-sm font-medium leading-relaxed text-[#385979] sm:text-lg">Preguntá, compartí y ayudá a otros docentes.</p>
        </div>
        <div aria-hidden="true" className="absolute bottom-4 right-4 hidden size-12 place-items-center rounded-2xl border border-white/70 bg-white/75 text-sky-600 shadow-sm sm:grid"><MessagesSquare className="size-6" /></div>
      </header>
    </div>

    <main className="mx-auto mt-4 w-full max-w-5xl px-3 sm:mt-5 sm:px-6">
      {error && <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800 shadow-sm"><span>{error}</span><button type="button" onClick={() => view === "saved" ? void loadSavedPage() : void loadPage()} className="min-h-10 rounded-xl border border-rose-300 bg-white px-4 font-bold">Reintentar</button></div>}
      {notice && <p role="status" className="mb-3 flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900 shadow-sm"><Check className="mt-0.5 size-4 shrink-0" />{notice}</p>}

      {!loading && status && !status.authenticated && <section className="mb-4 rounded-[1.6rem] border border-amber-200 bg-white p-4 shadow-sm sm:p-5">
        <p className="font-extrabold text-[#173b5e]">Sumate a la conversación</p><p className="mt-1 text-sm leading-relaxed text-slate-600">Para publicar o responder, iniciá sesión con tu cuenta de DocenteTuc. Podés leer las publicaciones sin compartir datos privados.</p><a href="/?section=cuentas" className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#0878be] px-4 font-bold text-white">Continuar con Google<ArrowUpRight className="size-4" /></a>
      </section>}

      {!loading && status?.authenticated && !status.profileConfigured && <section className="mb-4 rounded-[1.6rem] border border-amber-200 bg-white p-4 shadow-sm sm:p-5">
        <p className="font-extrabold text-[#173b5e]">Prepará tu perfil público</p><p className="mt-1 text-sm leading-relaxed text-slate-600">Antes de participar, elegí el nombre y el avatar que se mostrarán en Comunidad. Tu correo y tu perfil docente privado no son públicos.</p><a href="/?section=perfil" className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#0878be] px-4 font-bold text-white">Configurar perfil público<ArrowUpRight className="size-4" /></a>
      </section>}

      {!loading && status?.authenticated && status.profileConfigured && !accepted && <CommunityRulesCard version={status.rulesVersion} text={status.rulesText} checked={normsChecked} busy={busy} onCheckedChange={setNormsChecked} onAccept={() => void acceptRules()} />}

      {canContribute && <section className="mb-5 rounded-[1.6rem] border border-sky-100 bg-white p-4 shadow-[0_10px_32px_rgba(17,79,125,.08)] sm:p-5">
        <form onSubmit={(event) => void submitPost(event)}>
          <div className="flex items-start gap-3 sm:gap-4"><AuthorAvatar avatarId={status!.publicProfile!.avatarId} name={status!.publicProfile!.displayName} size="size-12 sm:size-14" />
            <div className="min-w-0 flex-1"><label htmlFor="community-post" className="block font-extrabold text-[#0a2b59]">¿Qué querés consultar?</label><textarea id="community-post" value={text} onChange={(event) => setText(event.target.value)} maxLength={2000} rows={3} placeholder="Escribí una duda o compartí una experiencia..." className="mt-1 min-h-20 w-full resize-y border-0 bg-transparent p-0 text-base leading-6 text-slate-700 outline-none placeholder:text-slate-400 focus:ring-0" /></div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-slate-100 pt-3"><span className="text-xs text-slate-500">Solo texto · relacionado con la docencia · {[...text].length}/2000</span><button type="submit" disabled={busy || !text.trim()} aria-label="Publicar consulta" className="grid size-11 shrink-0 place-items-center rounded-full bg-[#1689ed] text-white shadow-md transition hover:bg-[#0878be] disabled:cursor-not-allowed disabled:opacity-40">{busy ? <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <Send className="size-5" />}</button></div>
        </form>
      </section>}

      {status?.authenticated && ownReviews.length > 0 && <details className="mb-4 min-w-0 rounded-2xl border border-amber-200 bg-white p-4 text-sm"><summary className="cursor-pointer font-bold">Mis contenidos en revisión o rechazados ({ownReviews.length})</summary><div className="mt-3 space-y-3">{ownReviews.map((item, index) => <article key={`${item.createdAt}-${index}`} className="min-w-0 border-t border-slate-100 pt-3"><p className="font-semibold">{item.type === "post" ? "Publicación" : "Respuesta"} · {item.decision === "pending_review" ? "En revisión" : "No publicada"}</p><p className="mt-1 whitespace-pre-wrap break-words text-slate-700">{item.text}</p></article>)}</div></details>}

      {accepted && <details className="mb-4 rounded-2xl border border-emerald-100 bg-white/85 px-4 py-3 text-sm text-slate-600"><summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 font-semibold [&::-webkit-details-marker]:hidden"><ShieldCheck className="size-4 shrink-0 text-emerald-600" />Normas aceptadas · versión {status?.rulesVersion}<ChevronDown className="ml-auto size-4 shrink-0" /></summary><div role="region" aria-label="Texto completo de las Normas aceptadas" tabIndex={0} className="mt-2 max-h-48 overflow-y-auto border-t border-slate-100 pt-3 leading-relaxed break-words focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600"><p className="whitespace-pre-wrap first-line:font-bold">{status?.rulesText}</p></div></details>}

      <section aria-labelledby="community-feed-heading">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div><p className="text-[11px] font-black uppercase tracking-[.15em] text-sky-700">{view === "saved" ? "Tu espacio personal" : "Conversaciones docentes"}</p><h2 id="community-feed-heading" className="mt-1 text-xl font-black text-[#0b2c5a] sm:text-2xl">{view === "saved" ? "Tus publicaciones guardadas" : "Lo que están conversando"}</h2></div>
          <div className="flex max-w-full flex-wrap items-center gap-2">
          {view === "feed" ? <>
          <div role="group" aria-label="Ordenar publicaciones" className="flex min-h-11 rounded-full border border-sky-100 bg-white p-1 shadow-sm">
            <button type="button" aria-pressed={sort === "recent"} onClick={() => setSort("recent")} className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-bold transition sm:px-4 ${sort === "recent" ? "bg-[#1689ed] text-white shadow-sm" : "text-slate-600 hover:bg-sky-50"}`}><Clock3 className="size-4" />Recientes</button>
            <button type="button" aria-pressed={sort === "popular"} onClick={() => setSort("popular")} className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-bold transition sm:px-4 ${sort === "popular" ? "bg-[#1689ed] text-white shadow-sm" : "text-slate-600 hover:bg-sky-50"}`}><MessagesSquare className="size-4" />Más comentadas</button>
          </div>
          {status?.authenticated && <button type="button" onClick={openSaved} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-sky-100 bg-white px-3 text-sm font-bold text-sky-800 shadow-sm hover:bg-sky-50"><Bookmark className="size-4" />Guardadas</button>}
          </> : <button type="button" onClick={openFeed} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-sky-100 bg-white px-4 text-sm font-bold text-sky-800 shadow-sm hover:bg-sky-50">Volver al feed</button>}
          </div>
        </div>

        {viewLoading && <div role="status" className="space-y-3"><p className="sr-only">Cargando publicaciones…</p>{[1, 2].map((item) => <div key={item} className="h-40 animate-pulse rounded-[1.6rem] border border-sky-100 bg-white/80" />)}</div>}
        {!viewLoading && view === "feed" && visiblePosts?.length === 0 && <div className="rounded-[1.6rem] border border-dashed border-sky-200 bg-white/75 px-5 py-10 text-center"><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-sky-50 text-sky-600"><MessageCircle className="size-7" /></span><h3 className="mt-4 font-extrabold text-[#12355d]">Todavía no hay conversaciones</h3><p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-slate-500">Cuando haya consultas o experiencias docentes, van a aparecer acá.</p></div>}
        {!viewLoading && view === "saved" && visiblePosts?.length === 0 && <div className="rounded-[1.6rem] border border-dashed border-sky-200 bg-white/75 px-5 py-10 text-center"><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-sky-50 text-sky-600"><Bookmark className="size-7" /></span><h3 className="mt-4 font-extrabold text-[#12355d]">Todavía no guardaste publicaciones.</h3><p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-slate-500">Cuando encuentres una consulta que quieras revisar después, podés guardarla desde el menú de la publicación.</p></div>}
        {!viewLoading && <div className="space-y-3">{visiblePosts?.map((post) => <PostCard key={post.id} post={post} canContribute={canContribute} canSave={Boolean(status?.authenticated)} saved={savedPostIds.has(post.id)} saving={savingPostId === post.id} onToggleSaved={(item) => void toggleSaved(item)} onNotice={setNoticeState} onRefresh={refreshCurrentView} onEdit={(item) => setEditing({ id: item.id, text: item.text })} onDelete={(item) => void deletePost(item)} onBlock={(item) => void blockAuthor(item)} />)}</div>}
        {!viewLoading && visibleHasMore && <button type="button" disabled={moreLoading} onClick={() => view === "saved" ? void loadSavedPage(visibleCursor || null, true) : void loadPage(visibleCursor || null, true)} className="mt-4 min-h-12 w-full rounded-2xl border border-sky-100 bg-white font-bold text-sky-800 shadow-sm hover:bg-sky-50 disabled:opacity-50">{moreLoading ? "Cargando publicaciones…" : view === "saved" ? "Cargar más publicaciones guardadas" : "Cargar más conversaciones"}</button>}
      </section>

      {editing && <div role="presentation" className="fixed inset-0 z-50 grid place-items-end bg-slate-950/40 p-3 sm:place-items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="edit-post-title" className="w-full max-w-xl rounded-[1.6rem] bg-white p-5 shadow-2xl sm:p-6">
          <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-widest text-sky-700">Tu publicación</p><h2 id="edit-post-title" className="mt-1 text-xl font-black">Editar consulta</h2></div><button type="button" aria-label="Cerrar edición" onClick={() => setEditing(null)} className="grid size-10 place-items-center rounded-full text-slate-500 hover:bg-slate-100"><X className="size-5" /></button></div>
          <form className="mt-4" onSubmit={async (event) => {
            event.preventDefault(); setBusy(true);
            try { const result = await readResponse<{ moderationStatus: "approved" | "pending_review" | "rejected" }>(await fetch(`/api/community/posts/${editing.id}`, jsonRequest({ text: editing.text }, "PATCH"))); setEditing(null); setNotice(result.moderationStatus === "approved" ? "Publicación actualizada." : result.moderationStatus === "pending_review" ? "Tu publicación está siendo revisada antes de aparecer en Comunidad." : "No pudimos publicar este contenido porque incumple las normas de Comunidad."); refreshCurrentView(); void loadOwnReviews(); }
            catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo editar la publicación."); }
            finally { setBusy(false); }
          }}><label htmlFor="edit-community-post" className="sr-only">Editar texto de la publicación</label><textarea id="edit-community-post" autoFocus value={editing.text} maxLength={2000} onChange={(event) => setEditing({ ...editing, text: event.target.value })} rows={5} className="w-full resize-y rounded-2xl border border-sky-100 p-3 text-base leading-relaxed outline-none focus:border-sky-400" /><div className="mt-3 flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-slate-500">Solo texto · {[...editing.text].length}/2000</span><div className="flex gap-2"><button type="button" disabled={busy} onClick={() => setEditing(null)} className="min-h-11 rounded-xl px-4 font-semibold text-slate-600 hover:bg-slate-50">Cancelar</button><button type="submit" disabled={busy || !editing.text.trim()} className="min-h-11 rounded-xl bg-[#0878be] px-5 font-bold text-white disabled:opacity-50">{busy ? "Guardando…" : "Guardar cambios"}</button></div></div></form>
        </section>
      </div>}

      {status?.authenticated && blocks.length > 0 && <details className="mt-6 rounded-2xl border border-sky-100 bg-white/85 p-4"><summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 font-bold text-slate-700 [&::-webkit-details-marker]:hidden"><BookOpen className="size-4 text-sky-700" />Personas bloqueadas ({blocks.length})<ChevronDown className="ml-auto size-4" /></summary><ul className="mt-3 space-y-2">{blocks.map((block) => <li key={block.id} className="flex items-center gap-3 border-t border-slate-100 py-3"><AuthorAvatar avatarId={block.profile.avatarId} name={block.profile.displayName} size="size-9" /><span className="min-w-0 flex-1 truncate text-sm font-semibold">{block.profile.displayName}</span><button type="button" onClick={async () => {
        try { await readResponse(await fetch(`/api/community/blocks/${block.id}`, { method: "DELETE", credentials: "same-origin" })); await loadPage(); setNotice("Cuenta desbloqueada."); }
        catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo desbloquear."); }
      }} className="min-h-10 rounded-xl px-3 text-sm font-bold text-sky-800 hover:bg-sky-50">Desbloquear</button></li>)}</ul></details>}
    </main>

    <nav aria-label="Navegación principal" className="fixed inset-x-0 bottom-0 z-40 border-t border-sky-100 bg-white/95 px-2 pt-2 shadow-[0_-8px_24px_rgba(18,72,116,.08)] backdrop-blur-md pb-[max(env(safe-area-inset-bottom),.45rem)] md:hidden">
      <div className="mx-auto grid max-w-3xl grid-cols-[1fr_1.3fr_1fr_1fr_1fr] items-center gap-1">
        {[
          { label: "Inicio", href: "/", icon: Home },
          { label: "Comunidad", href: "/comunidad", icon: UsersRound },
          { label: "Agenda", href: "/?section=agenda", icon: Clock3 },
          { label: "Perfil", href: "/?section=perfil", icon: UserRound },
          { label: "Cuenta", href: "/?section=cuentas", icon: CircleUserRound },
        ].map(({ label, href, icon: Icon }) => <a key={label} href={href} aria-current={label === "Comunidad" ? "page" : undefined} className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-0 text-[9px] font-bold transition sm:min-h-16 sm:text-xs ${label === "Comunidad" ? "bg-[#e8f5ff] text-[#0878be]" : "text-slate-500 hover:bg-slate-50"}`}><Icon className="size-5 sm:size-[1.35rem]" aria-hidden="true" /><span className="whitespace-nowrap">{label}</span></a>)}
      </div>
    </nav>
    </div>
    </SidebarInset>
  </SidebarProvider>;
}
