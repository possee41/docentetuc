"use client";

import { ShieldCheck } from "lucide-react";

export function CommunityRulesCard({ version, text, checked, busy, onCheckedChange, onAccept }: {
  version: string;
  text: string;
  checked: boolean;
  busy: boolean;
  onCheckedChange: (checked: boolean) => void;
  onAccept: () => void;
}) {
  return <section className="mb-4 min-w-0 rounded-[1.6rem] border border-sky-200 bg-white p-4 shadow-[0_10px_30px_rgba(17,79,125,.07)] sm:p-5" aria-labelledby="community-rules-heading">
    <div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-sky-50 text-sky-700"><ShieldCheck className="size-5" /></span><div className="min-w-0"><p className="text-xs font-black uppercase tracking-[.14em] text-sky-700">Antes de participar</p><h2 id="community-rules-heading" className="mt-1 text-lg font-black">Normas de la Comunidad · versión {version}</h2></div></div>
    <div role="region" aria-label="Texto completo de las Normas de Comunidad" tabIndex={0} className="mt-4 max-h-48 overflow-y-auto rounded-xl border border-sky-100 bg-sky-50/50 p-3 text-sm leading-relaxed text-slate-700 break-words focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600 sm:max-h-56 sm:p-4"><p className="whitespace-pre-wrap first-line:font-bold first-line:text-[#0b2c5a]">{text}</p></div>
    <label className="mt-4 flex min-h-11 items-start gap-3 border-t border-slate-100 pt-4 text-sm font-semibold text-slate-700"><input type="checkbox" checked={checked} onChange={(event) => onCheckedChange(event.target.checked)} className="mt-0.5 size-5 shrink-0 accent-sky-600" />Leí y acepto las Normas de Comunidad vigentes.</label>
    <button type="button" disabled={!checked || busy} onClick={onAccept} className="mt-3 min-h-11 w-full rounded-xl bg-[#0878be] px-5 font-bold text-white shadow-sm hover:bg-[#0669a8] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">{busy ? "Guardando…" : "Aceptar y continuar"}</button>
  </section>;
}
