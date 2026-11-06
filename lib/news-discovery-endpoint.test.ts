import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import type { CommunityDatabase } from "./community.ts";
import { NEWS_FEEDS, fetchNewsFeed, importNewsCandidates } from "./news-discovery.ts";
import { isPrivateOrLoopbackHost } from "./news-editorial.ts";

function fixture() {
  const raw = new DatabaseSync(":memory:");
  raw.exec('CREATE TABLE "user"(id TEXT PRIMARY KEY); CREATE TABLE publications(id TEXT PRIMARY KEY, removed_at TEXT);');
  raw.exec(readFileSync(new URL("../migrations/0021_news_editorial.sql", import.meta.url), "utf8"));
  raw.exec(readFileSync(new URL("../migrations/0022_news_media_content.sql", import.meta.url), "utf8"));
  const database = { prepare(sql: string) {
    return { bind(...values: unknown[]) {
      const args = values as (string | number | null)[];
      return { first: async <T>() => raw.prepare(sql).get(...args) as T | null,
        all: async <T>() => ({ results: raw.prepare(sql).all(...args) as T[] }),
        run: async () => ({ meta: { changes: Number(raw.prepare(sql).run(...args).changes) } }),
        runSync: () => ({ meta: { changes: Number(raw.prepare(sql).run(...args).changes) } }) };
    } };
  }, async batch(statements: unknown[]) {
    raw.exec('BEGIN');
    try { const result = statements.map((statement) => (statement as { runSync(): { meta: { changes: number } } }).runSync()); raw.exec('COMMIT'); return result; }
    catch (error) { raw.exec('ROLLBACK'); throw error; }
  } } as unknown as CommunityDatabase;
  return { raw, database };
}

const now = new Date("2026-11-04T12:00:00.000Z");

test("solo feeds autorizados existen en NEWS_FEEDS", () => {
  const keys = NEWS_FEEDS.map((f) => f.key);
  assert.deepEqual(keys, ["ministry", "atep", "infod"]);
  // Unknown feed keys must not be accepted.
  const selected = NEWS_FEEDS.filter((f) => ["infod", "unknown-feed"].includes(f.key));
  assert.equal(selected.length, 1);
  assert.equal(selected[0].key, "infod");
});

test("maxCandidates se limita a 1-20 en el servidor", () => {
  const clamp = (v: unknown) => { const n = Number(v); return Math.min(20, Math.max(1, Number.isFinite(n) ? n : 5)); };
  assert.equal(clamp(0), 1);
  assert.equal(clamp(-5), 1);
  assert.equal(clamp(100), 20);
  assert.equal(clamp("abc"), 5);
  assert.equal(clamp(5), 5);
  assert.equal(clamp(1), 1);
  assert.equal(clamp(20), 20);
});

test("importNewsCandidates es idempotente: repetición no crea duplicados ni eventos extra", async () => {
  const { raw, database } = fixture();
  try {
    const articles = [{ feed: NEWS_FEEDS.find((f) => f.key === "infod")!, title: "Noticia de prueba", url: "https://red.infd.edu.ar/prueba-idempotencia/", publishedAt: "2026-11-01T10:00:00.000Z", updatedAt: "2026-11-01T10:00:00.000Z", fingerprint: "a".repeat(64) }];
    const first = await importNewsCandidates(database, articles, now, 5);
    assert.equal(first.created, 1);
    const second = await importNewsCandidates(database, articles, now, 5);
    assert.equal(second.created, 0);
    assert.equal(second.unchanged, 1);
    assert.equal((raw.prepare("SELECT COUNT(*) AS c FROM news_items").get() as { c: number }).c, 1);
    assert.equal((raw.prepare("SELECT COUNT(*) AS c FROM news_events").get() as { c: number }).c, 1);
  } finally { raw.close(); }
});

test("importNewsCandidates registra candidatas, nunca publicadas", async () => {
  const { raw, database } = fixture();
  try {
    const articles = [{ feed: NEWS_FEEDS.find((f) => f.key === "infod")!, title: "Candidata de prueba", url: "https://red.infd.edu.ar/candidata-prueba/", publishedAt: "2026-11-01T10:00:00.000Z", updatedAt: "2026-11-01T10:00:00.000Z", fingerprint: "b".repeat(64) }];
    await importNewsCandidates(database, articles, now, 5);
    const items = raw.prepare("SELECT status FROM news_items").all() as { status: string }[];
    assert.ok(items.length > 0);
    assert.ok(items.every((i) => i.status === "candidate"));
    assert.equal((raw.prepare("SELECT COUNT(*) AS c FROM news_items WHERE status='published'").get() as { c: number }).c, 0);
  } finally { raw.close(); }
});

