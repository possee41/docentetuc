"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { UserRound } from "lucide-react";
import { COMMUNITY_REPORT_REASONS, type CommunityComment, type CommunityPost } from "@/lib/community";
import { publicAvatarAssetPath, type PublicAvatarId } from "@/lib/public-profile";

type CommunityStatus = {
  authenticated: boolean;
  profileConfigured: boolean;
  rulesVersion: string;
  acceptedRulesVersion: string | null;
  rulesText: string;
};
type CommunityResponse = { status: CommunityStatus; posts: CommunityPost[] };
type Block = { id: string; profile: { displayName: string; avatarId: PublicAvatarId; bio: string } };
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

async function readResponse(response: Response) {
  const result = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(result.error || "No se pudo completar la acción.");
  return result;
}

function AuthorAvatar({ avatarId, name }: { avatarId: PublicAvatarId; name: string }) {
  const [failed, setFailed] = useState(false);
  const path = publicAvatarAssetPath(avatarId, failed);
  return <span className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-sky-100 ring-1 ring-slate-200">
    {path ? <Image src={path} width={96} height={96} alt={`Avatar de ${name}`} unoptimized onError={() => setFailed(true)} className="size-full object-cover" /> : <UserRound aria-hidden="true" className="size-5 text-slate-500" />}
  </span>;
}

function ReportControl({ targetType, targetId, onDone }: { targetType: "post" | "comment"; targetId: string; onDone: (message: string) => void }) {
  const [reason, setReason] = useState<Reason>("off_topic");
  const [busy, setBusy] = useState(false);
  return <details className="mt-3 text-sm">
    <summary className="w-fit cursor-pointer font-semibold text-slate-600">Reportar {targetType === "post" ? "publicación" : "comentario"}</summary>
    <form className="mt-2 flex flex-wrap gap-2" onSubmit={async (event) => {
      event.preventDefault(); setBusy(true);
      try {
        await readResponse(await fetch("/api/community/reports", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetType, targetId, reason }),
        }));
        onDone("Reporte enviado para revisión.");
      } catch (error) { onDone(error instanceof Error ? error.message : "No se pudo enviar el reporte."); }
      finally { setBusy(false); }
    }}>
      <label className="sr-only" htmlFor={`report-${targetType}-${targetId}`}>Motivo del reporte</label>
      <select id={`report-${targetType}-${targetId}`} value={reason} onChange={(event) => setReason(event.target.value as Reason)} className="min-h-10 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3">
        {COMMUNITY_REPORT_REASONS.map((item) => <option key={item} value={item}>{reasonLabels[item]}</option>)}
      </select>
      <button disabled={busy} className="min-h-10 rounded-lg bg-slate-100 px-3 font-semibold disabled:opacity-50">{busy ? "Enviando…" : "Enviar reporte"}</button>
    </form>
  </details>;
}

