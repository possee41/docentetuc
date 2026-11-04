import { getD1 } from "@/db";
import { fetchNewsFeed, importNewsCandidates, NEWS_FEEDS } from "@/lib/news-discovery";
import type { CommunityDatabase } from "@/lib/community";
import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

// Authenticated internal endpoint for RSS news discovery.
// Writes candidates only; never publishes, approves or notifies.
// Requires NEWS_DISCOVERY_SECRET in env and Bearer token in Authorization header.
export async function POST(request: Request) {
  const secret = (env as { NEWS_DISCOVERY_SECRET?: string }).NEWS_DISCOVERY_SECRET;
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!secret || !token || token !== secret) {
    return Response.json({ error: "No autorizado." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const database = getD1() as unknown as CommunityDatabase;
  // Verify news tables exist.
  try { await database.prepare("SELECT 1 FROM news_items LIMIT 1").bind().first(); }
  catch { return Response.json({ error: "Esquema de noticias no disponible." }, { status: 503, headers: { "Cache-Control": "no-store" } }); }

  const body = await request.json().catch(() => ({})) as { maxCandidates?: number; feeds?: string[] };
  const maxCandidates = Math.min(20, Math.max(1, Number(body.maxCandidates) || 5));
  const feedsFilter = Array.isArray(body.feeds) ? body.feeds.filter((f) => typeof f === "string") : null;
  const selectedFeeds = feedsFilter
    ? NEWS_FEEDS.filter((f) => feedsFilter.includes(f.key))
    : NEWS_FEEDS;
  if (selectedFeeds.length === 0) {
    return Response.json({ error: "No hay fuentes válidas." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const now = new Date();
  const allArticles = [];
  const feedResults = [];
  for (const feed of selectedFeeds) {
    try {
      const articles = await fetchNewsFeed(feed, fetch, now);
      const selected = articles.slice(0, maxCandidates);
      allArticles.push(...selected);
      feedResults.push({ feed: feed.key, status: "OK", discovered: articles.length, selected: selected.length });
    } catch (error) {
      feedResults.push({ feed: feed.key, status: "ERROR", code: error instanceof Error ? error.message : "UNKNOWN", discovered: 0, selected: 0 });
    }
  }
  const capped = allArticles.slice(0, maxCandidates);

  try {
    const result = await importNewsCandidates(database, capped, now, maxCandidates);
    return Response.json({
      status: "OK",
      feeds: feedResults,
      maxCandidates,
      totalDiscovered: allArticles.length,
      capped: capped.length,
      result,
      autoPublish: false,
      notifications: false,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[news-discovery] import failed", error);
    return Response.json({ error: "Error al importar candidatas." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function GET() {
  return Response.json({ error: "Método no permitido." }, { status: 405, headers: { "Cache-Control": "no-store" } });
}
