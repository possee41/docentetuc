import { ExternalLink, FolderOpen } from 'lucide-react';
import { JUNTA_EXTERNAL_SOURCES } from '../lib/junta-external-sources';

export function PadronesSection() {
  return <section aria-labelledby="padrones-title" className="space-y-6 pb-16 md:pb-0">
    <header className="space-y-2">
      <p className="text-xs font-bold uppercase tracking-widest text-[var(--accent-text)]">Juntas de Clasificación</p>
      <h1 id="padrones-title" className="text-3xl font-black tracking-tight text-[var(--text-primary)] sm:text-4xl">Padrones 2026</h1>
      <p className="max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">Accedé al Drive principal de tu Junta y consultá allí los documentos de 2026.</p>
    </header>
    <div className="grid gap-4 md:grid-cols-2">
      {JUNTA_EXTERNAL_SOURCES.filter(source => source[1] === 'Padrones').map(source => <article key={source[0]} className="flex min-w-0 flex-col rounded-3xl border border-[var(--border)] bg-[var(--surface-primary)] p-5 shadow-sm sm:p-6">
        <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-[#eaf5fc] text-[#0878be]" aria-hidden="true"><FolderOpen className="size-6" /></div>
        <h2 className="text-xl font-bold leading-snug text-[var(--text-primary)]">{source[2]}</h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">Consultá las publicaciones en el Drive oficial.</p>
        <a href={source[3]} target="_blank" rel="noreferrer" className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#0878be] px-4 py-3 text-center text-sm font-bold text-white transition-colors hover:bg-[#06649f] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0878be]" aria-label={`Abrir Drive oficial de ${source[2]}`}>Abrir Drive oficial <ExternalLink className="size-4 shrink-0" aria-hidden="true" /></a>
      </article>)}
    </div>
    <p className="text-sm leading-relaxed text-[var(--text-secondary)]">Verificá el tipo de trámite y la vigencia en la fuente oficial: ascensos, concursos e interinatos y suplencias son procedimientos distintos.</p>
  </section>;
}
