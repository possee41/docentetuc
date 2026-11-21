import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fetchNewsFeed, importNewsCandidates, NEWS_FEEDS, parseNewsFeed } from "./news-discovery.ts";
import { listPublicNews } from "./public-news.ts";
import { mutateNewsAdmin } from "./news-admin.ts";
import type { CommunityDatabase } from "./community.ts";

const ministry = NEWS_FEEDS[0], atep = NEWS_FEEDS[1], now = new Date("2026-10-24T12:00:00.000Z");
const adminId = "550e8400-e29b-41d4-a716-446655440000";
const rss = (title = "Alumnos y docentes se capacitaron en el uso educativo de drones", date = "Fri, 23 Oct 2026 12:00:00 +0000") =>
  `<rss><channel><item><title><![CDATA[${title}]]></title><link>https://www.educaciontuc.gov.ar/2026/10/23/alumnos-y-docentes-se-capacitaron-en-el-uso-educativo-de-drones/</link><pubDate>${date}</pubDate></item></channel></rss>`;

function fixture() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`PRAGMA foreign_keys=ON; CREATE TABLE "user"(id TEXT PRIMARY KEY,name TEXT);
    CREATE TABLE community_moderators(user_id TEXT PRIMARY KEY,role TEXT NOT NULL);
    CREATE TABLE publications(id TEXT PRIMARY KEY,title TEXT NOT NULL,summary TEXT NOT NULL,source TEXT NOT NULL,
      official_url TEXT NOT NULL,source_published_at TEXT,removed_at TEXT,updated_at TEXT NOT NULL);
    INSERT INTO "user" VALUES('${adminId}','Admin'); INSERT INTO community_moderators VALUES('${adminId}','admin');`);
  raw.exec(readFileSync(new URL("../migrations/0021_news_editorial.sql", import.meta.url), "utf8"));
  raw.exec(readFileSync(new URL("../migrations/0022_news_media_content.sql", import.meta.url), "utf8"));
  type SqlValue = null | number | bigint | string | Uint8Array;
  const database = { prepare(sql: string) { return { bind(...values: unknown[]) {
    const args = values as SqlValue[];
    return { first: async <T>() => raw.prepare(sql).get(...args) as T | null,
      all: async <T>() => ({ results: raw.prepare(sql).all(...args) as T[] }),
      run: async () => ({ meta: { changes: Number(raw.prepare(sql).run(...args).changes) } }),
      runSync: () => ({ meta: { changes: Number(raw.prepare(sql).run(...args).changes) } }) };
  } }; }, async batch(statements: unknown[]) {
    raw.exec("BEGIN");
    try { const results = statements.map((entry) => (entry as { runSync(): unknown }).runSync()); raw.exec("COMMIT"); return results; }
    catch (error) { raw.exec("ROLLBACK"); throw error; }
  } } as CommunityDatabase;
  return { raw, database };
}

test("RSS oficial acotado conserva título, enlace y fecha; rechaza otros hosts y archivos viejos", () => {
  const xml = rss().replace("</channel>", `<item><title>Engaño</title><link>https://ejemplo.org/otra</link><pubDate>Fri, 23 Oct 2026 12:00:00 +0000</pubDate></item></channel>`);
  const articles = parseNewsFeed(xml, ministry, now);
  assert.equal(articles.length, 1);
  assert.equal(articles[0].title, "Alumnos y docentes se capacitaron en el uso educativo de drones");
  assert.equal(articles[0].publishedAt, "2026-10-23T12:00:00.000Z");
  assert.deepEqual(parseNewsFeed(rss("Nota antigua", "Sat, 21 Oct 2023 12:00:00 +0000"), ministry, now), []);
  assert.throws(() => parseNewsFeed("<rss></rss>", ministry, now), /NEWS_FEED_EMPTY/);
});

test("ATEP Atom conserva fuente gremial y descarta publicaciones antiguas", () => {
  const xml = `<feed><entry><title type="text">Convocatoria gremial &amp; educación</title><published>2026-10-23T12:00:00Z</published>
    <updated>2026-10-23T13:00:00Z</updated><link rel="alternate" type="text/html" href="https://atep-delosdocentestucumanos.blogspot.com/2026/10/convocatoria.html"/></entry></feed>`;
  const result = parseNewsFeed(xml, atep, now);
  assert.equal(result[0].title, "Convocatoria gremial & educación");
  assert.equal(result[0].feed.type, "union");
  assert.equal(result[0].url, "https://atep-delosdocentestucumanos.blogspot.com/2026/10/convocatoria.html");
});

test("feed caído o vacío no altera las noticias existentes", async () => {
  const { raw, database } = fixture();
  try {
    await importNewsCandidates(database, parseNewsFeed(rss(), ministry, now), now);
    const before = raw.prepare("SELECT COUNT(*) AS n FROM news_items").get()!.n;
    await assert.rejects(fetchNewsFeed(ministry, async () => new Response("caído", { status: 503 })), /NEWS_FEED_HTTP_503/);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM news_items").get()!.n, before);
  } finally { raw.close(); }
});

