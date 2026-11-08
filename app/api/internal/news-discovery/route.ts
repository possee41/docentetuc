import { getD1 } from "@/db";
import { importNewsCandidates, NEWS_FEEDS, type DiscoveredArticle } from "@/lib/news-discovery";
import type { CommunityDatabase } from "@/lib/community";
import { env } from "cloudflare:workers";
import { isPrivateOrLoopbackHost, normalizeNewsSourceUrl } from "@/lib/news-editorial";

export const dynamic = "force-dynamic";

// Authenticated internal endpoint for RSS news discovery.
// Receives pre-parsed articles from GitHub Actions (processing happens there).
// Validates and persists candidates only; never fetches feeds, parses XML,
// publishes, approves or notifies.
// Requires NEWS_DISCOVERY_SECRET in env and Bearer token in Authorization header.

const MAX_CANDIDATES = 5;
const MAX_ARTICLES_PER_REQUEST = 20;

type ArticleInput = {
  feedKey?: unknown;
  title?: unknown;
  url?: unknown;
  publishedAt?: unknown;
  updatedAt?: unknown;
  fingerprint?: unknown;
};

function validateArticle(input: ArticleInput): DiscoveredArticle | null {
  if (!input || typeof input !== "object") return null;
  const feed = NEWS_FEEDS.find((f) => f.key === input.feedKey);
  if (!feed) return null;
  if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 160) return null;
  const url = normalizeNewsSourceUrl(input.url);
  if (!url) return null;
  try { if (isPrivateOrLoopbackHost(new URL(url).hostname)) return null; } catch { return null; }
  if (new URL(url).hostname !== feed.host) return null;
  if (typeof input.publishedAt !== "string" || Number.isNaN(Date.parse(input.publishedAt))) return null;
  if (typeof input.updatedAt !== "string" || Number.isNaN(Date.parse(input.updatedAt))) return null;
  if (typeof input.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(input.fingerprint)) return null;
  return {
    feed,
    title: input.title.trim(),
    url,
    publishedAt: new Date(input.publishedAt).toISOString(),
    updatedAt: new Date(input.updatedAt).toISOString(),
    fingerprint: input.fingerprint,
  };
}

export async function POST(request: Request) {
  const secret = ((env as { NEWS_DISCOVERY_SECRET?: string }).NEWS_DISCOVERY_SECRET
    || (typeof process !== "undefined" ? process.env?.NEWS_DISCOVERY_SECRET : undefined))?.trim();
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!secret || !token || token !== secret) {
    return Response.json({ error: "No autorizado." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const database = getD1() as unknown as CommunityDatabase;
  try { await database.prepare("SELECT 1 FROM news_items LIMIT 1").bind().first(); }
  catch { return Response.json({ error: "Esquema de noticias no disponible." }, { status: 503, headers: { "Cache-Control": "no-store" } }); }

  let body: { articles?: unknown; maxCandidates?: unknown };
  try { body = await request.json(); }
  catch { return Response.json({ error: "JSON inválido." }, { status: 400, headers: { "Cache-Control": "no-store" } }); }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Cuerpo inválido." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (!Array.isArray(body.articles)) {
    return Response.json({ error: "Se requiere 'articles' (array)." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (body.articles.length > MAX_ARTICLES_PER_REQUEST) {
    return Response.json({ error: "Demasiados artículos." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const articles = [];
  for (const raw of body.articles) {
    const validated = validateArticle(raw as ArticleInput);
    if (!validated) {
      return Response.json({ error: "Artículo inválido o no autorizado." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    articles.push(validated);
  }

  const rawMax = Number(body.maxCandidates);
  const maxCandidates = Math.min(MAX_CANDIDATES, Math.max(1, Number.isFinite(rawMax) ? rawMax : MAX_CANDIDATES));

  try {
    const result = await importNewsCandidates(database, articles, new Date(), maxCandidates);
    return Response.json({
      status: "OK",
      maxCandidates,
      totalReceived: articles.length,
      capped: Math.min(articles.length, maxCandidates),
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
