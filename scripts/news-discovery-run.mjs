// Manual/automated discovery runner. Fetches authorized feeds, deduplicates and registers candidates.
// Does NOT publish, notify or modify existing curated news. Output: SQL file + JSON summary.
// Usage: node scripts/news-discovery-run.mjs [--max-candidates=5] [--output=sql.sql] [--dry-run]
import { writeFileSync } from "node:fs";
import { NEWS_FEEDS, fetchNewsFeed, importNewsCandidates } from "../lib/news-discovery.ts";

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, "").split("=");
  return [key, value ?? "true"];
}));
const maxCandidates = Math.min(20, Math.max(1, Number(args["max-candidates"] || 5)));
const dryRun = args["dry-run"] === "true";
const outputFile = args.output || "news-discovery-candidates.sql";
const now = new Date();

const allArticles = [];
const feedResults = [];
for (const feed of NEWS_FEEDS) {
  try {
    const articles = await fetchNewsFeed(feed, fetch, now);
    const selected = articles.slice(0, maxCandidates);
    allArticles.push(...selected);
    feedResults.push({ feed: feed.key, status: "OK", discovered: articles.length, selected: selected.length });
  } catch (error) {
    feedResults.push({ feed: feed.key, status: "ERROR", code: error instanceof Error ? error.message : "UNKNOWN", discovered: 0, selected: 0 });
  }
}

// Cap total candidates.
const capped = allArticles.slice(0, maxCandidates);

// Generate SQL by running importNewsCandidates against an in-memory DB (same logic).
const { DatabaseSync } = await import("node:sqlite");
const { readFileSync } = await import("node:fs");
const raw = new DatabaseSync(":memory:");
raw.exec('CREATE TABLE "user"(id TEXT PRIMARY KEY); CREATE TABLE publications(id TEXT PRIMARY KEY, removed_at TEXT);');
raw.exec(readFileSync(new URL("../migrations/0021_news_editorial.sql", import.meta.url), "utf8"));
raw.exec(readFileSync(new URL("../migrations/0022_news_media_content.sql", import.meta.url), "utf8"));
const database = { prepare(sql) {
  return { bind(...values) {
    const args = values;
    return { first: async () => raw.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...args) }),
      run: async () => raw.prepare(sql).run(...args) };
  } };
} };

const result = await importNewsCandidates(database, capped, now, maxCandidates);

// Export the generated rows as SQL for remote apply.
const items = raw.prepare("SELECT id,status,editorial_title,editorial_summary,topic,relevance,featured,published_at,valid_from,valid_until,created_at,updated_at FROM news_items").all();
const sources = raw.prepare("SELECT id,news_item_id,publication_id,source_name,source_title,url,normalized_url,source_type,is_primary,position,source_published_at,created_at FROM news_sources").all();
const events = raw.prepare("SELECT id,news_item_id,actor_kind,actor_user_id,action,previous_status,next_status,details,created_at FROM news_events").all();

const sqlStr = (v) => v === null ? "NULL" : "'" + String(v).replace(/'/g, "''") + "'";
let sql = "";
for (const i of items) sql += `INSERT OR IGNORE INTO news_items (id,status,editorial_title,editorial_summary,topic,relevance,featured,published_at,valid_from,valid_until,created_at,updated_at) VALUES (${sqlStr(i.id)},${sqlStr(i.status)},${sqlStr(i.editorial_title)},${sqlStr(i.editorial_summary)},${sqlStr(i.topic)},${sqlStr(i.relevance)},${i.featured},${sqlStr(i.published_at)},${sqlStr(i.valid_from)},${sqlStr(i.valid_until)},${sqlStr(i.created_at)},${sqlStr(i.updated_at)});\n`;
for (const s of sources) sql += `INSERT OR IGNORE INTO news_sources (id,news_item_id,publication_id,source_name,source_title,url,normalized_url,source_type,is_primary,position,source_published_at,created_at) VALUES (${sqlStr(s.id)},${sqlStr(s.news_item_id)},${sqlStr(s.publication_id)},${sqlStr(s.source_name)},${sqlStr(s.source_title)},${sqlStr(s.url)},${sqlStr(s.normalized_url)},${sqlStr(s.source_type)},${s.is_primary},${s.position},${sqlStr(s.source_published_at)},${sqlStr(s.created_at)});\n`;
for (const e of events) sql += `INSERT OR IGNORE INTO news_events (id,news_item_id,actor_kind,actor_user_id,action,previous_status,next_status,details,created_at) VALUES (${sqlStr(e.id)},${sqlStr(e.news_item_id)},${sqlStr(e.actor_kind)},${sqlStr(e.actor_user_id)},${sqlStr(e.action)},${sqlStr(e.previous_status)},${sqlStr(e.next_status)},${sqlStr(e.details)},${sqlStr(e.created_at)});\n`;

if (!dryRun) writeFileSync(outputFile, sql);
const summary = { runAt: now.toISOString(), feeds: feedResults, maxCandidates, totalDiscovered: allArticles.length, capped: capped.length, result, sqlFile: dryRun ? null : outputFile, dryRun };
console.log(JSON.stringify(summary, null, 2));
raw.close();
