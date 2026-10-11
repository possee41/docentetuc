import { getD1 } from "@/db";
import type { Publication } from "@/lib/types";
import { PADRON_PAGE_QUERY } from "@/lib/padron-documents";

export const dynamic = "force-dynamic";

// Public documents only; no installation, profile, session or saved-data lookup.
export async function GET(request: Request) {
  const cursor = new URL(request.url).searchParams.get("cursor") || "";
  if (cursor.length > 256) return Response.json({ error: "Cursor inválido." }, { status: 400 });
  try {
    const rows = await getD1().prepare(PADRON_PAGE_QUERY).bind(cursor).all<Publication>();
    const items = rows.results.slice(0, 200);
    return Response.json({ items, nextCursor: rows.results.length > 200 ? items.at(-1)?.id : null });
  } catch (error) {
    console.error("[api/boards/padrones] GET failed", error);
    return Response.json({ error: "No pudimos consultar los padrones." }, { status: 503 });
  }
}
