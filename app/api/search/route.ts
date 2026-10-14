import { getD1 } from "@/db";
import { PUBLICATION_SEARCH_PAGE_SIZE, publicationSearchQuery, searchCursor } from "@/lib/publication-search";
import type { Publication } from "@/lib/types";

export const dynamic = "force-dynamic";

// Searches public publications only. No session, installation or private table is consulted.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() || "";
  const cursor = url.searchParams.get("cursor") || "";
  if (!query) return Response.json({ items: [], nextCursor: null });
  if (cursor.length > 512) return Response.json({ error: "Cursor inválido." }, { status: 400 });
  let search: ReturnType<typeof publicationSearchQuery>;
  try { search = publicationSearchQuery(query, cursor); }
  catch { return Response.json({ error: "Búsqueda inválida." }, { status: 400 }); }
  try {
    const rows = await getD1().prepare(search.sql).bind(...search.params).all<Publication>();
    const items = rows.results.slice(0, PUBLICATION_SEARCH_PAGE_SIZE);
    return Response.json({ items, nextCursor: rows.results.length > PUBLICATION_SEARCH_PAGE_SIZE ? searchCursor(items.at(-1)!) : null });
  } catch (error) {
    console.error("[api/search] GET failed", error);
    return Response.json({ error: "No pudimos buscar publicaciones en este momento." }, { status: 503 });
  }
}
