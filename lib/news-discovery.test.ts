import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { CommunityDatabase } from "./community.ts";
import { NEWS_FEEDS, NEWS_DISCOVERY_MAX_ARTICLES, NEWS_FEED_MAX_BYTES, fetchNewsFeed, importNewsCandidates, parseNewsFeed, type Feed } from "./news-discovery.ts";
import { normalizeNewsSourceUrl } from "./news-editorial.ts";

const RSS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Ministerio de Educación de Tucumán</title>
    <item>
      <title>Comunicado sobre inscripciones SIME</title>
      <link>https://www.educaciontuc.gov.ar/comunicado-sime</link>
      <pubDate>Wed, 14 Oct 2026 12:00:00 GMT</pubDate>
      <description>Detalle del comunicado.</description>
    </item>
    <item>
      <title>Resolución de Juntas</title>
      <link>https://www.educaciontuc.gov.ar/resolucion-juntas</link>
      <pubDate>Tue, 13 Oct 2026 10:00:00 GMT</pubDate>
      <description>Texto de la resolución.</description>
    </item>
  </channel>
</rss>`;

const ATOM_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>ATEP Tucumán</title>
  <entry>
    <title>ATEP informa paro docente</title>
    <link rel="alternate" href="https://atep-delosdocentestucumanos.blogspot.com/2026/10/paro.html" />
    <published>2026-10-14T12:00:00Z</published>
    <updated>2026-10-14T12:00:00Z</updated>
    <content>Detalle gremial.</content>
  </entry>
</feed>`;

const OFFICIAL_FEED: Feed = {
  key: "ministry", name: "Ministerio de Educación de Tucumán", type: "official" as const,
  topic: "Educación", url: "https://www.educaciontuc.gov.ar/feed/", host: "www.educaciontuc.gov.ar", format: "rss" as const,
};

const UNION_FEED: Feed = {
  key: "atep", name: "ATEP Tucumán", type: "union" as const,
  topic: "Actualidad gremial", url: "https://atep-delosdocentestucumanos.blogspot.com/feeds/posts/default?alt=atom&max-results=10",
  host: "atep-delosdocentestucumanos.blogspot.com", format: "atom" as const,
};

function fixture() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`CREATE TABLE "user"(id TEXT PRIMARY KEY); CREATE TABLE publications(id TEXT PRIMARY KEY, removed_at TEXT);`);
  raw.exec(readFileSync(new URL("../migrations/0021_news_editorial.sql", import.meta.url), "utf8"));
  raw.exec(readFileSync(new URL("../migrations/0022_news_media_content.sql", import.meta.url), "utf8"));
  const database = {
    prepare(sql: string) {
      return { bind(...values: unknown[]) {
        const args = values as (string | number | null)[];
        return { first: async <T>() => raw.prepare(sql).get(...args) as T | null,
          all: async <T>() => ({ results: raw.prepare(sql).all(...args) as T[] }),
          run: async () => raw.prepare(sql).run(...args),
          runSync: () => raw.prepare(sql).run(...args) };
      } };
    },
    async batch(statements: unknown[]) {
      raw.exec('BEGIN');
      try { const result = statements.map((statement) => (statement as { runSync(): { meta: { changes: number } } }).runSync()); raw.exec('COMMIT'); return result; }
      catch (error) { raw.exec('ROLLBACK'); throw error; }
    },
  } as unknown as CommunityDatabase;
  return { raw, database };
}

const now = new Date("2026-10-15T12:00:00.000Z");

