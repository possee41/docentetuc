// Read public article feeds and create editorial candidates. Never approves or publishes.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createD1Rest } from "./d1-rest.mjs";
import { fetchNewsFeed, importNewsCandidates, NEWS_FEEDS } from "../lib/news-discovery.ts";

function localPreview() {
  const directory = new URL("../.wrangler/review-1.2/v3/d1/miniflare-D1DatabaseObject/", import.meta.url);
  const files = readdirSync(directory).filter((file) => file.endsWith(".sqlite") && file !== "metadata.sqlite");
  if (files.length !== 1) throw new Error("NEWS_LOCAL_D1_UNAVAILABLE");
  const raw = new DatabaseSync(join(fileURLToPath(directory), files[0]));
  return { database: { prepare(sql) { return { bind(...values) { return {
    first: async () => raw.prepare(sql).get(...values) ?? null,
    run: async () => raw.prepare(sql).run(...values),
  }; } }; } }, close: () => raw.close() };
}

export async function runNewsDiscovery({ database, fetcher = fetch, now = new Date(), feeds = NEWS_FEEDS }) {
  const result = [];
  for (const feed of feeds) {
    try {
      const articles = await fetchNewsFeed(feed, fetcher, now);
      const imported = await importNewsCandidates(database, articles, now);
      result.push({ source: feed.key, fetched: articles.length, ...imported, ok: true });
    } catch (error) {
      result.push({ source: feed.key, ok: false, error: error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, "[url]") : "NEWS_UNKNOWN_ERROR" });
    }
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const preview = process.argv.includes("--local-preview");
  let connection;
  try {
    if (preview) connection = localPreview();
    else if (process.argv.includes("--rest")) {
      const databaseId = process.env.NEWS_DATABASE_ID;
      if (!databaseId || databaseId !== process.env.NEWS_ALLOWED_DATABASE_ID) throw new Error("NEWS_DATABASE_NOT_ALLOWED");
      connection = { database: createD1Rest({ accountId: process.env.CF_ACCOUNT_ID, databaseId,
        token: process.env.D1_IMPORT_TOKEN }) };
    } else throw new Error("NEWS_TARGET_REQUIRED");
    const result = await runNewsDiscovery({ database: connection.database });
    console.log(JSON.stringify({ target: preview ? "isolated-local-preview" : "configured-rest", sources: result,
      metrics: connection.database.metrics?.() ?? null }));
    if (result.some((source) => !source.ok)) process.exitCode = 1;
  } catch (error) {
    console.error("NEWS_DISCOVERY_FAILED", error instanceof Error ? error.message : "UNKNOWN");
    process.exitCode = 1;
  } finally { connection?.close?.(); }
}
