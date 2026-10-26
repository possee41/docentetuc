import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { APP_PUBLICATIONS_QUERY } from "./app-publications-query.ts";
import { publicationSearchQuery, searchCursor } from "./publication-search.ts";

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