test("parsea RSS oficial y Atom gremial, conservando título, URL y fecha", () => {
  const rss = parseNewsFeed(RSS_FIXTURE, OFFICIAL_FEED, now);
  assert.equal(rss.length, 2);
  assert.equal(rss[0].title, "Comunicado sobre inscripciones SIME");
  assert.equal(rss[0].url, "https://www.educaciontuc.gov.ar/comunicado-sime");
  assert.equal(rss[0].publishedAt, "2026-10-14T12:00:00.000Z");
  assert.equal(rss[0].feed.type, "official");

  const atom = parseNewsFeed(ATOM_FIXTURE, UNION_FEED, now);
  assert.equal(atom.length, 1);
  assert.equal(atom[0].title, "ATEP informa paro docente");
  assert.equal(atom[0].url, "https://atep-delosdocentestucumanos.blogspot.com/2026/10/paro.html");
  assert.equal(atom[0].feed.type, "union");
});

test("descarta artículos fuera de la ventana de 45 días y limita la cantidad", () => {
  const oldXml = RSS_FIXTURE
    .replaceAll("Wed, 14 Oct 2026 12:00:00 GMT", "Wed, 01 Jan 2026 12:00:00 GMT")
    .replaceAll("Tue, 13 Oct 2026 10:00:00 GMT", "Tue, 02 Jan 2026 10:00:00 GMT");
  const parsed = parseNewsFeed(oldXml, OFFICIAL_FEED, now);
  assert.equal(parsed.length, 0, "artículos viejos fuera de ventana");
  assert.throws(() => parseNewsFeed("x".repeat(300_001), OFFICIAL_FEED, now), /NEWS_FEED_TOO_LARGE/);
  assert.throws(() => parseNewsFeed("<rss><channel></channel></rss>", OFFICIAL_FEED, now), /NEWS_FEED_EMPTY/);
});

test("fetchNewsFeed bloquea redirecciones y valida tipo de contenido", async () => {
  const redirecting = async () => new Response("", { status: 302, headers: { Location: "https://evil.example/x" } });
  await assert.rejects(fetchNewsFeed(OFFICIAL_FEED, redirecting, now), /NEWS_FEED_HTTP_302/);

  const badType = async () => new Response("<rss/>", { status: 200, headers: { "content-type": "text/html" } });
  await assert.rejects(fetchNewsFeed(OFFICIAL_FEED, badType, now), /NEWS_FEED_CONTENT_TYPE_INVALID/);

  const ok = async () => new Response(RSS_FIXTURE, { status: 200, headers: { "content-type": "application/rss+xml" } });
  const articles = await fetchNewsFeed(OFFICIAL_FEED, ok, now);
  assert.equal(articles.length, 2);
});

test("fetchNewsFeed cancela la lectura cuando el cuerpo supera 300 KB", async () => {
  const huge = async () => new Response("x".repeat(NEWS_FEED_MAX_BYTES + 100), { status: 200, headers: { "content-type": "application/xml" } });
  await assert.rejects(fetchNewsFeed(OFFICIAL_FEED, huge, now), /NEWS_FEED_TOO_LARGE/);
});

test("fetchNewsFeed rechaza respuestas con content-length excesivo aunque no haya stream", async () => {
  const noStream = async () => new Response(null, { status: 200, headers: { "content-type": "application/xml", "content-length": String(NEWS_FEED_MAX_BYTES + 1) } });
  await assert.rejects(fetchNewsFeed(OFFICIAL_FEED, noStream, now), /NEWS_FEED_TOO_LARGE/);
});
test("fetchNewsFeed rechaza hosts privados en la URL del feed", async () => {
  const privateFeed = { ...OFFICIAL_FEED, url: "https://127.0.0.1/feed/", host: "127.0.0.1" } as unknown as Feed;
  await assert.rejects(fetchNewsFeed(privateFeed, async () => new Response(RSS_FIXTURE, { status: 200 }), now), /NEWS_FEED_HOST_BLOCKED/);
});
test("fetchNewsFeed rechaza HTTP no exitoso y respeta el límite de tamaño", async () => {
  const fetcher = async () => new Response("nope", { status: 503 });
  await assert.rejects(fetchNewsFeed(OFFICIAL_FEED, fetcher, now), /NEWS_FEED_HTTP_503/);
  const big = async () => new Response("x".repeat(300_001), { status: 200 });
  await assert.rejects(fetchNewsFeed(OFFICIAL_FEED, big, now), /NEWS_FEED_TOO_LARGE/);
});

