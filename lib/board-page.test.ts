import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { APP_PUBLICATIONS_QUERY } from "./app-publications-query.ts";
import { boardPageQuery, BOARD_PAGE_SIZE } from "./board-page.ts";
import { boardItems } from "./board-view.ts";
import type { Publication } from "./types.ts";

test("Juntas pages reach documents beyond the global catalog and filter by Junta", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE publications (id TEXT PRIMARY KEY, source TEXT, kind TEXT, category TEXT,
    title TEXT, summary TEXT, metadata TEXT, junta TEXT, level TEXT, registration_close_at TEXT,
    ends_at TEXT, removed_at TEXT, normalized_status TEXT, starts_at TEXT, updated_at TEXT, source_published_at TEXT)`);
  const insert = db.prepare("INSERT INTO publications VALUES (?, 'Padrones y Comunicados', 'junta', ?, ?, '', ?, ?, '', NULL, NULL, NULL, 'UNKNOWN', NULL, '2026-10-25', NULL)");
  for (let n = 0; n < 1600; n++) insert.run(`drive:${String(n).padStart(4, "0")}`, "Padrones", `Padrón ${n}`, "{}", "Inicial y Primaria");
  for (let n = 0; n < 210; n++) insert.run(`notice:${String(n).padStart(3, "0")}`, "Comunicados", `Comunicado oficial ${n}`, "{}", "Secundaria");
  const reference = JSON.stringify({ official: { version: 1, entity: "reference", topics: ["LLAMADO_ABIERTO"], sources: [], facts: {}, scope: {}, issues: [] } });
  for (let n = 0; n < 2273; n++) insert.run(`reference:${String(n).padStart(4, "0")}`, "Llamados abiertos", `Documento de convocatoria ${n} sin vigencia verificada`, reference, "Secundaria");
  const catalog = db.prepare(APP_PUBLICATIONS_QUERY).all() as { id: string }[];
  assert.equal(catalog.length, 1500);
  let cursor = "", count = 0;
  for (;;) {
    const query = boardPageQuery("padrones", "inicial-primaria");
    const rows = db.prepare(query.sql).all(cursor, ...query.binds) as { id: string }[];
    assert.ok(rows.length <= BOARD_PAGE_SIZE + 1);
    const page = rows.slice(0, BOARD_PAGE_SIZE);
    count += page.length;
    if (rows.length <= BOARD_PAGE_SIZE) break;
    cursor = page.at(-1)!.id;
  }
  assert.equal(count, 1600);
  const notices = boardPageQuery("comunicados", "secundaria");
  cursor = ""; count = 0;
  for (;;) {
    const rows = db.prepare(notices.sql).all(cursor, ...notices.binds) as { id: string }[];
    const page = rows.slice(0, BOARD_PAGE_SIZE);
    count += page.length;
    if (rows.length <= BOARD_PAGE_SIZE) break;
    cursor = page.at(-1)!.id;
  }
  assert.equal(count, 210);
  const refs = boardPageQuery("llamados", "secundaria", "references");
  cursor = ""; count = 0;
  for (;;) {
    const rows = db.prepare(refs.sql).all(cursor, ...refs.binds) as Publication[];
    const page = rows.slice(0, BOARD_PAGE_SIZE);
    count += page.length;
    assert.equal(boardItems(page, "llamados").length, 0);
    if (rows.length <= BOARD_PAGE_SIZE) break;
    cursor = page.at(-1)!.id;
  }
  assert.equal(count, 2273);
  const current = boardPageQuery("llamados", "secundaria");
  assert.equal((db.prepare(current.sql).all("", "2026-10-25", "2026-10-25", ...current.binds) as unknown[]).length, 0);
  db.close();
});
