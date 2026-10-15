import type { CommunityDatabase } from "./community.ts";
import { isNewsRelevance, normalizeNewsSourceUrl } from "./news-editorial.ts";

export type PublicNewsSource = {
  name: string; title: string; url: string; type: "official" | "public" | "union" | "media";
  publishedAt: string | null; withdrawn: boolean;
};
export type PublicNewsItem = {
  id: string; title: string; summary: string; topic: string | null;
  relevance: "informativa" | "importante" | "urgente"; featured: boolean;
  publishedAt: string; validFrom: string | null; validUntil: string | null;
  primarySource: PublicNewsSource;
};

type NewsRow = {
  id: string; title: string; summary: string; topic: string | null; relevance: PublicNewsItem["relevance"];
  featured: number; publishedAt: string; validFrom: string | null; validUntil: string | null;
  sourceName: string; sourceTitle: string; sourceUrl: string; sourceType: PublicNewsSource["type"];
  sourcePublishedAt: string | null;
};
type SourceRow = { name: string; title: string; url: string; type: PublicNewsSource["type"];
  publishedAt: string | null; removedAt: string | null };

export const NEWS_PAGE_SIZE = 12;
const publicFrom = `FROM news_items n
  JOIN news_sources main ON main.news_item_id=n.id AND main.is_primary=1
  LEFT JOIN publications main_publication ON main_publication.id=main.publication_id`;
const publicWhere = `n.status='published' AND n.published_at IS NOT NULL AND n.published_at<=?
  AND (n.valid_from IS NULL OR n.valid_from<=?) AND (n.valid_until IS NULL OR n.valid_until>?)
  AND n.replaced_by_news_id IS NULL AND main_publication.removed_at IS NULL
  AND main.url LIKE 'https://%' AND trim(n.editorial_title)<>'' AND trim(n.editorial_summary)<>''`;
const columns = `n.id,n.editorial_title AS title,n.editorial_summary AS summary,n.topic,n.relevance,n.featured,
  n.published_at AS publishedAt,n.valid_from AS validFrom,n.valid_until AS validUntil,
  main.source_name AS sourceName,main.source_title AS sourceTitle,main.url AS sourceUrl,
  main.source_type AS sourceType,main.source_published_at AS sourcePublishedAt`;
const visibleAt = (now: Date) => [now.toISOString(), now.toISOString(), now.toISOString()];
const source = (row: SourceRow): PublicNewsSource => ({ name: row.name, title: row.title, url: row.url,
  type: row.type, publishedAt: row.publishedAt, withdrawn: Boolean(row.removedAt) });
const item = (row: NewsRow): PublicNewsItem => ({ id: row.id, title: row.title, summary: row.summary, topic: row.topic,
  relevance: row.relevance, featured: Boolean(row.featured), publishedAt: row.publishedAt, validFrom: row.validFrom,
  validUntil: row.validUntil, primarySource: source({ name: row.sourceName, title: row.sourceTitle,
    url: row.sourceUrl, type: row.sourceType, publishedAt: row.sourcePublishedAt, removedAt: null }) });

export async function listPublicNews(database: CommunityDatabase, params: URLSearchParams, now = new Date()) {
  const home = params.get("home") === "1", pageText = params.get("page") || "0";
  if (!/^\d{1,3}$/.test(pageText) || Number(pageText) > 100) throw new RangeError("Página inválida.");
  const page = Number(pageText), q = (params.get("q") || "").trim(), topic = (params.get("topic") || "").trim();
  const relevance = params.get("relevance") || "";
  if (q.length > 100 || topic.length > 80 || relevance && !isNewsRelevance(relevance)) throw new RangeError("Filtro inválido.");
  const values: unknown[] = visibleAt(now);
  let where = publicWhere;
  if (home) {
    const excluded = (params.get("exclude") || "").split(",").filter(Boolean);
    if (excluded.length > 8 || excluded.some((id) => id.length > 240)) throw new RangeError("Filtro inválido.");
    where += " AND (n.featured=1 OR n.relevance IN ('importante','urgente'))";
    if (excluded.length) { where += ` AND (n.origin_publication_id IS NULL OR n.origin_publication_id NOT IN (${excluded.map(() => "?").join(",")}))`; values.push(...excluded); }
    const rows = await database.prepare(`SELECT ${columns} ${publicFrom} WHERE ${where}
      ORDER BY CASE n.relevance WHEN 'urgente' THEN 0 WHEN 'importante' THEN 1 ELSE 2 END,
      n.featured DESC,n.published_at DESC,n.id DESC LIMIT 12`).bind(...values).all<NewsRow>();
    const ranked = rows.results || [];
    return { items: [...ranked.filter((row) => row.relevance === "urgente").slice(0, 1),
      ...ranked.filter((row) => row.relevance !== "urgente").slice(0, 2)].map(item) };
  }
  if (topic) { where += " AND n.topic=?"; values.push(topic); }
  if (relevance) { where += " AND n.relevance=?"; values.push(relevance); }
  if (q) { where += " AND (n.editorial_title LIKE ? OR n.editorial_summary LIKE ?)"; values.push(`%${q}%`, `%${q}%`); }
  const [rows, topics] = await Promise.all([
    database.prepare(`SELECT ${columns} ${publicFrom} WHERE ${where}
      ORDER BY n.featured DESC,n.published_at DESC,n.id DESC LIMIT ? OFFSET ?`)
      .bind(...values, NEWS_PAGE_SIZE + 1, page * NEWS_PAGE_SIZE).all<NewsRow>(),
    database.prepare(`SELECT DISTINCT n.topic ${publicFrom} WHERE ${publicWhere}
      AND n.topic IS NOT NULL AND trim(n.topic)<>'' ORDER BY n.topic LIMIT 40`)
      .bind(...visibleAt(now)).all<{ topic: string }>(),
  ]);
  const results = rows.results || [];
  return { items: results.slice(0, NEWS_PAGE_SIZE).map(item), nextPage: results.length > NEWS_PAGE_SIZE ? page + 1 : null,
    topics: (topics.results || []).map((row) => row.topic) };
}

export async function publicNewsDetail(database: CommunityDatabase, newsId: string, now = new Date()) {
  if (!newsId || newsId.length > 80) return null;
  const row = await database.prepare(`SELECT ${columns} ${publicFrom} WHERE ${publicWhere} AND n.id=?`)
    .bind(...visibleAt(now), newsId).first<NewsRow>();
  if (!row || !normalizeNewsSourceUrl(row.sourceUrl)) return null;
  const sources = await database.prepare(`SELECT s.source_name AS name,s.source_title AS title,s.url,
    s.source_type AS type,s.source_published_at AS publishedAt,p.removed_at AS removedAt
    FROM news_sources s LEFT JOIN publications p ON p.id=s.publication_id
    WHERE s.news_item_id=? ORDER BY s.is_primary DESC,s.position,s.created_at`)
    .bind(newsId).all<SourceRow>();
  return { ...item(row), sources: (sources.results || []).filter((entry) => normalizeNewsSourceUrl(entry.url)).map(source) };
}