test("importNewsCandidates registra candidatos nuevos sin publicarlos", async () => {
  const { raw, database } = fixture();
  try {
    const articles = parseNewsFeed(RSS_FIXTURE, OFFICIAL_FEED, now);
    const result = await importNewsCandidates(database, articles, now);
    assert.equal(result.created, 2);
    assert.equal(result.updated, 0);
    assert.equal(result.unchanged, 0);
    const items = raw.prepare("SELECT id,status,editorial_title,topic FROM news_items ORDER BY id").all() as { id: string; status: string; editorial_title: string; topic: string }[];
    assert.equal(items.length, 2);
    assert.ok(items.every((item) => item.status === "candidate"));
    assert.equal(items[0]!.editorial_title, "Comunicado sobre inscripciones SIME");
    const sources = raw.prepare("SELECT source_type,is_primary,normalized_url FROM news_sources").all() as { source_type: string; is_primary: number; normalized_url: string }[];
    assert.equal(sources.length, 2);
    assert.ok(sources.every((source) => source.source_type === "official" && source.is_primary === 1));
    const events = raw.prepare("SELECT action, actor_kind, next_status FROM news_events").all() as { action: string; actor_kind: string; next_status: string }[];
    assert.equal(events.length, 2);
    assert.ok(events.every((event) => event.action === "create_candidate" && event.actor_kind === "system" && event.next_status === "candidate"));
  } finally { raw.close(); }
});

test("importNewsCandidates evita duplicados por URL normalizada", async () => {
  const { raw, database } = fixture();
  try {
    const articles = parseNewsFeed(RSS_FIXTURE, OFFICIAL_FEED, now);
    await importNewsCandidates(database, articles, now);
    const second = await importNewsCandidates(database, articles, now);
    assert.equal(second.created, 0);
    assert.equal(second.unchanged, 2);
    assert.equal((raw.prepare("SELECT COUNT(*) AS c FROM news_items").get() as { c: number }).c, 2);
    assert.equal((raw.prepare("SELECT COUNT(*) AS c FROM news_sources").get() as { c: number }).c, 2);
  } finally { raw.close(); }
});

test("importNewsCandidates no toma posesión de una URL ya asociada a otra noticia", async () => {
  const { raw, database } = fixture();
  try {
    const url = "https://www.educaciontuc.gov.ar/comunicado-sime";
    raw.prepare(`INSERT INTO news_items(id,status,editorial_title,editorial_summary,topic,relevance,created_at,updated_at)
      VALUES('manual-item','published','Manual','Resumen manual','Educación','informativa',datetime('now'),datetime('now'))`).run();
    raw.prepare(`INSERT INTO news_sources(id,news_item_id,source_name,source_title,url,normalized_url,source_type,is_primary)
      VALUES('manual-src','manual-item','Manual','Manual','${url}','${url}','official',1)`).run();
    const articles = parseNewsFeed(RSS_FIXTURE, OFFICIAL_FEED, now);
    const result = await importNewsCandidates(database, articles, now);
    assert.equal(result.unchanged, 1);
    assert.equal((raw.prepare("SELECT COUNT(*) AS c FROM news_items WHERE id='manual-item'").get() as { c: number }).c, 1);
    assert.equal((raw.prepare("SELECT COUNT(*) AS c FROM news_items WHERE status='candidate'").get() as { c: number }).c, 1);
  } finally { raw.close(); }
});

