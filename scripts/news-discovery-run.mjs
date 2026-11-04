// Manual/automated discovery runner. Fetches authorized feeds, deduplicates and registers candidates.
// Does NOT publish, notify or modify existing curated news. Output: SQL file + JSON summary.
// Usage: node scripts/news-discovery-run.mjs [--feeds=infod] [--max-candidates=5] [--seed-file=existing.json] [--output=sql.sql] [--dry-run] [--validate-only]
import { writeFileSync, readFileSync } from "node:fs";
import { NEWS_FEEDS, fetchNewsFeed, importNewsCandidates } from "../lib/news-discovery.ts";

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, "").split("=");
  return [key, value ?? "true"];
}));
const maxCandidates = Math.min(20, Math.max(1, Number(args["max-candidates"] || 5)));
const dryRun = args["dry-run"] === "true";
const validateOnly = args["validate-only"] === "true";
const outputFile = args.output || "news-discovery-candidates.sql";
const seedFile = args["seed-file"] || null;
const feedsFilter = args.feeds ? args.feeds.split(",").map((f) => f.trim()).filter(Boolean) : null;
const now = new Date();

const selectedFeeds = feedsFilter
  ? NEWS_FEEDS.filter((f) => feedsFilter.includes(f.key))
  : NEWS_FEEDS;
if (selectedFeeds.length === 0) {
  console.error("No valid feeds selected. Available:", NEWS_FEEDS.map((f) => f.key).join(", "));
  process.exit(1);
}

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

// Set up in-memory DB with seed data (if provided) for deduplication.
const { DatabaseSync } = await import("node:sqlite");
const raw = new DatabaseSync(":memory:");
raw.exec('CREATE TABLE "user"(id TEXT PRIMARY KEY); CREATE TABLE publications(id TEXT PRIMARY KEY, removed_at TEXT);');
raw.exec(readFileSync(new URL("../migrations/0021_news_editorial.sql", import.meta.url), "utf8"));
raw.exec(readFileSync(new URL("../migrations/0022_news_media_content.sql", import.meta.url), "utf8"));

