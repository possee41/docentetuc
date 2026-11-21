import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { APP_PUBLICATIONS_QUERY } from "./app-publications-query.ts";
import { publicationSearchQuery, searchCursor } from "./publication-search.ts";

// Frozen contract before the optimization: selection and final ordering must match.
const previousQuery = `SELECT * FROM publications WHERE id IN (
  SELECT id FROM (SELECT id FROM publications WHERE kind='informacion'
    AND (CASE WHEN json_valid(metadata) THEN json_extract(metadata,'$.official.canonicalId') IS NULL ELSE 1 END)
    ORDER BY updated_at DESC, id DESC LIMIT 40)
  UNION ALL
  SELECT id FROM (SELECT id FROM publications WHERE kind IN ('vacante','capacitacion','junta')
    AND (CASE WHEN json_valid(metadata) THEN json_extract(metadata,'$.official.canonicalId') IS NULL ELSE 1 END)
    ORDER BY CASE WHEN ends_at >= datetime('now') THEN 0 WHEN starts_at >= datetime('now') THEN 1 ELSE 2 END,
      updated_at DESC, id DESC LIMIT 400)
)
  ORDER BY CASE WHEN kind='informacion' THEN 0 ELSE 1 END,
    CASE WHEN ends_at >= datetime('now') THEN 0 WHEN starts_at >= datetime('now') THEN 1 ELSE 2 END,
    updated_at DESC, id DESC LIMIT 400`;

test("mismas filas completas y orden ante fechas, alias, JSON inválido, empates y cupo informativo", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE publications(id TEXT PRIMARY KEY NOT NULL,kind TEXT,metadata TEXT,ends_at TEXT,starts_at TEXT,updated_at TEXT,summary TEXT)");
    const insert = db.prepare("INSERT INTO publications VALUES(?,?,?,?,?,?,?)");
    const now = "2026-10-30 12:00:00";
    const fixed = (sql: string) => sql.replaceAll("datetime('now')", `'${now}'`);
    const check = () => assert.deepEqual(db.prepare(fixed(APP_PUBLICATIONS_QUERY)).all(), db.prepare(fixed(previousQuery)).all());
    check();
    const kinds = ["informacion", "vacante", "capacitacion", "junta", "otro", null];
    const metadata = ["{}", "invalid", null, '{"official":{"canonicalId":"alias"}}', '{"official":{"canonicalId":null}}', '{"official":{"canonicalId":""}}', "null"];
    const dates = [null, "2020-01-01", now, "2030-01-01"];
    db.exec("BEGIN");
    for (let i = 0; i < 7200; i++) insert.run(`id:${i.toString().padStart(5, "0")}`, kinds[i % kinds.length], metadata[i % metadata.length],
      dates[i % dates.length], dates[Math.floor(i / 4) % dates.length], i % 3 ? "2026-10-29" : null, `Texto completo ${i}`);
    db.exec("COMMIT");
    check();
    for (const count of [0, 1, 39, 40, 41]) {
      db.exec("DELETE FROM publications WHERE kind='informacion'");
      for (let i = 0; i < count; i++) insert.run(`info:${count}:${i}`, "informacion", "{}", dates[i % 4], dates[(i+1) % 4], "2026-10-30", "Información");
      check();
    }
    db.exec("DELETE FROM publications WHERE kind<>'informacion' OR kind IS NULL");
    check();
  } finally { db.close(); }
});

test("la carga inicial queda acotada y el catálogo anterior sigue navegable por páginas", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE publications (id TEXT PRIMARY KEY, kind TEXT, metadata TEXT, ends_at TEXT, starts_at TEXT, updated_at TEXT)");
  const insert = db.prepare("INSERT INTO publications VALUES (?, ?, '{}', NULL, NULL, ?)");
  db.exec("BEGIN");
  for (let index = 0; index < 1501; index++) insert.run(`junta:${index}`, "junta", "2026-10-11");
  insert.run("infd:curso-2026", "capacitacion", "2026-08-01");
  insert.run("call:verified", "junta", "2026-01-01");
  db.prepare("UPDATE publications SET metadata=? WHERE id='call:verified'").run(JSON.stringify({ official: { entity: "opportunity" } }));
  db.exec("COMMIT");
  const rows = db.prepare(APP_PUBLICATIONS_QUERY).all() as { id: string }[];
  assert.equal(rows.length, 400);
  assert.ok(!rows.some((row) => row.id === "infd:curso-2026"));
  const query = publicationSearchQuery("", undefined, 20, "all");
  let cursor = "";
  const found = new Set<string>();
  do {
    const page = publicationSearchQuery("", cursor || undefined, 20, "all");
    const records = db.prepare(page.sql).all(...page.params) as { id: string; updated_at: string }[];
    for (const row of records.slice(0, 20)) found.add(row.id);
    cursor = records.length > 20 ? searchCursor(records[19]) : "";
  } while (cursor);
  assert.equal(found.size, 1503);
  assert.ok(found.has("infd:curso-2026"));
  assert.ok(found.has("call:verified"));
  assert.ok(query.sql.includes("LIMIT 21"));
  db.close();
});