test("importNewsCandidates rechaza artículos inválidos y no escribe parcialmente", async () => {
  const { raw, database } = fixture();
  try {
    const articles = parseNewsFeed(RSS_FIXTURE, OFFICIAL_FEED, now);
    const broken = [{ ...articles[0], title: "" }];
    await assert.rejects(importNewsCandidates(database, broken, now), /NEWS_ARTICLE_INVALID/);
    assert.equal((raw.prepare("SELECT COUNT(*) AS c FROM news_items").get() as { c: number }).c, 0);
  } finally { raw.close(); }
});

test("importNewsCandidates rechaza demasiados artículos por ejecución", async () => {
  const { raw, database } = fixture();
  try {
    const many = Array.from({ length: 101 }, (_, index) => ({
      feed: OFFICIAL_FEED, title: `Título ${index}`, url: `https://www.educaciontuc.gov.ar/item-${index}`,
      publishedAt: now.toISOString(), updatedAt: now.toISOString(), fingerprint: "a".repeat(64),
    }));
    await assert.rejects(importNewsCandidates(database, many, now), /NEWS_TOO_MANY_ARTICLES/);
  } finally { raw.close(); }
});

test("corrige la categoría automática sin sobrescribir revisión editorial", async () => {
  const { raw, database } = fixture();
  try {
    const corrected = parseNewsFeed(RSS_FIXTURE.replaceAll('www.educaciontuc.gov.ar', 'red.infd.edu.ar'), NEWS_FEEDS.find(feed => feed.key === 'infod')!, now);
    await importNewsCandidates(database, corrected, now);
    raw.exec("UPDATE news_sources SET source_type='official'");
    const manual = raw.prepare("SELECT id FROM news_items ORDER BY id LIMIT 1").get() as { id: string };
    raw.prepare("INSERT INTO news_events(id,news_item_id,actor_kind,action,details,created_at) VALUES('manual-review',?,'admin','edit','{}',?)")
      .run(manual.id, now.toISOString());
    const result = await importNewsCandidates(database, corrected, now);
    assert.equal(result.updated, 1);
    assert.equal(result.unchanged, 1);
    assert.equal((raw.prepare("SELECT source_type FROM news_sources WHERE news_item_id=?").get(manual.id) as {source_type:string}).source_type, "official");
    assert.equal((raw.prepare("SELECT COUNT(*) n FROM news_sources WHERE source_type='public'").get() as {n:number}).n, 1);
    const replay = await importNewsCandidates(database, corrected, now);
    assert.equal(replay.updated, 0);
    assert.equal(replay.unchanged, 2);
    assert.equal((raw.prepare("SELECT COUNT(*) n FROM news_events WHERE details LIKE '%categoryCorrection%'").get() as {n:number}).n, 1);
  } finally { raw.close(); }
});

test("normalizeNewsSourceUrl bloquea hosts privados e internos", () => {
  for (const value of [
    "https://localhost/x", "https://127.0.0.1/x", "https://10.0.0.1/x", "https://192.168.1.1/x",
    "https://172.16.0.1/x", "https://169.254.1.1/x", "https://[::1]/x", "https://[fc00::1]/x",
  ]) assert.equal(normalizeNewsSourceUrl(value), null, value);
  assert.equal(normalizeNewsSourceUrl("https://example.org/x"), "https://example.org/x");
});

test("NEWS_DISCOVERY_MAX_ARTICLES limita el parseo por defecto", () => {
  const items = Array.from({ length: 25 }, (_, index) => `<item><title>T${index}</title><link>https://www.educaciontuc.gov.ar/t${index}</link><pubDate>Wed, 14 Oct 2026 12:00:00 GMT</pubDate></item>`).join("");
  const xml = `<rss version="2.0"><channel>${items}</channel></rss>`;
  const parsed = parseNewsFeed(xml, OFFICIAL_FEED, now);
  assert.equal(parsed.length, NEWS_DISCOVERY_MAX_ARTICLES);
  const limited = parseNewsFeed(xml, OFFICIAL_FEED, now, 3);
  assert.equal(limited.length, 3);
});
