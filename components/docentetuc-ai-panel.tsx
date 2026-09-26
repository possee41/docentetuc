"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { AIContext } from "@/components/app-chrome";

type Source = { id: string; title: string; source: string; url: string; updatedAt: string; status: string };
type Message = { role: "user" | "assistant"; content: string; sources?: Source[] };

export function DocenteTucAIChatPanel({ open, onClose, context, profileAvailable, headers }: { open: boolean; onClose: () => void; context: AIContext; profileAvailable: boolean; headers: () => Record<string, string> }) {
  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", content: "Hola 👋\nSoy el asistente de DocenteTuc. Puedo ayudarte a encontrar capacitaciones, designaciones, novedades, fechas y organizar tu actividad docente." }]);
  const [input, setInput] = useState(""), [sending, setSending] = useState(false), [useProfile, setUseProfile] = useState(false), [configured, setConfigured] = useState<boolean | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const suggestions = ["Capacitaciones próximas", "¿Qué abre esta semana?", "Buscar designaciones", "Mis próximos eventos", "Últimas novedades"];

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    void fetch("/api/ai", { headers: headers() }).then((response) => response.json()).then((result: { configured?: boolean }) => setConfigured(Boolean(result.configured))).catch(() => setConfigured(false));
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close);
  }, [open, onClose]);

  const send = async (suggestion?: string) => {
    const question = (suggestion || input).trim(); if (!question || sending || configured !== true) return;
    const userMessage: Message = { role: "user", content: question }, history = messages.filter((item) => item !== messages[0]).map(({ role, content }) => ({ role, content }));
    setMessages((current) => [...current, userMessage]); setInput(""); setSending(true);
    try {
      const response = await fetch("/api/ai", { method: "POST", headers: headers(), body: JSON.stringify({ message: question, history, useProfile }) });
      const result = await response.json() as { answer?: string; error?: string; sources?: Source[] };
      setMessages((current) => [...current, { role: "assistant", content: response.status === 503 ? "El asistente se encuentra temporalmente en configuración." : result.answer || result.error || "No pude responder en este momento.", sources: result.sources }]);
    } catch { setMessages((current) => [...current, { role: "assistant", content: "DocenteTuc IA no pudo conectarse. Probá nuevamente." }]); }
    finally { setSending(false); }
  };

  return <aside aria-hidden={!open} aria-label="DocenteTuc IA" className={`ai-panel ${open ? "translate-x-0 visible" : "translate-x-full invisible pointer-events-none"}`}>
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/15 bg-gradient-to-r from-[#063967] to-[#0878be] p-5 text-white"><div className="flex min-w-0 items-center gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/15"><Sparkles className="size-5" /></span><div className="min-w-0"><h2 className="truncate text-lg font-black">✨ DocenteTuc IA</h2><p className="text-sm text-[#d6f2ff]">Asistente docente</p></div></div><button ref={closeRef} onClick={onClose} aria-label="Cerrar DocenteTuc IA" className="grid size-11 shrink-0 place-items-center rounded-xl bg-white/10 hover:bg-white/20"><X className="size-5" /></button></header>
    <div className="border-b border-[#c8e1f1] bg-[#eaf6fd]/90 px-5 py-3 text-xs font-bold text-[#315d7a]">Contexto: {context.title || context.type}</div>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">{messages.map((message, index) => <div key={index} className={`max-w-[90%] rounded-2xl p-4 ${message.role === "user" ? "ml-auto bg-[#0878be] text-white" : "border border-[#c8e1f1] bg-white/80 text-[#062b55]"}`}><p className="whitespace-pre-line text-sm leading-relaxed">{message.content}</p>{message.sources?.length ? <div className="mt-3 space-y-2 border-t border-[#c8e1f1] pt-3">{message.sources.map((source, sourceIndex) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer" className="block rounded-xl bg-[#edf6fc] p-3 text-xs text-[#315d7a]"><strong className="block">[{sourceIndex + 1}] {source.title}</strong><span>Fuente oficial: {source.source}</span></a>)}</div> : null}</div>)}{configured === false && <div className="rounded-2xl border border-[#f0d58b] bg-[#fff8e7]/90 p-4 text-sm font-semibold text-[#6f4c00]">El asistente se encuentra temporalmente en configuración.</div>}{sending && <div className="w-fit rounded-2xl border border-[#c8e1f1] bg-white/80 p-4 text-sm text-[#52708c]">Consultando información oficial…</div>}</div>
    <footer className="shrink-0 border-t border-[#c8e1f1] bg-white/85 p-4 backdrop-blur-md"><div className="mb-3 flex gap-2 overflow-x-auto pb-1">{suggestions.map((suggestion) => <button key={suggestion} disabled={configured !== true} onClick={() => void send(suggestion)} className="shrink-0 rounded-full bg-[#edf6fc] px-3 py-2 text-xs font-bold text-[#0878be] disabled:opacity-45">{suggestion}</button>)}</div><label className="mb-3 flex items-center justify-between gap-3 rounded-xl bg-[#edf6fc] p-3 text-sm"><span><strong className="block">Usar mi perfil docente</strong><small className="text-[#52708c]">Sólo con tu autorización.</small></span><Switch checked={useProfile} onCheckedChange={setUseProfile} disabled={!profileAvailable || configured !== true} /></label><form onSubmit={(event) => { event.preventDefault(); void send(); }} className="flex gap-2"><Textarea value={input} disabled={configured !== true} onChange={(event) => setInput(event.target.value.slice(0, 1000))} placeholder="Preguntame algo..." className="min-h-12 resize-none rounded-2xl border-[#bcdcf0]" /><Button type="submit" disabled={configured !== true || sending || !input.trim()} size="icon" className="size-12 shrink-0 rounded-2xl bg-[#0878be] text-white"><Send className="size-5" /><span className="sr-only">Enviar</span></Button></form></footer>
  </aside>;
}
