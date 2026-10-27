// Ephemeral Miniflare D1. Rebuild the published 1.1 schema from its Git commit.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { APP_PUBLICATIONS_QUERY } from "../lib/app-publications-query.ts";
import { adminDashboard } from "../lib/admin-data.ts";
import { requireCommunityAdmin } from "../lib/community-admin.ts";
import { listPublicNews } from "../lib/public-news.ts";

const require = createRequire(import.meta.url);
const { Miniflare } = require("../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare");
const base = "d321e7225e7dc75ff76a0e612525386855e05e08";
const publishedFiles = execFileSync("git", ["ls-tree", "-r", "--name-only", base, "migrations"], { encoding: "utf8" }).split(/\r?\n/);
const baseline = ["drizzle/0000_docentetuc.sql", "drizzle/0001_training_metadata.sql",
  "drizzle/0002_reminders_ai.sql", "drizzle/0003_web_push.sql",
  ...Array.from({ length: 19 }, (_, index) => `migrations/${String(index + 2).padStart(4, "0")}_`)].map((entry) => {
    if (!entry.endsWith("_")) return entry;
    const file = publishedFiles.find((name) => name.startsWith(entry));
    assert.ok(file, `Missing published 1.1 migration ${entry}`);
    return file;
  });
const additions = ["0021_news_editorial.sql", "0022_news_media_content.sql",
  "0025_external_publication_events.sql", "0026_juntas_incremental.sql",
  "0027_personal_catalog_index.sql", "0028_external_notice_cycle.sql"];
const publishedSql = (file) => execFileSync("git", ["show", `${base}:${file}`], { encoding: "utf8", maxBuffer: 2_000_000 });
async function applySql(db, sql) {
  const blocks = sql.replace(/\r/g, "").split(/\n\s*\n|--> statement-breakpoint/);
  for (const block of blocks) {
    const clean = block.split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n").trim();
    if (!clean) continue;
    const statements = /^CREATE TRIGGER\b/i.test(clean) ? [clean] : clean.split(";");
    for (const statement of statements) if (statement.trim()) await db.prepare(statement.trim()).run();
  }
}
const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('local'); } }", d1Databases: ["DB"] });
const account = "550e8400-e29b-41d4-a716-446655440000";
const publication = "1.1:synthetic-publication";

try {
  const db = await mf.getD1Database("DB");
  await db.exec("PRAGMA foreign_keys=ON");
  for (const file of baseline) await applySql(db, publishedSql(file));
  await db.prepare('INSERT INTO "user"(id,name,email,createdAt,updatedAt) VALUES(?,?,?,?,?)')
    .bind(account, "Docente de prueba", "test@example.invalid", 1, 1).run();
  await db.prepare("INSERT INTO profiles(user_id,name,level) VALUES(?,?,?)")
    .bind(account, "Perfil de prueba", "Primaria").run();
  await db.prepare("INSERT INTO publications(id,source,external_id,kind,category,title,official_url,content_hash) VALUES(?,?,?,?,?,?,?,?)")
    .bind(publication, "Fuente de prueba", "one", "capacitacion", "Capacitaciones", "Publicación anterior", "https://example.invalid/one", "hash-one").run();
  await db.prepare("INSERT INTO saved_publications(user_id,publication_id,in_agenda,followed) VALUES(?,?,1,1)")
    .bind(account, publication).run();
  await db.prepare("INSERT INTO notifications(user_id,publication_id,type) VALUES(?,?,'NOVEDAD')")
    .bind(account, publication).run();
  await db.prepare("INSERT INTO community_moderators(user_id,role) VALUES(?,'admin')").bind(account).run();
  const before = await db.prepare("SELECT p.name,p.level,s.publication_id,s.in_agenda,s.followed,n.type,x.title FROM profiles p JOIN saved_publications s ON s.user_id=p.user_id JOIN notifications n ON n.user_id=p.user_id AND n.publication_id=s.publication_id JOIN publications x ON x.id=s.publication_id WHERE p.user_id=?")
    .bind(account).first();
  assert.ok(before);
  const oldTables = ["user", "profiles", "publications", "saved_publications", "notifications", "sync_state"];
  const columnsBefore = await Promise.all(oldTables.map(async (table) =>
    (await db.prepare(`PRAGMA table_info(${table})`).all()).results.map((column) => column.name)));
  for (const file of additions) await applySql(db, readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  for (const [index, table] of oldTables.entries())
    assert.deepEqual((await db.prepare(`PRAGMA table_info(${table})`).all()).results.map((column) => column.name), columnsBefore[index]);
  const after = await db.prepare("SELECT p.name,p.level,s.publication_id,s.in_agenda,s.followed,n.type,x.title FROM profiles p JOIN saved_publications s ON s.user_id=p.user_id JOIN notifications n ON n.user_id=p.user_id AND n.publication_id=s.publication_id JOIN publications x ON x.id=s.publication_id WHERE p.user_id=?")
    .bind(account).first();
  assert.deepEqual(after, before);
  assert.equal((await db.prepare(APP_PUBLICATIONS_QUERY).all()).results.some((row) => row.id === publication), true);
  assert.equal((await db.prepare("SELECT title FROM publications WHERE id=?").bind(publication).first())?.title, "Publicación anterior");
  assert.equal((await db.prepare("SELECT source,last_successful_sync_at FROM sync_state ORDER BY source").all()).results.length, 0);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM external_event_sources").first())?.n, 0);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM external_publication_events").first())?.n, 0);
  await db.prepare("INSERT INTO news_items(id,status,editorial_title,editorial_summary,published_at) VALUES(?,'published',?,?,?)")
    .bind("news:synthetic", "Noticia de prueba", "Resumen ficticio", "2026-10-27T10:00:00.000Z").run();
  await db.prepare("INSERT INTO news_sources(id,news_item_id,source_name,source_title,url,normalized_url,source_type,is_primary) VALUES(?,?,?,?,?,?,?,1)")
    .bind("source:synthetic", "news:synthetic", "Fuente de prueba", "Nota de prueba", "https://example.invalid/news", "https://example.invalid/news", "official").run();
  const news = await listPublicNews(db, new URLSearchParams(), new Date("2026-10-27T12:00:00.000Z"));
  assert.equal(news.items?.[0]?.title, "Noticia de prueba");
  assert.equal(await requireCommunityAdmin(db, account), account);
  await assert.rejects(requireCommunityAdmin(db, "6ba7b810-9dad-41d1-80b4-00c04fd430c8"), { status: 403 });
  const admin = await adminDashboard(db);
  assert.equal(admin.counts.users, 1);
  assert.equal((await db.prepare("PRAGMA foreign_key_check").all()).results.length, 0);
  console.log(JSON.stringify({ database: "Miniflare D1 efímera", base, migrations: additions.map((name) => name.slice(0, 4)),
    profilePreserved: true, savedPreserved: true, notificationPreserved: true, publicationPreserved: true,
    legacyTablesUnchanged: true, legacyReadsCompatible: true, publicSelection: true, newsRouteQuery: true, adminAuthorized: true,
    adminDenied: true, foreignKeys: "ok" }));
} finally {
  await mf.dispose();
}
