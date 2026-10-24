import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { CommunityDatabase } from "./community.ts";
import { listPublicNews, publicNewsDetail } from "./public-news.ts";

const now = new Date("2026-10-15T12:00:00.000Z");
type SqlValue = null | number | bigint | string | Uint8Array;

function fixture() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE "user"(id TEXT PRIMARY KEY);
    CREATE TABLE publications(id TEXT PRIMARY KEY,removed_at TEXT);
    INSERT INTO publications VALUES('training-a',NULL),('designation-a',NULL),('withdrawn-a','2026-10-14T00:00:00.000Z');`);
  raw.exec(readFileSync(new URL("../migrations/0021_news_editorial.sql", import.meta.url), "utf8"));
  raw.exec(readFileSync(new URL("../migrations/0022_news_media_content.sql", import.meta.url), "utf8"));
  const database = { prepare(sql: string) { return { bind(...values: unknown[]) {
    const args = values as SqlValue[];
    return { first: async <T>() => raw.prepare(sql).get(...args) as T | null,
      all: async <T>() => ({ results: raw.prepare(sql).all(...args) as T[] }) };
  } }; } } as CommunityDatabase;
  return { raw, database };
}

function add(raw: DatabaseSync, id: string, options: { status?: string; relevance?: string; featured?: number;
  publishedAt?: string; from?: string | null; until?: string | null; origin?: string | null;
  sourcePublication?: string | null; sourceType?: string; topic?: string } = {}) {
  raw.prepare(`INSERT INTO news_items(id,origin_publication_id,status,editorial_title,editorial_summary,topic,relevance,
    featured,valid_from,valid_until,published_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id, options.origin ?? null,
    options.status ?? "published", `Título ${id}`, `Contenido editorial ${id}`, options.topic ?? "Educación",
    options.relevance ?? "informativa", options.featured ?? 0, options.from ?? null, options.until ?? null,
    options.publishedAt ?? "2026-10-14T12:00:00.000Z");
  const url = `https://example.invalid/${id}`;
  raw.prepare(`INSERT INTO news_sources(id,news_item_id,publication_id,source_name,source_title,url,normalized_url,source_type,is_primary)
    VALUES(?,?,?,?,?,?,?,?,1)`).run(`source-${id}`, id, options.sourcePublication ?? null, "Organismo sintético",
    `Referencia ${id}`, url, url, options.sourceType ?? "official");
}

test("solo publica noticias vigentes con fuente principal activa; detalle no expone datos Admin", async () => {
  const { raw, database } = fixture();
  try {
    add(raw, "current", { sourceType: "union" });
    for (const status of ["candidate", "approved", "rejected", "archived"]) add(raw, status, { status });
    add(raw, "expired", { until: "2026-10-15T11:59:59.000Z" });
    add(raw, "future-window", { from: "2026-10-15T12:00:01.000Z" });
    add(raw, "future-publish", { publishedAt: "2026-10-15T12:00:01.000Z" });
    add(raw, "withdrawn", { sourcePublication: "withdrawn-a" });
    add(raw, "replaced");
    raw.prepare("UPDATE news_items SET replaced_by_news_id='current' WHERE id='replaced'").run();
    const list = await listPublicNews(database, new URLSearchParams(), now);
    assert.deepEqual(list.items.map((entry) => entry.id), ["current"]);
    assert.equal(list.items[0].primarySource.type, "union");
    assert.equal(await publicNewsDetail(database, "candidate", now), null);
    assert.equal(await publicNewsDetail(database, "withdrawn", now), null);
    const detail = await publicNewsDetail(database, "current", now);
    assert.equal(detail?.sources[0].url, "https://example.invalid/current");
    assert.deepEqual(Object.keys(detail!).sort(), ["body", "featured", "id", "image", "primarySource", "publishedAt", "relevance", "sources", "summary", "title", "topic", "validFrom", "validUntil"].sort());
    assert.ok(!JSON.stringify(detail).includes("actor_user_id"));
  } finally { raw.close(); }
});

