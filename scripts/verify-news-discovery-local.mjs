// One read of each public feed; all writes go to an ephemeral Miniflare D1.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { newsAdminDetail, mutateNewsAdmin } from "../lib/news-admin.ts";
import { listPublicNews } from "../lib/public-news.ts";
import { runNewsDiscovery } from "./discover-news.mjs";

const require = createRequire(import.meta.url);
const { Miniflare } = require("../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare");
const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('isolated'); } }", d1Databases: ["DB"] });
const admin = "550e8400-e29b-41d4-a716-446655440000";

try {
  const db = await mf.getD1Database("DB");
  await db.exec(`CREATE TABLE "user"(id TEXT PRIMARY KEY,name TEXT);
    CREATE TABLE community_moderators(user_id TEXT PRIMARY KEY,role TEXT NOT NULL);
    CREATE TABLE publications(id TEXT PRIMARY KEY,title TEXT,official_url TEXT,removed_at TEXT);`);
  for (const name of ["0021_news_editorial.sql", "0022_news_media_content.sql"]) {
    const sql = readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8")
      .split("\n").filter((line) => !line.trimStart().startsWith("--")).join(" ")
      .split(";").map((statement) => statement.trim()).filter(Boolean).join(";\n") + ";";
    await db.exec(sql);
  }
  await db.prepare("INSERT INTO \"user\" VALUES(?,?)").bind(admin, "Admin de prueba").run();
  await db.prepare("INSERT INTO community_moderators VALUES(?,'admin')").bind(admin).run();
  const first = await runNewsDiscovery({ database: db });
  const second = await runNewsDiscovery({ database: db });
  assert.ok(first.find((row) => row.source === "ministry")?.created > 0, "The live Ministry feed needs a recent article");
  assert.ok(second.every((row) => row.ok && row.created === 0), "A repeated scan must not create duplicate candidates");
  const candidate = await db.prepare(`SELECT id FROM news_items WHERE status='candidate' ORDER BY created_at DESC LIMIT 1`).first();
  assert.ok(candidate?.id);
  let { item, sources } = await newsAdminDetail(db, candidate.id);
  assert.equal(sources[0].is_primary, 1);
  assert.equal((await listPublicNews(db, new URLSearchParams())).items.length, 0);
  // This editor text exists only in ephemeral D1; a real publication still requires human review.
  await mutateNewsAdmin(db, admin, { action: "edit", id: item.id, updatedAt: item.updated_at,
    title: item.editorial_title, summary: "Publicación del Ministerio de Educación de Tucumán. Consultá la fuente original para conocer los detalles.",
    body: "", topic: "Educación", relevance: "importante", validFrom: null, validUntil: null });
  ({ item } = await newsAdminDetail(db, item.id));
  await mutateNewsAdmin(db, admin, { action: "approve", id: item.id, updatedAt: item.updated_at });
  ({ item } = await newsAdminDetail(db, item.id));
  await mutateNewsAdmin(db, admin, { action: "publish", id: item.id, updatedAt: item.updated_at });
  ({ item } = await newsAdminDetail(db, item.id));
  await mutateNewsAdmin(db, admin, { action: "feature", id: item.id, updatedAt: item.updated_at });
  const news = (await listPublicNews(db, new URLSearchParams())).items;
  const home = (await listPublicNews(db, new URLSearchParams("home=1"))).items;
  assert.equal(news[0].id, item.id);
  assert.equal(home[0].id, item.id);
  assert.equal(news[0].primarySource.url, sources[0].url);
  assert.equal(news[0].image.kind, "illustration");
  console.log(JSON.stringify({ database: "ephemeral Miniflare D1", first, second,
    verifiedJourney: { title: news[0].title, source: news[0].primarySource.name,
      date: news[0].primarySource.publishedAt, url: news[0].primarySource.url,
      candidateToPublished: true, visibleInNews: true, visibleInHome: true,
      illustration: news[0].image.url } }));
} finally { await mf.dispose(); }
