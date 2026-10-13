import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { APP_PUBLICATIONS_QUERY } from "./app-publications-query.ts";

test("la consulta pública conserva capacitaciones aunque haya más de 1500 publicaciones recientes", () => {
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
  assert.ok(rows.some((row) => row.id === "infd:curso-2026"));
  assert.ok(rows.some((row) => row.id === "call:verified"), "una oportunidad estructurada no desaparece por el límite general de 1500 documentos");
  db.close();
});