test("filtra tema, relevancia, texto editorial y pagina sin duplicar", async () => {
  const { raw, database } = fixture();
  try {
    for (let index = 0; index < 15; index++) add(raw, `item-${String(index).padStart(2, "0")}`,
      { topic: index === 0 ? "Juntas" : "Educación", relevance: index === 0 ? "importante" : "informativa" });
    const first = await listPublicNews(database, new URLSearchParams(), now);
    const second = await listPublicNews(database, new URLSearchParams("page=1"), now);
    assert.equal(first.items.length, 12);
    assert.equal(first.nextPage, 1);
    assert.equal(second.items.length, 3);
    assert.equal(second.nextPage, null);
    assert.equal(new Set([...first.items, ...second.items].map((entry) => entry.id)).size, 15);
    assert.deepEqual(first.topics, ["Educación", "Juntas"]);
    const filtered = await listPublicNews(database, new URLSearchParams("topic=Juntas&relevance=importante&q=Contenido"), now);
    assert.deepEqual(filtered.items.map((entry) => entry.id), ["item-00"]);
    assert.deepEqual((await listPublicNews(database, new URLSearchParams("q=sin-coincidencia"), now)).items, []);
    await assert.rejects(listPublicNews(database, new URLSearchParams("page=1000"), now), RangeError);
  } finally { raw.close(); }
});

test("Inicio entrega hasta cinco noticias vigentes, urgentes primero y sin duplicar oportunidades", async () => {
  const { raw, database } = fixture();
  try {
    add(raw, "urgent", { relevance: "urgente" });
    add(raw, "important-training", { relevance: "importante", origin: "training-a" });
    add(raw, "important", { relevance: "importante" });
    add(raw, "featured", { featured: 1 });
    add(raw, "more-featured", { featured: 1 });
    add(raw, "more-important", { relevance: "importante" });
    add(raw, "ordinary");
    const result = await listPublicNews(database, new URLSearchParams("home=1&exclude=training-a,designation-a"), now);
    assert.equal(result.items[0].id, "urgent");
    assert.equal(result.items.length, 5);
    assert.ok(result.items.every((entry) => entry.id !== "important-training" && entry.id !== "ordinary"));
    assert.equal(result.items.filter((entry) => entry.relevance !== "urgente").length, 4);
  } finally { raw.close(); }
});

test("Inicio sin noticias editoriales conserva solo el banner original", async () => {
  const { raw, database } = fixture();
  try {
    assert.deepEqual((await listPublicNews(database, new URLSearchParams("home=1"), now)).items, []);
    add(raw, "candidate", { status: "candidate", featured: 1 });
    assert.deepEqual((await listPublicNews(database, new URLSearchParams("home=1"), now)).items, []);
  } finally { raw.close(); }
});

test("una destacada antigua permanece en Noticias pero sale del carrusel", async () => {
  const { raw, database } = fixture();
  try {
    add(raw, "old-featured", { featured: 1, publishedAt: "2026-09-01T12:00:00.000Z" });
    assert.equal((await listPublicNews(database, new URLSearchParams(), now)).items.length, 1);
    assert.deepEqual((await listPublicNews(database, new URLSearchParams("home=1"), now)).items, []);
  } finally { raw.close(); }
});

test("el listado editorial presenta urgentes antes de destacadas y conserva la fuente", async () => {
  const { raw, database } = fixture();
  try {
    add(raw, "featured", { featured: 1, sourceType: "media" });
    add(raw, "urgent", { relevance: "urgente", sourceType: "union" });
    const result = await listPublicNews(database, new URLSearchParams(), now);
    assert.deepEqual(result.items.map((entry) => entry.id), ["urgent", "featured"]);
    assert.deepEqual(result.items.map((entry) => entry.primarySource.type), ["union", "media"]);
  } finally { raw.close(); }
});

