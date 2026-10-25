import { getD1 } from "@/db";
import { boardItems } from "@/lib/board-view";
import { boardPageQuery, BOARD_PAGE_SIZE, type BoardPageMode, type BoardPageView } from "@/lib/board-page";
import type { JuntaId } from "@/lib/juntas";
import type { Publication } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const view = params.get("view") as BoardPageView;
  const junta = (params.get("junta") || "todas") as JuntaId | "todas";
  const mode = (params.get("mode") || "current") as BoardPageMode;
  const cursor = params.get("cursor") || "";
  const search = (params.get("q") || "").trim();
  if (cursor.length > 256 || /[\u0000-\u001f]/.test(cursor)) return Response.json({ error: "Cursor inválido." }, { status: 400 });
  if (search.length > 100) return Response.json({ error: "Búsqueda demasiado larga." }, { status: 400 });
  let query;
  try { query = boardPageQuery(view, junta, mode, search); }
  catch { return Response.json({ error: "Filtro inválido." }, { status: 400 }); }
  try {
    const now = new Date();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Tucuman", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    const binds = [cursor, ...(query.needsNow ? [today, today] : []), ...query.binds];
    const rows = (await getD1().prepare(query.sql).bind(...binds).all<Publication>()).results;
    const page = rows.slice(0, BOARD_PAGE_SIZE);
    const items = view === "llamados" && mode === "current" ? boardItems(page, "llamados", now) : page;
    return Response.json({ items, nextCursor: rows.length > BOARD_PAGE_SIZE ? page.at(-1)?.id : null },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[api/boards] GET failed", error);
    return Response.json({ error: "No pudimos consultar los documentos de Juntas." }, { status: 503 });
  }
}