test("candidata descubierta no se publica sola, se actualiza sin duplicar ni pisar revisión humana", async () => {
  const { raw, database } = fixture();
  try {
    const [article] = parseNewsFeed(rss(), ministry, now);
    assert.deepEqual(await importNewsCandidates(database, [article], now), { created: 1, updated: 0, unchanged: 0 });
    assert.deepEqual(await importNewsCandidates(database, [article], now), { created: 0, updated: 0, unchanged: 1 });
    const id = String(raw.prepare("SELECT id FROM news_items").get()!.id);
    assert.deepEqual((await listPublicNews(database, new URLSearchParams("home=1"), now)).items, []);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM news_events").get()!.n, 1);
    const changed = { ...article, title: `${article.title}: nueva edición`, updatedAt: "2026-10-24T10:00:00.000Z" };
    assert.deepEqual(await importNewsCandidates(database, [changed], now), { created: 0, updated: 1, unchanged: 0 });
    assert.equal(raw.prepare("SELECT editorial_title FROM news_items WHERE id=?").get(id)!.editorial_title, changed.title);
    let updatedAt = String(raw.prepare("SELECT updated_at FROM news_items WHERE id=?").get(id)!.updated_at);
    await mutateNewsAdmin(database, adminId, { action: "edit", id, updatedAt, title: "Titular propio", summary: "Síntesis original redactada y verificada", body: "",
      topic: "Tecnología educativa", relevance: "importante", validFrom: null, validUntil: null });
    const third = { ...changed, title: "Titular fuente posterior", updatedAt: "2026-10-24T11:00:00.000Z" };
    await importNewsCandidates(database, [third], now);
    assert.equal(raw.prepare("SELECT editorial_title FROM news_items WHERE id=?").get(id)!.editorial_title, "Titular propio");
    updatedAt = String(raw.prepare("SELECT updated_at FROM news_items WHERE id=?").get(id)!.updated_at);
    await mutateNewsAdmin(database, adminId, { action: "approve", id, updatedAt });
    updatedAt = String(raw.prepare("SELECT updated_at FROM news_items WHERE id=?").get(id)!.updated_at);
    await mutateNewsAdmin(database, adminId, { action: "publish", id, updatedAt });
    updatedAt = String(raw.prepare("SELECT updated_at FROM news_items WHERE id=?").get(id)!.updated_at);
    await mutateNewsAdmin(database, adminId, { action: "feature", id, updatedAt });
    const visibleNow = new Date(Date.parse(String(raw.prepare("SELECT published_at FROM news_items WHERE id=?").get(id)!.published_at)) + 1000);
    const list = await listPublicNews(database, new URLSearchParams(), visibleNow);
    assert.equal(list.items.find((item) => item.id === id)?.primarySource.url, article.url);
    assert.equal((await listPublicNews(database, new URLSearchParams("home=1"), visibleNow)).items[0]?.id, id);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM news_items").get()!.n, 1);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM news_sources").get()!.n, 1);
  } finally { raw.close(); }
});

test("un fallo D1 a mitad de la candidata se recupera y conserva un único evento de creación", async () => {
  const { raw, database } = fixture();
  try {
    const articles = parseNewsFeed(rss(), ministry, now);
    const broken = { ...database, prepare(sql: string) {
      if (sql.includes("INSERT OR IGNORE INTO news_sources")) throw new Error("D1_TEMPORARY_ERROR");
      return database.prepare(sql);
    } } as CommunityDatabase;
    await assert.rejects(importNewsCandidates(broken, articles, now), /D1_TEMPORARY_ERROR/);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM news_items").get()!.n, 1);
    await importNewsCandidates(database, articles, now);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM news_sources").get()!.n, 1);
    assert.deepEqual(raw.prepare("SELECT action FROM news_events").all().map((row) => row.action), ["create_candidate"]);
  } finally { raw.close(); }
});

test("un cambio en la descripción del feed se audita sin copiar su texto al contenido editorial", async () => {
  const { raw, database } = fixture();
  try {
    const initial = parseNewsFeed(rss().replace("</item>", "<description>Primera versión</description></item>"), ministry, now);
    const revised = parseNewsFeed(rss().replace("</item>", "<description>Texto actualizado en origen</description></item>"), ministry, now);
    await importNewsCandidates(database, initial, now);
    assert.deepEqual(await importNewsCandidates(database, revised, now), { created: 0, updated: 1, unchanged: 0 });
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM news_events").get()!.n, 2);
    assert.equal(raw.prepare("SELECT editorial_summary FROM news_items").get()!.editorial_summary, "");
    assert.ok(!JSON.stringify(raw.prepare("SELECT details FROM news_events").all()).includes("Texto actualizado"));
  } finally { raw.close(); }
});
