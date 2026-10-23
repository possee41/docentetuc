// Ephemeral Miniflare D1 only: check additive news migrations and app rollback compatibility.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Miniflare } = require("../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare");
const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('local'); } }", d1Databases: ["DB"] });

try {
  const db = await mf.getD1Database("DB");
  await db.exec("CREATE TABLE user(id TEXT PRIMARY KEY); CREATE TABLE publications(id TEXT PRIMARY KEY,title TEXT NOT NULL)");
  await db.prepare("INSERT INTO publications(id,title) VALUES(?,?)").bind("source-a", "Fuente sintética").run();
  for (const file of ["0021_news_editorial.sql", "0022_news_media_content.sql"]) {
    const sql = readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8")
      .split("\n").filter((line) => !line.trimStart().startsWith("--")).join(" ")
      .split(";").map((statement) => statement.trim()).filter(Boolean).join(";\n") + ";";
    if (file.startsWith("0022")) await db.prepare("INSERT INTO news_items(id,editorial_title) VALUES(?,?)").bind("old", "Titular previo").run();
    await db.exec(sql);
  }
  const old = await db.prepare("SELECT id,editorial_title,editorial_body,hero_image_url FROM news_items WHERE id=?").bind("old").first();
  const publication = await db.prepare("SELECT title FROM publications WHERE id=?").bind("source-a").first();
  const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'news_%' ORDER BY name").all();
  assert.deepEqual(tables.results.map((row) => row.name), ["news_events", "news_items", "news_sources"]);
  assert.equal(publication?.title, "Fuente sintética");
  assert.equal(old?.editorial_title, "Titular previo");
  assert.equal(old?.editorial_body, null);
  assert.equal(old?.hero_image_url, null);
  // Old application queries still work: rollback is the Worker version, not DROP TABLE.
  assert.equal((await db.prepare("SELECT id,editorial_title FROM news_items WHERE id=?").bind("old").first())?.id, "old");
  console.log(JSON.stringify({ database: "Miniflare D1 efímera", migrations: ["0021", "0022"],
    oldNewsPreserved: true, publicationsPreserved: true, oldAppQueryCompatible: true }));
} finally {
  await mf.dispose();
}