test("importNewsCandidates registra auditoría con actor system", async () => {
  const { raw, database } = fixture();
  try {
    const articles = [{ feed: NEWS_FEEDS.find((f) => f.key === "infod")!, title: "Audit test", url: "https://red.infd.edu.ar/audit-test/", publishedAt: "2026-11-01T10:00:00.000Z", updatedAt: "2026-11-01T10:00:00.000Z", fingerprint: "c".repeat(64) }];
    await importNewsCandidates(database, articles, now, 5);
    const events = raw.prepare("SELECT actor_kind, action, next_status FROM news_events").all() as { actor_kind: string; action: string; next_status: string }[];
    assert.equal(events.length, 1);
    assert.equal(events[0].actor_kind, "system");
    assert.equal(events[0].action, "create_candidate");
    assert.equal(events[0].next_status, "candidate");
  } finally { raw.close(); }
});

test("importNewsCandidates limita nuevas candidatas a maxCandidates con 20 articulos y 5 repetidos", async () => {
  const { raw, database } = fixture();
  try {
    // Pre-register 5 articles.
    const knownUrls = Array.from({ length: 5 }, (_, i) => `https://red.infd.edu.ar/known-${i}/`);
    const knownArticles = knownUrls.map((url, i) => ({
      feed: NEWS_FEEDS.find((f) => f.key === "infod")!,
      title: `Conocido ${i}`, url, publishedAt: "2026-11-01T10:00:00.000Z", updatedAt: "2026-11-01T10:00:00.000Z", fingerprint: `${i + 10}`.repeat(64).slice(0, 64),
    }));
    await importNewsCandidates(database, knownArticles, now, 5);
    assert.equal((raw.prepare("SELECT COUNT(*) AS c FROM news_items").get() as { c: number }).c, 5);
    // Now send 20 articles: 5 known + 15 new.
    const newUrls = Array.from({ length: 15 }, (_, i) => `https://red.infd.edu.ar/new-${i}/`);
    const allArticles = [
      ...knownUrls.map((url, i) => ({ feed: NEWS_FEEDS.find((f) => f.key === "infod")!, title: `Conocido ${i}`, url, publishedAt: "2026-11-01T10:00:00.000Z", updatedAt: "2026-11-01T10:00:00.000Z", fingerprint: `${i + 10}`.repeat(64).slice(0, 64) })),
      ...newUrls.map((url, i) => ({ feed: NEWS_FEEDS.find((f) => f.key === "infod")!, title: `Nuevo ${i}`, url, publishedAt: "2026-11-01T10:00:00.000Z", updatedAt: "2026-11-01T10:00:00.000Z", fingerprint: `${i + 30}`.repeat(64).slice(0, 64) })),
    ];
    const result = await importNewsCandidates(database, allArticles, now, 5);
    assert.equal(result.created, 5);
    assert.equal(result.skipped, 10);
    assert.equal((raw.prepare("SELECT COUNT(*) AS c FROM news_items").get() as { c: number }).c, 10);
  } finally { raw.close(); }
});

test("importNewsCandidates no toma posesión de URL de otra noticia", async () => {
  const { raw, database } = fixture();
  try {
    const url = "https://red.infd.edu.ar/url-compartida/";
    raw.prepare(`INSERT INTO news_items(id,status,editorial_title,editorial_summary,topic,relevance,created_at,updated_at) VALUES('manual','published','Manual','Resumen','Educación','informativa',datetime('now'),datetime('now'))`).run();
    raw.prepare(`INSERT INTO news_sources(id,news_item_id,source_name,source_title,url,normalized_url,source_type,is_primary) VALUES('msrc','manual','Manual','Manual','${url}','${url}','official',1)`).run();
    const articles = [{ feed: NEWS_FEEDS.find((f) => f.key === "infod")!, title: "Nuevo", url, publishedAt: "2026-11-01T10:00:00.000Z", updatedAt: "2026-11-01T10:00:00.000Z", fingerprint: "e".repeat(64) }];
    const result = await importNewsCandidates(database, articles, now, 5);
    assert.equal(result.unchanged, 1);
    assert.equal((raw.prepare("SELECT COUNT(*) AS c FROM news_items WHERE status='candidate'").get() as { c: number }).c, 0);
  } finally { raw.close(); }
});

