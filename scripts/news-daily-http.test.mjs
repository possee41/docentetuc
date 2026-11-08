import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { NEWS_FEEDS } from "../lib/news-discovery.ts";

// Import the real handler with only env/DB dependencies injected, never an auth bypass.
let code = readFileSync(new URL("../app/api/internal/news-discovery/route.ts", import.meta.url), "utf8")
  .replace('import { getD1 } from "@/db";', 'const getD1 = () => globalThis.__dailyNewsTest.database;')
  .replace('import { env } from "cloudflare:workers";', 'const env = globalThis.__dailyNewsTest.env;')
  .replace('"@/lib/news-discovery"', JSON.stringify(new URL("../lib/news-discovery.ts", import.meta.url).href))
  .replace('"@/lib/news-editorial"', JSON.stringify(new URL("../lib/news-editorial.ts", import.meta.url).href));
code = stripTypeScriptTypes(code);
const token = "synthetic_news_http_secret_1234567890123456";
const runtime = { env: { NEWS_DISCOVERY_SECRET: token }, database: null };
globalThis.__dailyNewsTest = runtime;
const { POST } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
function fixture() {
  const raw = new DatabaseSync(":memory:");
  raw.exec('CREATE TABLE "user"(id TEXT PRIMARY KEY); CREATE TABLE publications(id TEXT PRIMARY KEY,removed_at TEXT)');
  for (const name of ["0021_news_editorial.sql", "0022_news_media_content.sql"]) raw.exec(readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8"));
  const database = { prepare: sql => ({ bind: (...args) => ({ first: async () => raw.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: raw.prepare(sql).all(...args) }), runSync: () => raw.prepare(sql).run(...args) }) }),
    batch: async statements => { raw.exec("BEGIN"); try { const r = statements.map(s => s.runSync()); raw.exec("COMMIT"); return r; }
      catch (e) { raw.exec("ROLLBACK"); throw e; } } };
  runtime.database = database;
  return raw;
}
const request = (articles, secret = token) => new Request("https://local.test/api/internal/news-discovery", {
  method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
  body: JSON.stringify({ articles, maxCandidates: 1 }) });
const article = feed => ({ feedKey: feed.key, title: "Noticia ficticia exclusivamente local", url: `https://${feed.host}/local-daily/`,
  publishedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), fingerprint: "a".repeat(64) });
test("real HTTP handler accepts all three configured feeds and persists candidates/audit in local SQLite only", async () => {
  const raw = fixture();
  try {
    for (const feed of NEWS_FEEDS) {
      const item = article(feed), first = await POST(request([item])); assert.equal(first.status, 200);
      const ack = await first.json(); assert.equal(ack.result.created, 1); assert.equal(ack.autoPublish, false); assert.equal(ack.notifications, false);
      const replay = await (await POST(request([item]))).json(); assert.equal(replay.result.unchanged, 1);
    }
    assert.equal(raw.prepare("SELECT count(*) AS n FROM news_items WHERE status='candidate'").get().n, 3);
    assert.equal(raw.prepare("SELECT count(*) AS n FROM news_items WHERE status='published'").get().n, 0);
    assert.equal(raw.prepare("SELECT count(*) AS n FROM news_events").get().n, 3);
  } finally { raw.close(); }
});
test("real HTTP handler denies unknown feeds, cross-host links and wrong credentials without writes", async () => {
  const raw = fixture();
  try {
    const item = article(NEWS_FEEDS[0]);
    assert.equal((await POST(request([item], "incorrect"))).status, 401);
    assert.equal((await POST(request([{ ...item, feedKey: "unknown" }]))).status, 400);
    assert.equal((await POST(request([{ ...item, url: "https://attacker.example/local/" }]))).status, 400);
    assert.equal(raw.prepare("SELECT count(*) AS n FROM news_items").get().n, 0);
  } finally { raw.close(); }
});
test("daily discovery preserves manually edited and published editorial content", async () => {
  const raw = fixture();
  try {
    const item = article(NEWS_FEEDS[0]); await POST(request([item]));
    raw.exec("UPDATE news_items SET status='published',editorial_title='Título manual protegido'");
    await POST(request([{ ...item, title: "Cambió la fuente", fingerprint: "b".repeat(64) }]));
    const stored = raw.prepare("SELECT status,editorial_title FROM news_items").get();
    assert.equal(stored.status, "published"); assert.equal(stored.editorial_title, "Título manual protegido");
  } finally { raw.close(); }
});
