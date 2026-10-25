import { getD1 } from "@/db";
import type { Publication } from "@/lib/types";
import { boardPageQuery, BOARD_PAGE_SIZE } from "@/lib/board-page";
import type { JuntaId } from "@/lib/juntas";

export const dynamic = "force-dynamic";

// Public documents only; no installation, profile, session or saved-data lookup.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const cursor = params.get("cursor") || "";
  const junta = (params.get("junta") || "todas") as JuntaId | "todas";
  if (cursor.length > 256) return Response.json({ error: "Cursor inválido." }, { status: 400 });
  let query;
  try { query = boardPageQuery("padrones", junta); }
  catch { return Response.json({ error: "Junta inválida." }, { status: 400 }); }
  try {
    const rows = await getD1().prepare(query.sql).bind(cursor, ...query.binds).all<Publication>();
    const items = rows.results.slice(0, BOARD_PAGE_SIZE);
    return Response.json({ items, nextCursor: rows.results.length > BOARD_PAGE_SIZE ? items.at(-1)?.id : null },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[api/boards/padrones] GET failed", error);
    return Response.json({ error: "No pudimos consultar los padrones." }, { status: 503 });
  }
}