if (seedFile) {
  try {
    const seed = JSON.parse(readFileSync(seedFile, "utf8"));
    if (Array.isArray(seed.items)) {
      for (const item of seed.items) {
        raw.prepare(`INSERT OR IGNORE INTO news_items (id, status, editorial_title, editorial_summary, topic, relevance, featured, published_at, valid_from, valid_until, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          item.id, item.status || "candidate", item.editorial_title || "", item.editorial_summary || "",
          item.topic || null, item.relevance || "informativa", item.featured || 0, item.published_at || null,
          item.valid_from || null, item.valid_until || null, item.created_at || now.toISOString(), item.updated_at || now.toISOString());
      }
    }
    if (Array.isArray(seed.sources)) {
      for (const s of seed.sources) {
        raw.prepare(`INSERT OR IGNORE INTO news_sources (id, news_item_id, publication_id, source_name, source_title, url, normalized_url, source_type, is_primary, position, source_published_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          s.id, s.news_item_id, s.publication_id || null, s.source_name, s.source_title, s.url, s.normalized_url,
          s.source_type, s.is_primary || 0, s.position || 0, s.source_published_at || null, s.created_at || now.toISOString());
      }
    }
    console.error(`Seed loaded: ${seed.items?.length || 0} items, ${seed.sources?.length || 0} sources`);
  } catch (error) {
    console.error("Failed to load seed file:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

const database = { prepare(sql) {
  return { bind(...values) {
    const args = values;
    return { first: async () => raw.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...args) }),
      run: async () => raw.prepare(sql).run(...args) };
  } };
} };

const result = await importNewsCandidates(database, capped, now, maxCandidates);

// Read generated rows.
const items = raw.prepare("SELECT id,status,editorial_title,editorial_summary,topic,relevance,featured,published_at,valid_from,valid_until,created_at,updated_at FROM news_items WHERE status='candidate'").all();
const sources = raw.prepare("SELECT id,news_item_id,publication_id,source_name,source_title,url,normalized_url,source_type,is_primary,position,source_published_at,created_at FROM news_sources").all();
const events = raw.prepare("SELECT id,news_item_id,actor_kind,actor_user_id,action,previous_status,next_status,details,created_at FROM news_events").all();

// Strict validation: reject any value that could break SQL safety.
function validate(value, label) {
  if (value === null || value === undefined) return;
  const str = String(value);
  if (str.includes("\x00")) throw new Error(`VALIDATION_FAILED: null byte in ${label}`);
  if (str.length > 2048) throw new Error(`VALIDATION_FAILED: ${label} exceeds 2048 chars`);
}

for (const i of items) {
  validate(i.id, "item.id"); validate(i.editorial_title, "item.editorial_title");
  validate(i.editorial_summary, "item.editorial_summary"); validate(i.topic, "item.topic");
}
for (const s of sources) {
  validate(s.id, "source.id"); validate(s.url, "source.url"); validate(s.normalized_url, "source.normalized_url");
  validate(s.source_name, "source.source_name"); validate(s.source_title, "source.source_title");
}
for (const e of events) {
  validate(e.id, "event.id"); validate(e.details, "event.details");
}

// Robust SQL string escaping (single quotes doubled, no control chars).
function sqlStr(v) {
  if (v === null || v === undefined) return "NULL";
  return "'" + String(v).replace(/'/g, "''").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "") + "'";
}

let sql = "";
for (const i of items) sql += `INSERT OR IGNORE INTO news_items (id,status,editorial_title,editorial_summary,topic,relevance,featured,published_at,valid_from,valid_until,created_at,updated_at) VALUES (${sqlStr(i.id)},${sqlStr(i.status)},${sqlStr(i.editorial_title)},${sqlStr(i.editorial_summary)},${sqlStr(i.topic)},${sqlStr(i.relevance)},${i.featured},${sqlStr(i.published_at)},${sqlStr(i.valid_from)},${sqlStr(i.valid_until)},${sqlStr(i.created_at)},${sqlStr(i.updated_at)});\n`;
for (const s of sources) sql += `INSERT OR IGNORE INTO news_sources (id,news_item_id,publication_id,source_name,source_title,url,normalized_url,source_type,is_primary,position,source_published_at,created_at) VALUES (${sqlStr(s.id)},${sqlStr(s.news_item_id)},${sqlStr(s.publication_id)},${sqlStr(s.source_name)},${sqlStr(s.source_title)},${sqlStr(s.url)},${sqlStr(s.normalized_url)},${sqlStr(s.source_type)},${s.is_primary},${s.position},${sqlStr(s.source_published_at)},${sqlStr(s.created_at)});\n`;
for (const e of events) sql += `INSERT OR IGNORE INTO news_events (id,news_item_id,actor_kind,actor_user_id,action,previous_status,next_status,details,created_at) VALUES (${sqlStr(e.id)},${sqlStr(e.news_item_id)},${sqlStr(e.actor_kind)},${sqlStr(e.actor_user_id)},${sqlStr(e.action)},${sqlStr(e.previous_status)},${sqlStr(e.next_status)},${sqlStr(e.details)},${sqlStr(e.created_at)});\n`;

if (validateOnly) {
  console.log(JSON.stringify({ validated: true, items: items.length, sources: sources.length, events: events.length }, null, 2));
} else if (!dryRun) {
  writeFileSync(outputFile, sql);
  console.log(JSON.stringify({ runAt: now.toISOString(), feeds: feedResults, maxCandidates, totalDiscovered: allArticles.length, capped: capped.length, result, sqlFile: outputFile, validated: true }, null, 2));
} else {
  console.log(JSON.stringify({ runAt: now.toISOString(), feeds: feedResults, maxCandidates, totalDiscovered: allArticles.length, capped: capped.length, result, sqlFile: null, dryRun: true, validated: true }, null, 2));
}
raw.close();
