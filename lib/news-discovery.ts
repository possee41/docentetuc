import { createHash } from "node:crypto";
import type { CommunityDatabase } from "./community.ts";
import { normalizeNewsSourceUrl } from "./news-editorial.ts";

export const NEWS_FEEDS = [
  { key: "ministry", name: "Ministerio de Educación de Tucumán", type: "official", topic: "Educación", url: "https://www.educaciontuc.gov.ar/feed/", host: "www.educaciontuc.gov.ar", format: "rss" },
  { key: "atep", name: "ATEP Tucumán", type: "union", topic: "Actualidad gremial", url: "https://atep-delosdocentestucumanos.blogspot.com/feeds/posts/default?alt=atom&max-results=10", host: "atep-delosdocentestucumanos.blogspot.com", format: "atom" },
] as const;

type Feed = typeof NEWS_FEEDS[number];
export type DiscoveredArticle = { feed: Feed; title: string; url: string; publishedAt: string; updatedAt: string; fingerprint: string };
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const uuid = (text: string) => {
  const h = hash(text);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const decode = (text: string) => text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&#(x[0-9a-f]+|\d+);|&([a-z]+);/gi, (value, number, named) => {
    if (number) {
      const point = Number.parseInt(number.slice(0, 1).toLowerCase() === "x" ? number.slice(1) : number, number[0]?.toLowerCase() === "x" ? 16 : 10);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
    }
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " } as Record<string, string>)[named.toLowerCase()] ?? value;
  });
