import type { Publication } from "./types.ts";
import type { JuntaId } from "./juntas.ts";
import { boardItems } from "./board-view.ts";
import { boardPageQuery, boardCursorBinds, nextBoardCursor, BOARD_PAGE_SIZE, PADRON_PAGE_SIZE, type BoardPageMode, type BoardPageView } from "./board-page.ts";
import { padronCoverage } from "./padron-documents.ts";
import { PUBLICATION_VISIBILITY_SQL, isPublicPublication } from "./publication-visibility.ts";
import { officialMetadata } from "./official-publication.ts";
import { JUNTA_EXTERNAL_SOURCES } from "./junta-external-sources.ts";

// Public documents only; no installation, profile, session or saved-data lookup.
export async function padronesPage(request: Request, getD1: () => D1Database) {
  const params = new URL(request.url).searchParams;
  const cursor = params.get("cursor") || "";
  const junta = (params.get("junta") || "todas") as JuntaId | "todas";
  if (cursor.length > 256) return Response.json({ error: "Cursor inválido." }, { status: 400 });
  let query;
  try { query = boardPageQuery("padrones", junta); }
  catch { return Response.json({ error: "Junta inválida." }, { status: 400 }); }
  try {
    const db=getD1();
    const rows = await db.prepare(query.sql).bind(cursor, ...query.binds).all<Publication>();
    const items = rows.results.slice(0, PADRON_PAGE_SIZE);
    let coverage;
    if(!cursor){
      try{
        const status=await db.prepare("SELECT c.root_id,c.status,c.last_attempt_at,s.sync_status AS category_status FROM juntas_import_checkpoint c LEFT JOIN sync_state s ON s.source='Padrones' WHERE c.root_id IN ('pad-primaria','pad-secundaria','pad-tecnica','pad-superior','probe:pad-primaria','probe:pad-secundaria','probe:pad-tecnica','probe:pad-superior')").all<{root_id:string;status:string;last_attempt_at:string|null;category_status:string|null}>();
        coverage=padronCoverage(status.results,junta);
      }catch{coverage=padronCoverage([],junta);}
    }
    return Response.json({ items, nextCursor: rows.results.length > PADRON_PAGE_SIZE ? items.at(-1)?.id : null, ...(coverage?{coverage}:{}) },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[api/boards/padrones] GET failed", error);
    return Response.json({ error: "No pudimos consultar los padrones." }, { status: 503 });
  }
}

export async function boardPage(request: Request, getD1: () => D1Database) {
  const params = new URL(request.url).searchParams;
  const view = params.get("view") as BoardPageView;
  const junta = (params.get("junta") || "todas") as JuntaId | "todas";
  const mode = (params.get("mode") || "current") as BoardPageMode;
  const cursor = params.get("cursor") || "";
  const search = (params.get("q") || "").trim();
  if (cursor.length > 256 || /[\u0000-\u001f]/.test(cursor)) return Response.json({ error: "Cursor inválido." }, { status: 400 });
  if (search.length > 100) return Response.json({ error: "Búsqueda demasiado larga." }, { status: 400 });
  let query, cursorBinds;
  try { query = boardPageQuery(view, junta, mode, search); cursorBinds = boardCursorBinds(view, cursor); }
  catch { return Response.json({ error: "Filtro inválido." }, { status: 400 }); }
  try {
    const now = new Date();
    const today = query.needsNow ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Tucuman", year: "numeric", month: "2-digit", day: "2-digit" }).format(now) : "";
    const binds = [...cursorBinds, ...(query.needsNow ? [today, today] : []), ...query.binds];
    const rows = (await getD1().prepare(query.sql).bind(...binds).all<Publication>()).results;
    const page = rows.slice(0, BOARD_PAGE_SIZE);
    const items = view === "llamados" && mode === "current" ? boardItems(page, "llamados", now) : page;
    return Response.json({ items, nextCursor: rows.length > BOARD_PAGE_SIZE ? nextBoardCursor(view, page.at(-1)!) : null },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[api/boards] GET failed", error);
    return Response.json({ error: "No pudimos consultar los documentos de Juntas." }, { status: 503 });
  }
}

export async function boardRevisions(request: Request, getD1: () => D1Database) {
  const params = new URL(request.url).searchParams, id = params.get("id") || "", cursor = params.get("cursor") || "";
  if (!/^(?:padrones|drive|notice):[A-Za-z0-9:_-]{1,230}$/.test(id) || cursor && !/^[1-9]\d{0,14}$/.test(cursor))
    return Response.json({ error: "Referencia inválida." }, { status: 400 });
  try {
    const db = getD1();
    const current = await db.prepare(`SELECT id,metadata FROM publications WHERE id=? AND source='Padrones y Comunicados'
      AND kind='junta' AND removed_at IS NULL AND ${PUBLICATION_VISIBILITY_SQL}`).bind(id).first<{ id: string; metadata: string }>();
    if (!current) return Response.json({ error: "No encontrado." }, { status: 404 });
    const rows = (await db.prepare(`SELECT revision_id,recorded_at,snapshot_json FROM juntas_document_revisions
      WHERE publication_id=? AND revision_id<? ORDER BY revision_id DESC LIMIT 6`).bind(id, cursor ? Number(cursor) : Number.MAX_SAFE_INTEGER)
      .all<{ revision_id: number; recorded_at: string; snapshot_json: string }>()).results;
    const page = rows.slice(0, 5);
    const root = (officialMetadata(current)?.sourceRootId || current.id).replace(/^padrones:/, "");
    const sourceCheck = JUNTA_EXTERNAL_SOURCES.some(source => source[0] === root)
      ? await db.prepare("SELECT last_success_at FROM juntas_import_checkpoint WHERE root_id=?").bind(root).first<{ last_success_at: string | null }>() : null;
    return Response.json({ sourceLastCompleteCheckAt: sourceCheck?.last_success_at || null,
      items: page.map(row => ({ revision: row.revision_id, recordedAt: row.recorded_at, snapshot: JSON.parse(row.snapshot_json) }))
        .filter(row => isPublicPublication(row.snapshot)),
      nextCursor: rows.length > 5 ? String(page.at(-1)!.revision_id) : null }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "No pudimos consultar las revisiones." }, { status: 503 });
  }
}

// Native Worker path for existing public reads; no new API or authorization.
export function juntasPublicApi(request: Request, getD1: () => D1Database) {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url);
  if (url.pathname === '/api/boards/padrones') return padronesPage(request, getD1);
  if (url.pathname === '/api/boards/revisions') return boardRevisions(request, getD1);
  if (url.pathname === '/api/boards' && ['padrones', 'comunicados'].includes(url.searchParams.get('view') || '')) return boardPage(request, getD1);
  return null;
}
