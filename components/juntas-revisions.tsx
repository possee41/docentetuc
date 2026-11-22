"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { padronFacts } from "@/lib/padron-documents";
import type { Publication } from "@/lib/types";

type Revision = { revision: number; recordedAt: string; snapshot: Publication };
export function JuntaRevisions({ publicationId }: { publicationId: string }) {
  const [items, setItems] = useState<Revision[]>([]), [opened, setOpened] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [sourceCheckedAt, setSourceCheckedAt] = useState<string | null>(null);
  async function load(next = "") {
    setLoading(true); setError(""); setOpened(true);
    try {
      const response = await fetch(`/api/boards/revisions?id=${encodeURIComponent(publicationId)}&cursor=${encodeURIComponent(next)}`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw Error();
      const page = await response.json() as { items: Revision[]; nextCursor: string | null; sourceLastCompleteCheckAt: string | null };
      setItems(previous => next ? [...previous, ...page.items.filter(row => !previous.some(old => old.revision === row.revision))] : page.items);
      setCursor(page.nextCursor);
      setSourceCheckedAt(page.sourceLastCompleteCheckAt);
    } catch { setError("No pudimos consultar las revisiones. La fuente oficial sigue disponible."); }
    finally { setLoading(false); }
  }
  return <div className="mt-3 text-sm">
    <Button variant="outline" disabled={loading} onClick={() => opened ? setOpened(false) : void load()}>Historial de revisiones</Button>
    {opened && <div className="mt-2 space-y-2 text-[var(--text-secondary)]">
      <p>Revisiones registradas desde la habilitación del historial. El enlace oficial puede mostrar una versión posterior.</p>
      {sourceCheckedAt && <p>Última comprobación completa de esta fuente: {new Date(sourceCheckedAt).toLocaleString("es-AR", { timeZone: "America/Argentina/Tucuman" })}.</p>}
      {items.map(row => <details key={row.revision}><summary>{row.snapshot.title} · Registrada: {new Date(row.recordedAt).toLocaleString("es-AR", { timeZone: "America/Argentina/Tucuman" })}</summary>
        {row.snapshot.category === "Padrones" && <p>{padronFacts(row.snapshot).type} · {padronFacts(row.snapshot).year ?? "Año no determinado"}. Revisión histórica; no acredita vigencia actual.</p>}
        <p className="whitespace-pre-wrap">{row.snapshot.summary}</p></details>)}
      {loading && <p role="status">Consultando revisiones…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && !items.length && <p>No hay revisiones registradas todavía.</p>}
      {cursor && !loading && !error && <Button variant="outline" onClick={() => void load(cursor)}>Más revisiones</Button>}
    </div>}
  </div>;
}
