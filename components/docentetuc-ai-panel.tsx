"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCcw, Send, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { AIContext } from "@/components/app-chrome";

type Source = { id: string; title: string; source: string; url: string; updatedAt: string; status: string };
type Message = { role: "user" | "assistant"; content: string; sources?: Source[] };

const welcome: Message = { role: "assistant", content: "Hola 👋\nSoy el asistente de DocenteTuc. Puedo ayudarte a encontrar capacitaciones, designaciones, novedades, fechas y organizar tu actividad docente." };

export function DocenteTucAIChatPanel({ open, onClose, context, profileAvailable, headers }: { open: boolean; onClose: () => void; context: AIContext; profileAvailable: boolean; headers: () => Record<string, string> }) {
  const [messages, setMessages] = useState<Message[]>([welcome]);
  const [input, setInput] = useState(""), [sending, setSending] = useState(false), [useProfile, setUseProfile] = useState(false), [configured, setConfigured] = useState<boolean | null>(null), [retryQuestion, setRetryQuestion] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null), endRef = useRef<HTMLDivElement>(null), abortRef = useRef<AbortController | null>(null);
  const suggestions = ["Capacitaciones próximas", "¿Qué abre esta semana?", "Buscar designaciones", "Mis próximos eventos", "Últimas novedades"];

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
    const controller = new AbortController(); abortRef.current = controller;
    setMessages((current) => [...current, userMessage]); setInput(""); setRetryQuestion(""); setSending(true);
    try {
      const response = await fetch("/api/ai/chat", { method: "POST", headers: headers(), signal: controller.signal, body: JSON.stringify({ message: question, history, useProfile, context }) });
      const result = await response.json() as { answer?: string; error?: string; sources?: Source[] };
      const content = response.status === 503 ? "DocenteTuc IA se encuentra temporalmente en configuración." : result.answer || result.error || "No pude responder en este momento.";
      setMessages((current) => [...current, { role: "assistant", content, sources: result.sources }]);
      if (!response.ok && response.status !== 503) setRetryQuestion(question);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") setMessages((current) => [...current, { role: "assistant", content: "Consulta cancelada." }]);
      else { setMessages((current) => [...current, { role: "assistant", content: "DocenteTuc IA no pudo conectarse. Probá nuevamente." }]); setRetryQuestion(question); }
    } finally { if (abortRef.current === controller) abortRef.current = null; setSending(false); }
  };

  return <aside aria-hidden={!open} aria-label="DocenteTuc IA" className={`ai-panel ${open ? "translate-x-0 visible" : "translate-x-full invisible pointer-events-none"}`}>
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/15 bg-gradient-to-r from-[#063967] to-[#0878be] p-5 text-white"><div className="flex min-w-0 items-center gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/15"><Sparkles className="size-5" /></span><div className="min-w-0"><h2 className="truncate text-lg font-black">✨ DocenteTuc IA</h2><p className="text-sm text-[#d6f2ff]">Asistente docente</p></div></div><button ref={closeRef} onClick={onClose} aria-label="Cerrar DocenteTuc IA" className="grid size-11 shrink-0 place-items-center rounded-xl bg-white/10 hover:bg-white/20"><X className="size-5" /></button></header>
    <div className="border-b border-[var(--border)] bg-[var(--surface-glass)] px-5 py-3 text-xs font-bold text-[var(--text-secondary)] backdrop-blur-md">Contexto: {context.title || context.type}</div>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">{messages.map((message, index) => <div key={index} className={`max-w-[90%] rounded-2xl p-4 shadow-sm ${message.role === "user" ? "ml-auto bg-[#0878be] text-white" : "border border-[var(--border)] bg-[var(--surface-primary)] text-[var(--text-primary)] backdrop-blur-md"}`}><p className="whitespace-pre-line text-sm leading-relaxed">{message.content}</p>{message.sources?.length ? <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3"><strong className="block text-xs uppercase tracking-wide">Fuentes</strong>{message.sources.map((source, sourceIndex) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer" className="block rounded-xl bg-[var(--surface-secondary)] p-3 text-xs text-[var(--text-secondary)]"><strong className="block">[{sourceIndex + 1}] {source.title}</strong><span className="block">{source.source}</span><span className="mt-1 block font-bold text-[var(--accent-text)]">Ver fuente oficial</span></a>)}</div> : null}</div>)}{configured === false && <div className="rounded-2xl border border-[#f0d58b] bg-[#fff8e7]/90 p-4 text-sm font-semibold text-[#6f4c00]">DocenteTuc IA se encuentra temporalmente en configuración.</div>}{sending && <div className="w-fit rounded-2xl border border-[var(--border)] bg-[var(--surface-primary)] p-4 text-sm text-[var(--text-muted)]"><p>DocenteTuc IA está pensando...</p><button type="button" onClick={() => abortRef.current?.abort()} className="mt-2 font-bold text-[var(--accent-text)]">Cancelar</button></div>}{retryQuestion && !sending && <button type="button" onClick={() => void send(retryQuestion)} className="flex items-center gap-2 rounded-xl bg-[var(--accent-soft)] px-4 py-2 text-sm font-bold text-[var(--accent-text)]"><RotateCcw className="size-4" />Reintentar</button>}<div ref={endRef} /></div>
    <footer className="shrink-0 border-t border-[var(--border)] bg-[var(--surface-glass)] p-4 backdrop-blur-lg"><div className="mb-3 flex gap-2 overflow-x-auto pb-1">{suggestions.map((suggestion) => <button key={suggestion} disabled={configured !== true} onClick={() => void send(suggestion)} className="shrink-0 rounded-full bg-[var(--accent-soft)] px-3 py-2 text-xs font-bold text-[var(--accent-text)] disabled:opacity-45">{suggestion}</button>)}</div><label className="mb-3 flex items-center justify-between gap-3 rounded-xl bg-[var(--surface-secondary)] p-3 text-sm"><span><strong className="block">Usar mi perfil docente</strong><small className="text-[var(--text-muted)]">Sólo con tu autorización.</small></span><Switch checked={useProfile} onCheckedChange={setUseProfile} disabled={!profileAvailable || configured !== true} /></label><form onSubmit={(event) => { event.preventDefault(); void send(); }} className="flex gap-2"><Textarea value={input} disabled={configured !== true} onChange={(event) => setInput(event.target.value.slice(0, 1000))} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Preguntame algo..." className="min-h-12 resize-none rounded-2xl border-[var(--border)] bg-[var(--input-background)]" /><Button type="submit" disabled={configured !== true || sending || !input.trim()} size="icon" className="size-12 shrink-0 rounded-2xl bg-[#0878be] text-white"><Send className="size-5" /><span className="sr-only">Enviar</span></Button></form></footer>
  </aside>;
}
