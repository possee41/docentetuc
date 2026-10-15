import { getD1 } from "@/db";
import { listPublicNews, publicNewsDetail } from "@/lib/public-news";

export const dynamic = "force-dynamic";

// Public, read-only editorial data. No account, installation or Admin tables are queried.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    if (params.has("id")) {
      const detail = await publicNewsDetail(getD1(), params.get("id") || "");
      return detail ? Response.json(detail, { headers: { "Cache-Control": "no-store" } })
        : Response.json({ error: "Noticia no disponible." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    return Response.json(await listPublicNews(getD1(), params), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RangeError) return Response.json({ error: error.message }, { status: 400 });
    console.error("[api/news] GET failed", error);
    return Response.json({ error: "No pudimos cargar las noticias." }, { status: 503 });
  }
}