function CommentList({ post, canContribute, onNotice, onRefresh }: {
  post: CommunityPost;
  canContribute: boolean;
  onNotice: (message: string) => void;
  onRefresh: () => void;
}) {
  const [comments, setComments] = useState<CommunityComment[]>([]);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const result = await readResponse(await fetch(`/api/community/posts/${post.id}/comments`, { cache: "no-store" })) as { comments: CommunityComment[] };
    setComments(result.comments);
  };
  const toggle = async () => {
    if (!open) { try { await load(); } catch (error) { onNotice(error instanceof Error ? error.message : "No se cargaron los comentarios."); } }
    setOpen((value) => !value);
  };
  return <div className="mt-3 border-t border-slate-100 pt-3">
    <button type="button" onClick={() => void toggle()} className="min-h-10 text-sm font-bold text-sky-800" aria-expanded={open}>
      {open ? "Ocultar comentarios" : `Comentarios (${post.commentCount})`}
    </button>
    {open && <div className="space-y-3 pt-2">
      {comments.map((comment) => <article key={comment.id} className="rounded-xl bg-slate-50 p-3">
        <div className="flex items-center gap-2"><AuthorAvatar avatarId={comment.author.avatarId} name={comment.author.displayName} /><p className="font-bold">{comment.author.displayName}</p><time className="ml-auto text-xs text-slate-500">{new Date(comment.createdAt).toLocaleString("es-AR")}</time></div>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm">{comment.text}</p>
        {comment.isMine && <button type="button" onClick={async () => {
          if (!window.confirm("¿Eliminar este comentario?")) return;
          try { await readResponse(await fetch(`/api/community/comments/${comment.id}`, { method: "DELETE" })); await load(); onRefresh(); }
          catch (error) { onNotice(error instanceof Error ? error.message : "No se pudo eliminar el comentario."); }
        }} className="mt-2 text-xs font-bold text-rose-700">Eliminar mi comentario</button>}
        {!comment.isMine && canContribute && <ReportControl targetType="comment" targetId={comment.id} onDone={onNotice} />}
      </article>)}
      {canContribute && <form className="space-y-2" onSubmit={async (event) => {
        event.preventDefault(); setBusy(true);
        try {
          await readResponse(await fetch(`/api/community/posts/${post.id}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }));
          setText(""); await load(); onRefresh();
        } catch (error) { onNotice(error instanceof Error ? error.message : "No se pudo agregar el comentario."); }
        finally { setBusy(false); }
      }}>
        <label className="sr-only" htmlFor={`comment-${post.id}`}>Escribir comentario</label>
        <textarea id={`comment-${post.id}`} value={text} maxLength={1000} onChange={(event) => setText(event.target.value)} rows={2} placeholder="Escribí un comentario sobre docencia…" className="w-full rounded-xl border border-slate-300 p-3 text-base" />
        <button disabled={busy || !text.trim()} className="min-h-10 rounded-lg bg-sky-800 px-4 font-bold text-white disabled:opacity-50">{busy ? "Enviando…" : "Comentar"}</button>
      </form>}
    </div>}
  </div>;
}

export function CommunityPhase3A() {
  const [snapshot, setSnapshot] = useState<CommunityResponse | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [normsChecked, setNormsChecked] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setError("");
    const result = await readResponse(await fetch("/api/community/posts", { cache: "no-store" })) as CommunityResponse;
    setSnapshot(result);
    if (result.status.authenticated) {
      const blockResult = await fetch("/api/community/blocks", { cache: "no-store" });
      if (blockResult.ok) setBlocks(((await blockResult.json()) as { blocks: Block[] }).blocks);
    } else setBlocks([]);
  }, []);

  useEffect(() => {
    let active = true;
    const loadInitial = async () => {
      try {
        const result = await readResponse(await fetch("/api/community/posts", { cache: "no-store" })) as CommunityResponse;
        if (!active) return;
        setSnapshot(result);
        if (result.status.authenticated) {
          const blockResult = await fetch("/api/community/blocks", { cache: "no-store" });
          if (active && blockResult.ok) setBlocks(((await blockResult.json()) as { blocks: Block[] }).blocks);
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "No se pudo cargar Comunidad.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void loadInitial();
    return () => { active = false; };
  }, []);

  const status = snapshot?.status;
  const accepted = Boolean(status && status.acceptedRulesVersion === status.rulesVersion);
  const canContribute = Boolean(status?.authenticated && status.profileConfigured && accepted);

  const acceptRules = async () => {
    setBusy(true); setError("");
    try {
      await readResponse(await fetch("/api/community/rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accepted: normsChecked }) }));
      setNotice("Aceptaste las Normas de Comunidad vigentes."); await reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo registrar la aceptación."); }
    finally { setBusy(false); }
  };

  const submitPost = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await readResponse(await fetch("/api/community/posts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }));
      setText(""); setNotice("Publicación creada."); await reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo crear la publicación."); }
    finally { setBusy(false); }
  };

  return <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-5 pb-[calc(env(safe-area-inset-bottom)+2.5rem)] text-slate-900 sm:px-6">
    <Link href="/" className="inline-flex min-h-10 items-center font-bold text-sky-800">← Volver a DocenteTuc</Link>
    <header className="my-4 rounded-2xl border border-sky-200 bg-sky-50 p-4">
      <p className="text-xs font-black uppercase tracking-wider text-sky-800">DocenteTuc 1.1 · Fase 3A</p>
      <h1 className="mt-1 text-2xl font-black">Comunidad · prueba funcional</h1>
      <p className="mt-2 text-sm text-slate-700">Base de publicaciones y comentarios de texto. No se admiten imágenes, audio, video ni archivos.</p>
    </header>

    {loading && <p role="status" className="py-4">Cargando Comunidad…</p>}
    {error && <p role="alert" className="my-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {notice && <p role="status" className="my-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}

    {!loading && status && <>
      {!status.authenticated && <section className="my-4 rounded-2xl border border-amber-300 bg-amber-50 p-4">
        <p className="font-bold">Iniciá sesión con Google para publicar o comentar.</p>
        <p className="mt-1 text-sm">La lectura no expone datos privados, pero participar requiere una sesión autenticada.</p>
        <Link href="/" className="mt-3 inline-flex min-h-10 items-center rounded-lg bg-sky-800 px-4 font-bold text-white">Volver a iniciar sesión</Link>
      </section>}
      {status.authenticated && !status.profileConfigured && <section className="my-4 rounded-2xl border border-amber-300 bg-amber-50 p-4">
        <p className="font-bold">Completá Mi perfil público antes de participar.</p>
        <p className="mt-1 text-sm">Se requiere un nombre público válido y uno de los avatares disponibles.</p>
        <Link href="/" className="mt-3 inline-flex min-h-10 items-center rounded-lg bg-sky-800 px-4 font-bold text-white">Ir a DocenteTuc</Link>
      </section>}

      <section className="my-4 rounded-2xl border border-slate-200 bg-white p-4" aria-labelledby="community-rules-heading">
        <h2 id="community-rules-heading" className="text-lg font-black">Normas de Comunidad · versión {status.rulesVersion}</h2>
        <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-6 text-slate-700">{status.rulesText}</pre>
        {status.authenticated && !accepted && <div className="mt-4 border-t border-slate-100 pt-4">
          <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" checked={normsChecked} onChange={(event) => setNormsChecked(event.target.checked)} className="mt-1 size-5" />Leí y acepto las Normas de Comunidad.</label>
          <button type="button" disabled={!normsChecked || busy} onClick={() => void acceptRules()} className="mt-3 min-h-11 rounded-xl bg-sky-800 px-5 font-bold text-white disabled:opacity-50">{busy ? "Guardando…" : "Aceptar normas"}</button>
        </div>}
        {accepted && <p className="mt-3 text-sm font-semibold text-emerald-800">Normas aceptadas · versión {status.rulesVersion}</p>}
      </section>

      {canContribute && <form onSubmit={(event) => void submitPost(event)} className="my-4 rounded-2xl border border-slate-200 bg-white p-4">
        <label htmlFor="community-post" className="font-black">Nueva publicación</label>
        <textarea id="community-post" value={text} onChange={(event) => setText(event.target.value)} maxLength={2000} rows={4} placeholder="Consultas, experiencias o recursos relacionados con la docencia…" className="mt-3 w-full rounded-xl border border-slate-300 p-3 text-base" />
        <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500"><span>Solo texto · máximo 2.000 caracteres</span><span>{[...text].length}/2000</span></div>
        <button disabled={busy || !text.trim()} className="mt-3 min-h-11 rounded-xl bg-sky-800 px-5 font-bold text-white disabled:opacity-50">{busy ? "Publicando…" : "Publicar"}</button>
      </form>}

      {status.authenticated && <details className="my-4 rounded-2xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer font-bold">Usuarios bloqueados ({blocks.length})</summary>
        <ul className="mt-3 space-y-2">{blocks.map((block) => <li key={block.id} className="flex items-center gap-3 rounded-xl bg-slate-50 p-3"><AuthorAvatar avatarId={block.profile.avatarId} name={block.profile.displayName} /><span className="min-w-0 flex-1 truncate font-semibold">{block.profile.displayName}</span><button type="button" onClick={async () => {
          try { await readResponse(await fetch(`/api/community/blocks/${block.id}`, { method: "DELETE" })); await reload(); }
          catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo desbloquear."); }
        }} className="min-h-10 rounded-lg px-3 font-bold text-sky-800">Desbloquear</button></li>)}</ul>
      </details>}

      <section aria-labelledby="community-posts-heading" className="space-y-3">
        <h2 id="community-posts-heading" className="text-lg font-black">Publicaciones visibles</h2>
        {!snapshot?.posts.length && <p className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-600">Todavía no hay publicaciones disponibles.</p>}
        {snapshot?.posts.map((post) => <article key={post.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3"><AuthorAvatar avatarId={post.author.avatarId} name={post.author.displayName} /><div className="min-w-0"><p className="truncate font-black">{post.author.displayName}</p>{post.author.bio && <p className="truncate text-xs text-slate-500">{post.author.bio}</p>}</div><time className="ml-auto text-right text-xs text-slate-500">{new Date(post.createdAt).toLocaleString("es-AR")}</time></div>
          {editing?.id === post.id ? <form className="mt-3" onSubmit={async (event) => {
            event.preventDefault(); setBusy(true);
            try { await readResponse(await fetch(`/api/community/posts/${post.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: editing.text }) })); setEditing(null); await reload(); }
            catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo editar."); }
            finally { setBusy(false); }
          }}><textarea value={editing.text} maxLength={2000} onChange={(event) => setEditing({ ...editing, text: event.target.value })} rows={4} className="w-full rounded-xl border border-slate-300 p-3" /><button disabled={busy} className="mt-2 min-h-10 rounded-lg bg-sky-800 px-4 font-bold text-white">Guardar edición</button><button type="button" onClick={() => setEditing(null)} className="ml-2 min-h-10 rounded-lg px-3 font-bold">Cancelar</button></form>
            : <p className="mt-3 whitespace-pre-wrap break-words">{post.text}</p>}
          {post.editedAt && <p className="mt-2 text-xs text-slate-500">Editada</p>}
          {post.isMine ? <div className="mt-2 flex flex-wrap gap-3"><button type="button" onClick={() => setEditing({ id: post.id, text: post.text })} className="min-h-10 font-bold text-sky-800">Editar mi publicación</button><button type="button" onClick={async () => {
            if (!window.confirm("¿Eliminar esta publicación y sus comentarios/reportes asociados?")) return;
            try { await readResponse(await fetch(`/api/community/posts/${post.id}`, { method: "DELETE" })); setNotice("Publicación eliminada."); await reload(); }
            catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo eliminar."); }
          }} className="min-h-10 font-bold text-rose-700">Eliminar mi publicación</button></div>
            : status.authenticated && <div className="mt-2 flex flex-wrap items-center gap-3"><ReportControl targetType="post" targetId={post.id} onDone={setNotice} /><button type="button" onClick={async () => {
              if (!window.confirm("¿Bloquear a esta persona? Sus publicaciones dejarán de aparecerte.")) return;
              try { await readResponse(await fetch("/api/community/blocks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ postId: post.id }) })); setNotice("Cuenta bloqueada."); await reload(); }
              catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo bloquear."); }
            }} className="min-h-10 text-sm font-semibold text-slate-600">Bloquear autor</button></div>}
          <CommentList key={post.id} post={post} canContribute={canContribute} onNotice={setNotice} onRefresh={() => void reload()} />
        </article>)}
      </section>
    </>}
  </main>;
}
