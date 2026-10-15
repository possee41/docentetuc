import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { isNewsRelevance, isNewsSourceType, isNewsStatus, isNewsWindow, normalizeNewsImage, normalizeNewsSourceUrl } from "./news-editorial.ts";

const migration = readFileSync(new URL("../migrations/0021_news_editorial.sql", import.meta.url), "utf8");
const mediaMigration = readFileSync(new URL("../migrations/0022_news_media_content.sql", import.meta.url), "utf8");

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE "user"(id TEXT PRIMARY KEY);
    CREATE TABLE publications(id TEXT PRIMARY KEY, title TEXT NOT NULL);
    INSERT INTO "user" VALUES('admin-a');
    INSERT INTO publications VALUES('source-a', 'Publicación original');`);
  const before = db.prepare("SELECT * FROM publications").all();
  db.exec(migration);
  return { db, before };
}

function item(db: DatabaseSync, id = "news-a", origin: string | null = "source-a") {
  db.prepare("INSERT INTO news_items(id, origin_publication_id, created_by_user_id) VALUES(?,?,?)").run(id, origin, "admin-a");
}

function source(db: DatabaseSync, id: string, options: { news?: string; publication?: string | null; url?: string; primary?: number; type?: string } = {}) {
  const url = options.url ?? `https://educaciontuc.gov.ar/${id}`;
  db.prepare(`INSERT INTO news_sources(id,news_item_id,publication_id,source_name,source_title,url,normalized_url,source_type,is_primary)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(id, options.news ?? "news-a", options.publication ?? null, "Ministerio", "Fuente", url, normalizeNewsSourceUrl(url) ?? url, options.type ?? "official", options.primary ?? 0);
}

test("0021 crea solo tablas vacías, índices y conserva publications", () => {
  const { db, before } = fixture();
  try {
    assert.deepEqual(db.prepare("SELECT * FROM publications").all(), before);
    for (const table of ["news_items", "news_sources", "news_events"]) {
      assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n, 0);
    }
    const names = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[]).map((row) => row.name));
    for (const name of ["idx_news_items_origin", "idx_news_items_status_updated", "idx_news_items_public_window",
      "idx_news_sources_primary", "idx_news_sources_publication", "idx_news_sources_url", "idx_news_sources_publication_lookup",
      "idx_news_sources_url_lookup", "idx_news_events_item_created"]) assert.ok(names.has(name), name);
    assert.doesNotMatch(migration, /^\s*(?:UPDATE|DELETE|DROP|ALTER)\b/im);
  } finally { db.close(); }
});

test("0022 agrega contenido e imagen opcionales sin alterar noticias de 0021", () => {
  const { db } = fixture();
  try {
    item(db);
    const before = db.prepare("SELECT id,status,editorial_title,editorial_summary FROM news_items").all();
    db.exec(mediaMigration);
    assert.deepEqual(db.prepare("SELECT id,status,editorial_title,editorial_summary FROM news_items").all(), before);
    const row = db.prepare(`SELECT editorial_body,hero_image_url,hero_image_alt,hero_image_credit,
      hero_image_source_url,hero_image_rights_note,hero_image_rights_url FROM news_items`).get();
    assert.ok(row && Object.values(row).every((value) => value === null));
    assert.doesNotMatch(mediaMigration, /^\s*(?:UPDATE|DELETE|DROP|CREATE TABLE)\b/im);
    assert.throws(() => db.prepare("UPDATE news_items SET hero_image_alt=? WHERE id='news-a'").run("x".repeat(241)));
  } finally { db.close(); }
});

test("0021 restringe estado, relevancia, booleanos, ventanas y origen duplicado", () => {
  const { db } = fixture();
  try {
    item(db);
    for (const [column, value] of [["status", "unknown"], ["relevance", "critical"], ["featured", 2],
      ["valid_from", "2026-99-14T00:00:00.000Z"], ["valid_from", "2026-02-30T00:00:00.000Z"],
      ["valid_until", "yesterday"]] as const) {
      assert.throws(() => db.prepare(`UPDATE news_items SET ${column}=? WHERE id='news-a'`).run(value));
    }
    assert.throws(() => db.prepare("UPDATE news_items SET valid_from=?, valid_until=? WHERE id='news-a'")
      .run("2026-10-15T00:00:00.000Z", "2026-10-14T00:00:00.000Z"));
    assert.throws(() => item(db, "news-b"));
    item(db, "news-b", null);
    item(db, "news-c", null);
    db.prepare("UPDATE news_items SET replaced_by_news_id='news-b' WHERE id='news-a'").run();
    assert.throws(() => db.prepare("UPDATE news_items SET replaced_by_news_id='news-a' WHERE id='news-a'").run());
    assert.throws(() => db.prepare("UPDATE news_items SET replaced_by_news_id='missing' WHERE id='news-a'").run());
  } finally { db.close(); }
});

test("0021 limita fuentes principales y duplicadas, tipos y claves foráneas", () => {
  const { db } = fixture();
  try {
    item(db);
    source(db, "a", { publication: "source-a", primary: 1 });
    assert.throws(() => source(db, "b", { primary: 1 }));
    assert.throws(() => source(db, "b", { publication: "source-a" }));
    assert.throws(() => source(db, "b", { url: "https://educaciontuc.gov.ar/a#seccion" }));
    assert.throws(() => source(db, "b", { type: "unknown" }));
    assert.throws(() => source(db, "b", { news: "missing" }));
    assert.throws(() => source(db, "b", { publication: "missing" }));
    assert.throws(() => source(db, "b", { url: "http://example.invalid" }));
    assert.throws(() => db.prepare("UPDATE news_sources SET is_primary=3 WHERE id='a'").run());
    assert.throws(() => db.prepare("DELETE FROM news_items WHERE id='news-a'").run());
  } finally { db.close(); }
});

test("0021 audita con JSON acotado y actor desvinculable", () => {
  const { db } = fixture();
  try {
    item(db);
    const insert = db.prepare(`INSERT INTO news_events(id,news_item_id,actor_user_id,actor_kind,action,previous_status,next_status,details)
      VALUES(?,?,?,?,?,?,?,?)`);
    insert.run("event-a", "news-a", "admin-a", "admin", "create_candidate", null, "candidate", "{}");
    assert.throws(() => insert.run("bad-action", "news-a", null, "system", "invented", null, null, "{}"));
    assert.throws(() => insert.run("bad-json", "news-a", null, "system", "edit", null, null, "not-json"));
    assert.throws(() => insert.run("large-json", "news-a", null, "system", "edit", null, null, JSON.stringify({ x: "x".repeat(2048) })));
    assert.throws(() => insert.run("missing-news", "absent", null, "system", "edit", null, null, "{}"));
    db.prepare("DELETE FROM \"user\" WHERE id='admin-a'").run();
    assert.equal((db.prepare("SELECT actor_user_id AS actor FROM news_events WHERE id='event-a'").get() as { actor: string | null }).actor, null);
    assert.equal((db.prepare("SELECT created_by_user_id AS actor FROM news_items WHERE id='news-a'").get() as { actor: string | null }).actor, null);
    assert.throws(() => db.prepare("DELETE FROM news_items WHERE id='news-a'").run());
  } finally { db.close(); }
});

test("validaciones puras preparan entradas sin publicar ni consultar datos", () => {
  assert.ok(isNewsStatus("published"));
  assert.ok(!isNewsStatus("urgent"));
  assert.ok(isNewsRelevance("urgente"));
  assert.ok(!isNewsRelevance("approved"));
  assert.ok(isNewsSourceType("union"));
  assert.ok(!isNewsSourceType("personal"));
  assert.equal(normalizeNewsSourceUrl("HTTPS://Ejemplo.com:443/ruta?x=1#fragmento"), "https://ejemplo.com/ruta?x=1");
  for (const url of ["http://example.com", "https://user:secret@example.com", "javascript:alert(1)", "https://"]) {
    assert.equal(normalizeNewsSourceUrl(url), null);
  }
  assert.ok(isNewsWindow("2026-10-14T00:00:00.000Z", "2026-10-15T00:00:00.000Z"));
  assert.ok(isNewsWindow(null, null));
  assert.ok(!isNewsWindow("2026-02-30T00:00:00.000Z", null));
  assert.ok(!isNewsWindow("2026-10-15T00:00:00.000Z", "2026-10-14T00:00:00.000Z"));
  const image = { imageUrl: "https://ejemplo.org/foto.webp", imageAlt: "Aula vacía", imageCredit: "DocenteTuc",
    imageSourceUrl: "https://ejemplo.org/origen", imageRightsNote: "Licencia expresa", imageRightsUrl: "https://ejemplo.org/licencia" };
  assert.equal(normalizeNewsImage(image)?.url, image.imageUrl);
  assert.equal(normalizeNewsImage({}), null);
  assert.equal(normalizeNewsImage({ ...image, imageRightsUrl: "" }), undefined);
  assert.equal(normalizeNewsImage({ ...image, imageUrl: "javascript:alert(1)" }), undefined);
});
