import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
    assert.deepEqual(Object.keys(detail!).sort(), ["featured", "id", "primarySource", "publishedAt", "relevance", "sources", "summary", "title", "topic", "validFrom", "validUntil"].sort());
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

test("Inicio prioriza una urgente y hasta dos importantes/destacadas sin duplicar oportunidades", async () => {
  const { raw, database } = fixture();
  try {
    add(raw, "urgent", { relevance: "urgente" });
    add(raw, "important-training", { relevance: "importante", origin: "training-a" });
    add(raw, "important", { relevance: "importante" });
    add(raw, "featured", { featured: 1 });
    add(raw, "ordinary");
    const result = await listPublicNews(database, new URLSearchParams("home=1&exclude=training-a,designation-a"), now);
    assert.equal(result.items[0].id, "urgent");
    assert.equal(result.items.length, 3);
    assert.ok(result.items.every((entry) => entry.id !== "important-training" && entry.id !== "ordinary"));
    assert.equal(result.items.filter((entry) => entry.relevance !== "urgente").length, 2);
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
  assert.match(app, /<HomeNews excludedOriginIds=/);
  assert.doesNotMatch(app, /\["inicio", "comunidad", "agenda", "perfil", "cuentas", "noticias"\]/);
  assert.match(component, /newsDetail: true/);
  assert.match(component, /window\.addEventListener\("popstate", onPop\)/);
});
