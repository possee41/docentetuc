"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize2, Minus, RotateCcw, Send, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { AIContext } from "@/components/app-chrome";

type Source = { id: string; title: string; source: string; sourceType: "official" | "internal" | "complementary"; url: string; updatedAt: string; status: string };
type Message = { role: "user" | "assistant"; content: string; sources?: Source[] };
export type AIAssistantAction = "save" | "agenda" | "remind";
type PendingAction = { action: AIAssistantAction; label: string };

const welcome: Message = { role: "assistant", content: "Hola 👋\nSoy el asistente de DocenteTuc. Puedo ayudarte a encontrar capacitaciones, designaciones, novedades, fechas y organizar tu actividad docente." };

export function DocenteTucAIChatPanel({ mode, onClose, onMinimize, onExpand, context, profileAvailable, headers, onAction }: { mode: "closed" | "minimized" | "expanded"; onClose: () => void; onMinimize: () => void; onExpand: () => void; context: AIContext; profileAvailable: boolean; headers: () => Record<string, string>; onAction: (action: AIAssistantAction, context: AIContext) => Promise<void> }) {
  const open = mode !== "closed";
  const [messages, setMessages] = useState<Message[]>([welcome]);
  const [input, setInput] = useState(""), [sending, setSending] = useState(false), [useProfile, setUseProfile] = useState(false), [configured, setConfigured] = useState<boolean | null>(null), [retryQuestion, setRetryQuestion] = useState(""), [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null), endRef = useRef<HTMLDivElement>(null), abortRef = useRef<AbortController | null>(null);
  const suggestions = context.type === "capacitacion" ? ["¿Cuándo abre?", "¿Coincide conmigo?", "Resumir", "Agregar a agenda"] : context.type === "vacante" ? ["¿Coincide conmigo?", "Explicarme requisitos", "Guardar", "Agregar fecha"] : context.type === "agenda" ? ["¿Qué tengo hoy?", "Esta semana", "Próximo evento"] : ["¿Qué hay para mí?", "¿Qué abre esta semana?", "Mis próximos eventos", "Últimas novedades"];

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    void fetch("/api/ai", { headers: headers() }).then((response) => response.json()).then((result: { configured?: boolean }) => setConfigured(Boolean(result.configured))).catch(() => setConfigured(false));
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close);
  }, [open, onClose]);

  useEffect(() => { if (open) endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sending, open]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const send = async (suggestion?: string) => {
    const question = (suggestion || input).trim(); if (!question || sending || configured !== true) return;
    const userMessage: Message = { role: "user", content: question }, history = messages.filter((item) => item !== welcome).map(({ role, content }) => ({ role, content }));
    const action: PendingAction | null = /\b(agend|agregar fecha)/i.test(question) ? { action: "agenda", label: "agregar a tu agenda" } : /\b(record|avis)/i.test(question) ? { action: "remind", label: "configurar un recordatorio" } : /\b(guard)/i.test(question) ? { action: "save", label: "guardar esta publicación" } : null;
    if (action) {
      setMessages((current) => [...current, userMessage, { role: "assistant", content: context.id ? `Voy a ${action.label}:\n\n${context.title || "la publicación seleccionada"}\n\n¿Confirmás?` : "Abrí primero el detalle de una publicación para realizar esa acción." }]);
      setInput(""); if (context.id) setPendingAction(action); return;
    }
    const controller = new AbortController(); abortRef.current = controller;
    setMessages((current) => [...current, userMessage]); setInput(""); setRetryQuestion(""); setSending(true);
    try {
      const response = await fetch("/api/ai/chat", { method: "POST", headers: headers(), signal: controller.signal, body: JSON.stringify({ message: question, history, useProfile, context }) });
      const result = await response.json() as { answer?: string; error?: string; warning?: string; sources?: Source[] };
      const content = response.status === 503 ? "DocenteTuc IA se encuentra temporalmente en configuración." : `${result.warning ? `${result.warning}\n\n` : ""}${result.answer || result.error || "No pude responder en este momento."}`;
      setMessages((current) => [...current, { role: "assistant", content, sources: result.sources }]);
      if (!response.ok && response.status !== 503) setRetryQuestion(question);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") setMessages((current) => [...current, { role: "assistant", content: "Consulta cancelada." }]);
      else { setMessages((current) => [...current, { role: "assistant", content: "DocenteTuc IA no pudo conectarse. Probá nuevamente." }]); setRetryQuestion(question); }
    } finally { if (abortRef.current === controller) abortRef.current = null; setSending(false); }
  };

  const confirmAction = async () => {
    if (!pendingAction) return;
    const current = pendingAction; setPendingAction(null);
    try { await onAction(current.action, context); setMessages((messages) => [...messages, { role: "assistant", content: current.action === "remind" ? "Abrí la configuración del recordatorio para que elijas cuándo querés recibirlo." : "Listo, la acción fue realizada." }]); }
    catch { setMessages((messages) => [...messages, { role: "assistant", content: "No pude realizar la acción. Probá nuevamente." }]); }
  };

  return <aside aria-hidden={!open} aria-label="DocenteTuc IA" className={`ai-panel ai-panel-${mode} ${open ? "translate-x-0 visible" : "translate-x-full invisible pointer-events-none"}`}>
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/15 bg-gradient-to-r from-[#063967] to-[#0878be] p-5 text-white"><div className="flex min-w-0 items-center gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/15"><Sparkles className="size-5" /></span><div className="min-w-0"><h2 className="truncate text-lg font-black">✨ DocenteTuc IA</h2><p className="text-sm text-[#d6f2ff]">Asistente docente</p></div></div><div className="flex shrink-0 items-center gap-1"><button onClick={onMinimize} aria-label="Minimizar DocenteTuc IA" className="grid size-10 place-items-center rounded-xl bg-white/10 hover:bg-white/20"><Minus className="size-5" /></button><button onClick={onExpand} aria-label="Expandir DocenteTuc IA" className="grid size-10 place-items-center rounded-xl bg-white/10 hover:bg-white/20"><Maximize2 className="size-4" /></button><button ref={closeRef} onClick={onClose} aria-label="Cerrar DocenteTuc IA" className="grid size-10 place-items-center rounded-xl bg-white/10 hover:bg-white/20"><X className="size-5" /></button></div></header>
    <div className="border-b border-[var(--border)] bg-[var(--surface-glass)] px-5 py-3 text-xs font-bold text-[var(--text-secondary)] backdrop-blur-md">Contexto: {context.title || context.type}</div>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">{messages.map((message, index) => <div key={index} className={`max-w-[90%] rounded-2xl p-4 shadow-sm ${message.role === "user" ? "ml-auto bg-[#0878be] text-[var(--text-on-accent)]" : "border border-[var(--border)] bg-[var(--surface-primary)] text-[var(--text-primary)] backdrop-blur-md"}`}><p className="whitespace-pre-line text-sm leading-relaxed">{message.content}</p>{message.sources?.length ? <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3"><strong className="block text-xs uppercase tracking-wide">Fuentes</strong>{message.sources.map((source, sourceIndex) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer" className="block rounded-xl bg-[var(--surface-secondary)] p-3 text-xs text-[var(--text-secondary)]"><strong className="block">[{sourceIndex + 1}] {source.title}</strong><span className="block">{source.source} · {source.sourceType === "official" ? "Fuente oficial" : source.sourceType === "internal" ? "DocenteTuc" : "Fuente complementaria"}</span>{source.updatedAt && <span className="block">Actualizado: {new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date(source.updatedAt))}</span>}<span className="mt-1 block font-bold text-[var(--accent-text)]">Ver fuente oficial</span></a>)}</div> : null}</div>)}{pendingAction && !sending && <div className="flex gap-2"><Button onClick={() => void confirmAction()} className="bg-[#0878be] text-[var(--text-on-accent)]">Confirmar</Button><Button variant="outline" onClick={() => { setPendingAction(null); setMessages((messages) => [...messages, { role: "assistant", content: "Acción cancelada." }]); }}>Cancelar</Button></div>}{configured === false && <div className="rounded-2xl border border-[var(--warning-border)] bg-[var(--warning-bg)] p-4 text-sm font-semibold text-[var(--warning-text)]">DocenteTuc IA se encuentra temporalmente en configuración.</div>}{sending && <div className="w-fit rounded-2xl border border-[var(--border)] bg-[var(--surface-primary)] p-4 text-sm text-[var(--text-muted)]"><p>DocenteTuc IA está pensando...</p><button type="button" onClick={() => abortRef.current?.abort()} className="mt-2 font-bold text-[var(--accent-text)]">Cancelar</button></div>}{retryQuestion && !sending && <button type="button" onClick={() => void send(retryQuestion)} className="flex items-center gap-2 rounded-xl bg-[var(--accent-soft)] px-4 py-2 text-sm font-bold text-[var(--accent-text)]"><RotateCcw className="size-4" />Reintentar</button>}<div ref={endRef} /></div>
    <footer className="shrink-0 border-t border-[var(--border)] bg-[var(--surface-glass)] p-4 backdrop-blur-lg"><div className="mb-3 flex gap-2 overflow-x-auto pb-1">{suggestions.map((suggestion) => <button key={suggestion} disabled={configured !== true} onClick={() => void send(suggestion)} className="shrink-0 rounded-full bg-[var(--accent-soft)] px-3 py-2 text-xs font-bold text-[var(--accent-text)] disabled:opacity-45">{suggestion}</button>)}</div><label className="mb-3 flex items-center justify-between gap-3 rounded-xl bg-[var(--surface-secondary)] p-3 text-sm"><span><strong className="block">Usar mi perfil docente</strong><small className="text-[var(--text-muted)]">Sólo con tu autorización.</small></span><Switch checked={useProfile} onCheckedChange={setUseProfile} disabled={!profileAvailable || configured !== true} /></label><form onSubmit={(event) => { event.preventDefault(); void send(); }} className="flex gap-2"><Textarea value={input} disabled={configured !== true} onChange={(event) => setInput(event.target.value.slice(0, 1000))} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Preguntame algo..." className="min-h-12 resize-none rounded-2xl border-[var(--border)] bg-[var(--input-background)]" /><Button type="submit" disabled={configured !== true || sending || !input.trim()} size="icon" className="size-12 shrink-0 rounded-2xl bg-[#0878be] text-white"><Send className="size-5" /><span className="sr-only">Enviar</span></Button></form></footer>
  </aside>;
}
