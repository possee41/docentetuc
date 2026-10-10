"use client";
import type { Publication } from "@/lib/types";
import { officialDateLabel, officialMetadata, readMetadata } from "@/lib/official-publication";

const procedures = { direct: "Presentación directa", online_sime: "Inscripción online por SIME", both: "Inscripción SIME y presentación directa", unknown: "Procedimiento pendiente de verificación" };
const labels: Record<string, string> = { designation: "Designación", publicationStart: "Inicio de publicación", publicationEnd: "Fin de publicación",
  registrationStart: "Inicio de inscripción", registrationEnd: "Cierre de inscripción", location: "Lugar", modality: "Modalidad", instructions: "Instrucciones",
  previousDesignation: "Fecha anterior" };
export function OfficialPublicationSummary({ item }: { item: Publication }) {
  const m = officialMetadata(item);
  if (!m) return null;
  return <div className="mt-3 space-y-1 text-sm">
    {m.entity === "opportunity" && <p className="font-semibold">{procedures[m.procedure]}</p>}
    {m.facts.designation && <p className="font-semibold">Designación: {officialDateLabel(item)}</p>}
    {m.entity === "opportunity" && !item.ends_at && !m.facts.registrationEnd && <p>Vigencia no determinada por la fuente.</p>}
    {m.topics.includes("CLASIFICACION_PENDIENTE") && <p>Clasificación pendiente: no se pudo determinar el procedimiento o la fecha.</p>}
    {m.detailStatus === "PENDING" && <p>Detalle SIME pendiente de recuperación.</p>}
    {m.detailStatus === "STALE" && <p>Detalle SIME conservado del último intento válido; verificar fuente.</p>}
    {m.candidateIds?.length ? <p>Posible relación con otra publicación; todavía no se fusionó.</p> : null}
    {m.issues.filter(x => /conflict/i.test(x)).map(x => <p key={x} className="font-semibold text-amber-800">{x}</p>)}
  </div>;
}
export function OfficialPublicationDetails({ item }: { item: Publication }) {
  const m = officialMetadata(item);
  if (!m) return null;
  const placements = readMetadata(item.metadata).portalPlacements as { junta: string; label: string; url: string }[] | undefined;
  return <section className="space-y-3 rounded-2xl border border-[#dce8e1] p-4">
    <h3 className="font-bold">Datos y evidencia oficial</h3>
    <OfficialPublicationSummary item={item} />
    {Object.entries(m.facts).filter(([key]) => key !== "instructions").map(([key, value]) => <details key={key} className="rounded-xl border p-3">
      <summary className="cursor-pointer text-sm"><strong>{labels[key] || key}:</strong> {key === "designation" ? officialDateLabel(item) : value.value}{value.status === "conflict" && " · fuentes en conflicto"}</summary>
      <ul className="mt-2 space-y-2 text-xs">{value.evidence.map((e, index) => <li key={`${e.id}:${index}`}>
        <a href={e.url} target="_blank" rel="noreferrer" className="font-semibold underline">{e.source}{e.publishedAt ? ` · publicado ${e.publishedAt}` : ""}</a>
        <p className="mt-1 whitespace-pre-line">{e.excerpt}</p>
      </li>)}</ul>
    </details>)}
    {m.issues.length > 0 && <ul className="list-disc space-y-1 pl-4 text-sm">{m.issues.map(x => <li key={x}>{x}</li>)}</ul>}
    {m.sources.length > 0 && <div><h4 className="text-sm font-bold">Fuentes de esta publicación</h4><ul className="mt-1 space-y-1 text-sm">{m.sources.map((s, i) => <li key={`${s.id}:${i}`}><a href={s.url} target="_blank" rel="noreferrer" className="underline">{s.source}{s.publishedAt ? ` · ${s.publishedAt}` : ""} · {s.id}</a></li>)}</ul></div>}
    {Array.isArray(placements) && placements.length > 0 && <div><h4 className="text-sm font-bold">Apariciones en el portal oficial</h4><ul className="mt-1 space-y-1 text-sm">{placements.map((p, i) => <li key={i}><a href={p.url} target="_blank" rel="noreferrer" className="underline">{p.junta} · {p.label}</a></li>)}</ul><p className="mt-2 text-xs">Se conservan los enlaces repetidos tal como aparecen en el portal.</p></div>}
  </section>;
}