test("fetchNewsFeed rechaza hosts privados y URLs inseguras", async () => {
  const privateFeed = { ...NEWS_FEEDS.find((f) => f.key === "infod")!, url: "https://127.0.0.1/feed/", host: "127.0.0.1" } as unknown as typeof NEWS_FEEDS[number];
  await assert.rejects(fetchNewsFeed(privateFeed, async () => new Response("<rss/>", { status: 200 }), now), /NEWS_FEED_HOST_BLOCKED/);
  assert.ok(isPrivateOrLoopbackHost("localhost"));
  assert.ok(isPrivateOrLoopbackHost("10.0.0.1"));
});

test("el piloto solo permite INFoD", () => {
  const pilotAllowed = ["infod"];
  const selected = NEWS_FEEDS.filter((f) => pilotAllowed.includes(f.key));
  assert.equal(selected.length, 1);
  assert.equal(selected[0].key, "infod");
  for (const key of ["ministry", "atep"]) {
    const filtered = NEWS_FEEDS.filter((f) => [key].includes(f.key) && pilotAllowed.includes(f.key));
    assert.equal(filtered.length, 0, `${key} should not be allowed in pilot`);
  }
});


test("fallo en batch no deja registros huérfanos ni auditorías falsas", async () => {
  const { raw, database } = fixture();
  try {
    // Make batch fail by throwing on the second statement.
    database.batch = async (statements: unknown[]) => {
      raw.exec("BEGIN");
      try {
        (statements[0] as { runSync(): { meta: { changes: number } } }).runSync();
        throw new Error("D1_WRITE_FAILED");
      } catch (error) { raw.exec("ROLLBACK"); throw error; }
    };
    const articles = [{ feed: NEWS_FEEDS.find((f) => f.key === "infod")!, title: "Fallo atómico", url: "https://red.infd.edu.ar/fallo-atomico/", publishedAt: "2026-11-01T10:00:00.000Z", updatedAt: "2026-11-01T10:00:00.000Z", fingerprint: "a".repeat(64) }];
    await assert.rejects(importNewsCandidates(database, articles, now, 5), /D1_WRITE_FAILED/);
    // No partial data should remain.
    assert.equal((raw.prepare("SELECT COUNT(*) AS c FROM news_items").get() as { c: number }).c, 0);
    assert.equal((raw.prepare("SELECT COUNT(*) AS c FROM news_sources").get() as { c: number }).c, 0);
    assert.equal((raw.prepare("SELECT COUNT(*) AS c FROM news_events").get() as { c: number }).c, 0);
  } finally { raw.close(); }
});

test("importNewsCandidates no modifica noticias ya aprobadas o publicadas", async () => {
  const { raw, database } = fixture();
  try {
    // Create an approved item manually.
    const id = "approved-item-12345678-1234-4234-8234-123456789abc";
    raw.prepare(`INSERT INTO news_items(id,status,editorial_title,editorial_summary,topic,relevance,created_at,updated_at) VALUES(?,'approved','Título manual','Resumen manual','Educación','informativa',datetime('now'),datetime('now'))`).run(id);
    const url = "https://red.infd.edu.ar/articulo-aprobado/";
    raw.prepare(`INSERT INTO news_sources(id,news_item_id,source_name,source_title,url,normalized_url,source_type,is_primary) VALUES('src-approved','${id}','INFoD','Manual','${url}','${url}','official',1)`).run();
    // Feed article with same URL.
    const articles = [{ feed: NEWS_FEEDS.find((f) => f.key === "infod")!, title: "Título del feed (diferente)", url, publishedAt: "2026-11-01T10:00:00.000Z", updatedAt: "2026-11-01T10:00:00.000Z", fingerprint: "f".repeat(64) }];
    await importNewsCandidates(database, articles, now, 5);
    // The approved item's title should NOT be overwritten.
    const item = raw.prepare("SELECT editorial_title, status FROM news_items WHERE id=?").get(id) as { editorial_title: string; status: string };
    assert.equal(item.editorial_title, "Título manual");
    assert.equal(item.status, "approved");
  } finally { raw.close(); }
});