const tag = (xml: string, name: string) => new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i").exec(xml)?.[1] ?? "";
const cleanTitle = (value: string) => decode(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
const canonical = (value: string, host: string) => {
  const normalized = normalizeNewsSourceUrl(decode(value).trim());
  if (!normalized) return null;
  const url = new URL(normalized);
  return url.hostname === host && url.pathname !== "/" ? normalized : null;
};

export function parseNewsFeed(xml: string, feed: Feed, now = new Date()): DiscoveredArticle[] {
  if (xml.length > 300_000) throw new Error("NEWS_FEED_TOO_LARGE");
  const root = feed.format === "rss" ? "item" : "entry";
  const blocks = [...xml.matchAll(new RegExp(`<${root}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${root}>`, "gi"))].slice(0, 20);
  if (!blocks.length) throw new Error("NEWS_FEED_EMPTY");
  const seen = new Set<string>(), articles: DiscoveredArticle[] = [];
  for (const [, block] of blocks) {
    const title = cleanTitle(tag(block, "title"));
    const rawLink = feed.format === "rss" ? tag(block, "link") : /<link\b(?=[^>]*\brel=["']alternate["'])[^>]*\bhref=["']([^"']+)["']/i.exec(block)?.[1] ?? "";
    const url = canonical(rawLink, feed.host);
    const published = new Date(decode(tag(block, feed.format === "rss" ? "pubDate" : "published")).trim());
    const updatedText = feed.format === "atom" ? tag(block, "updated") : tag(block, "pubDate");
    const updated = new Date(decode(updatedText).trim());
    if (!title || !url || Number.isNaN(published.getTime()) || Number.isNaN(updated.getTime()) || seen.has(url)) continue;
    // Discovery is for current articles. Old source archives remain accessible at their source.
    if (published.getTime() > now.getTime() + 86_400_000 || published.getTime() < now.getTime() - 45 * 86_400_000) continue;
    seen.add(url);
    const excerpt = tag(block, feed.format === "rss" ? "description" : "content");
    articles.push({ feed, title, url, publishedAt: published.toISOString(), updatedAt: updated.toISOString(),
      fingerprint: hash(`${title}|${published.toISOString()}|${updated.toISOString()}|${excerpt}`) });
  }
  return articles;
}

export async function fetchNewsFeed(feed: Feed, fetcher: typeof fetch = fetch, now = new Date()) {
  const response = await fetcher(feed.url, { signal: AbortSignal.timeout(15_000), headers: { Accept: "application/rss+xml, application/atom+xml, application/xml" } });
  if (!response.ok) throw new Error(`NEWS_FEED_HTTP_${response.status}`);
  const xml = await response.text();
  return parseNewsFeed(xml, feed, now);
}

export async function importNewsCandidates(database: CommunityDatabase, articles: DiscoveredArticle[], now = new Date()) {
  let created = 0, updated = 0, unchanged = 0;
  for (const article of articles) {
    const url = canonical(article.url, article.feed.host);
    if (!url || !article.title.trim() || article.title.length > 160 || !/^[0-9a-f]{64}$/.test(article.fingerprint))
      throw new Error("NEWS_ARTICLE_INVALID");
    const itemId = uuid(`news:${article.feed.key}:${url}`);
    const sourceId = uuid(`source:${article.feed.key}:${url}`);
    const existing = await database.prepare("SELECT news_item_id FROM news_sources WHERE normalized_url=? LIMIT 1").bind(url)
      .first<{ news_item_id: string }>();
    // A manually curated article may cite this URL; discovery never takes it over.
    if (existing && existing.news_item_id !== itemId) { unchanged++; continue; }
    const stamp = now.toISOString();
    const item = await database.prepare("SELECT status,editorial_title,updated_at FROM news_items WHERE id=?")
      .bind(itemId).first<{ status: string; editorial_title: string; updated_at: string }>();
    if (!item) {
      await database.prepare(`INSERT OR IGNORE INTO news_items(id,status,editorial_title,editorial_summary,topic,relevance,created_at,updated_at)
        VALUES(?,'candidate',?,'',?,'informativa',?,?)`).bind(itemId, article.title, article.feed.topic, stamp, stamp).run();
    }
    const source = await database.prepare("SELECT source_title,source_published_at FROM news_sources WHERE id=?")
      .bind(sourceId).first<{ source_title: string; source_published_at: string | null }>();
    const changed = !source || source.source_title !== article.title || source.source_published_at !== article.publishedAt;
    if (!source) {
      await database.prepare(`INSERT OR IGNORE INTO news_sources(id,news_item_id,source_name,source_title,url,normalized_url,source_type,is_primary,source_published_at)
        VALUES(?,?,?,?,?,?,?,1,?)`).bind(sourceId, itemId, article.feed.name, article.title, url, url, article.feed.type, article.publishedAt).run();
    } else if (changed) {
      await database.prepare("UPDATE news_sources SET source_title=?,source_published_at=? WHERE id=?")
        .bind(article.title, article.publishedAt, sourceId).run();
      if (item?.status === "candidate" && item.editorial_title === source.source_title) {
        await database.prepare("UPDATE news_items SET editorial_title=?,updated_at=? WHERE id=? AND status='candidate' AND editorial_title=?")
          .bind(article.title, stamp, itemId, source.source_title).run();
      }
    }
    const evidence = { feed: article.feed.url, url, publishedAt: article.publishedAt, updatedAt: article.updatedAt,
      title: article.title, digest: article.fingerprint };
    const previous = await database.prepare("SELECT details FROM news_events WHERE news_item_id=? AND actor_kind='system' ORDER BY rowid DESC LIMIT 1")
      .bind(itemId).first<{ details: string }>();
    const previousDigest = previous ? (JSON.parse(previous.details) as { digest?: string }).digest : null;
    if (previousDigest !== evidence.digest) {
      const eventId = uuid(previous ? `event:update:${itemId}:${evidence.digest}` : `event:create:${itemId}`);
      await database.prepare(`INSERT OR IGNORE INTO news_events(id,news_item_id,actor_kind,action,previous_status,next_status,details,created_at)
        VALUES(?,?,'system',?,?,?,?,?)`).bind(eventId, itemId, previous ? "edit" : "create_candidate", previous ? item?.status ?? "candidate" : null, item?.status ?? "candidate",
          JSON.stringify(evidence), stamp).run();
    }
    if (!item) created++; else if (changed || previousDigest !== evidence.digest) updated++; else unchanged++;
  }
  return { created, updated, unchanged };
}
