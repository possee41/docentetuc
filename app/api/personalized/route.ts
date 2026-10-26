import { getD1 } from "@/db";
import { authError, currentUser } from "@/lib/current-user";
import { hydrateProfile } from "@/lib/profile";
import { hasPersonalCriteria, personalizedCatalogPage, type PersonalKind } from "@/lib/personalized-catalog";
import { parsePersonalFilters, passesPersonalFilters } from "@/lib/personalized-filters";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const cursor = url.searchParams.get("cursor") || "";
  if (kind !== "vacante" && kind !== "capacitacion" || cursor.length > 180) return Response.json({ error: "Consulta inválida." }, { status: 400 });
  let filters: ReturnType<typeof parsePersonalFilters>;
  try { filters = parsePersonalFilters(url.searchParams, kind); }
  catch { return Response.json({ error: "Filtros inválidos." }, { status: 400 }); }
  try {
    const user = await currentUser(request);
    const db = getD1();
    const row = await db.prepare("SELECT * FROM profiles WHERE user_id=?").bind(user.userId).first<Record<string, unknown>>();
    if (!row) return Response.json({ items: [], nextCursor: null, scanned: 0, profileRequired: true });
    const profile = hydrateProfile(row);
    if (!hasPersonalCriteria(profile, kind)) return Response.json({ items: [], nextCursor: null, scanned: 0, profileRequired: true });
    const page = await personalizedCatalogPage(db, profile, kind as PersonalKind, cursor, new Date(), item => passesPersonalFilters(item, profile, kind, filters));
    return Response.json({ items: page.items, nextCursor: page.nextCursor, scanned: page.scanned }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: authError(error) ? "Iniciá sesión para ver tus coincidencias." : "No pudimos consultar tus coincidencias." }, { status: authError(error) ? 401 : 503 });
  }
}