test("contenido completo e imagen acreditada son públicos; derechos internos y medios incompletos no", async () => {
  const { raw, database } = fixture();
  try {
    add(raw, "with-image");
    add(raw, "old-news");
    add(raw, "incomplete-image");
    raw.prepare(`UPDATE news_items SET editorial_body=?,hero_image_url=?,hero_image_alt=?,hero_image_credit=?,
      hero_image_source_url=?,hero_image_rights_note=?,hero_image_rights_url=? WHERE id='with-image'`)
      .run("Cuerpo editorial original.", "https://ejemplo.org/foto.webp", "Aula ilustrada", "Autor sintético",
        "https://ejemplo.org/origen", "Licencia acreditada", "https://ejemplo.org/licencia");
    raw.prepare("UPDATE news_items SET hero_image_url=? WHERE id='incomplete-image'").run("https://ejemplo.org/no-acreditada.webp");
    const detail = await publicNewsDetail(database, "with-image", now);
    assert.equal(detail?.body, "Cuerpo editorial original.");
    assert.deepEqual(detail?.image, { url: "https://ejemplo.org/foto.webp", alt: "Aula ilustrada",
      credit: "Autor sintético", sourceUrl: "https://ejemplo.org/origen", kind: "credited" });
    assert.ok(!JSON.stringify(detail).includes("Licencia acreditada"));
    assert.ok(!JSON.stringify(detail).includes("/licencia"));
    assert.equal((await publicNewsDetail(database, "old-news", now))?.body, null);
    assert.equal((await publicNewsDetail(database, "old-news", now))?.image.kind, "illustration");
    assert.equal((await publicNewsDetail(database, "incomplete-image", now))?.image.kind, "illustration");
    assert.equal((await listPublicNews(database, new URLSearchParams(), now)).items.find((entry) => entry.id === "incomplete-image")?.image.kind, "illustration");
  } finally { raw.close(); }
});

test("noticias nuevas sin imagen usan una única biblioteca por tema en listado, detalle e Inicio", async () => {
  const { raw, database } = fixture();
  try {
    const topics = ["Capacitaciones", "Designaciones SIME", "Comunicados de Juntas", "Resoluciones",
      "Educación secundaria", "Actualidad gremial", "Tecnología educativa", "Actualidad"];
    const files = ["training", "designation", "boards", "regulations", "education", "union", "technology", "general"];
    topics.forEach((topic, index) => add(raw, `category-${index}`, { topic, featured: index < 5 ? 1 : 0 }));
    const list = await listPublicNews(database, new URLSearchParams(), now);
    assert.equal(list.items.length, 8);
    for (let index = 0; index < topics.length; index++) {
      const expected = `/assets/news-editorial/${files[index]}.svg`;
      const entry = list.items.find((news) => news.id === `category-${index}`)!;
      assert.equal(entry.image.url, expected);
      assert.equal(entry.image.kind, "illustration");
      assert.match(entry.image.alt, /no representa el hecho/);
      assert.equal((await publicNewsDetail(database, entry.id, now))?.image.url, expected);
      assert.ok(existsSync(new URL(`../public${expected}`, import.meta.url)));
      assert.equal(raw.prepare("SELECT hero_image_url FROM news_items WHERE id=?").get(entry.id)?.hero_image_url, null);
    }
    const home = await listPublicNews(database, new URLSearchParams("home=1"), now);
    assert.equal(home.items.length, 5);
    assert.ok(home.items.every((entry) => entry.image.url === list.items.find((news) => news.id === entry.id)?.image.url));
    assert.equal(new Set(list.items.map((entry) => entry.image.url)).size, 8);
  } finally { raw.close(); }
});

test("API pública solo exporta GET y no consulta identidad, auditoría o borradores", () => {
  const route = readFileSync(new URL("../app/api/news/route.ts", import.meta.url), "utf8");
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function (?:POST|PUT|PATCH|DELETE)/);
  const query = readFileSync(new URL("./public-news.ts", import.meta.url), "utf8");
  assert.doesNotMatch(query, /FROM news_events|FROM "user"|FROM "session"|FROM community_moderators/);
});

test("Noticias usa URL propia, menú e Inicio sin ocupar la navegación inferior", () => {
  const app = readFileSync(new URL("../app/docente-app.tsx", import.meta.url), "utf8");
  const sidebar = readFileSync(new URL("../components/app-sidebar.tsx", import.meta.url), "utf8");
  const component = readFileSync(new URL("../components/public-news.tsx", import.meta.url), "utf8");
  assert.match(sidebar, /\["noticias", "Noticias"/);
  assert.match(app, /view === "noticias" \? <PublicNewsSection \/>/);
  assert.match(app, /<HomeNewsCarousel name=/);
  assert.doesNotMatch(app, /\["inicio", "comunidad", "agenda", "perfil", "cuentas", "noticias"\]/);
  assert.match(component, /newsDetail: true/);
  assert.match(component, /window\.addEventListener\("popstate", onPop\)/);
  assert.doesNotMatch(component, /dangerouslySetInnerHTML/);
});
