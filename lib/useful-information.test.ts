import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { APP_PUBLICATIONS_QUERY } from "./app-publications-query.ts";
import { usefulInformation } from "./useful-information.ts";

const search = (query: string) => usefulInformation.filter((item) => JSON.stringify(item).toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(query.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "")));

for (const query of ["no cobre", "me liquidaron mal", "Junta Secundaria", "legajo", "certificado FDCI", "jubilacion", "CIIDEPT", "DigiTUC", "titulo", "licencia", "expediente"]) {
  test(`encuentra información útil para ${query}`, () => assert.ok(search(query).length > 0));
}

test("toda ficha conserva fuente y fecha de verificación", () => {
  for (const item of usefulInformation) { assert.match(item.officialUrl, /^https:\/\//); assert.match(item.metadata.lastVerified, /^\d{4}-\d{2}-\d{2}$/); }
});

test("/api/app conserva Información útil aunque haya más publicaciones que el límite", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE publications (id TEXT PRIMARY KEY, kind TEXT, starts_at TEXT, ends_at TEXT, updated_at TEXT)");
    const insert = db.prepare("INSERT INTO publications VALUES (?, ?, NULL, NULL, ?)");
    for (let index = 0; index < 1501; index++) insert.run(`other:${index}`, "vacante", "2026-09-30");
    for (const item of usefulInformation) insert.run(`info:${item.id}`, "informacion", "2026-09-27");
    const rows = db.prepare(APP_PUBLICATIONS_QUERY).all() as { kind: string }[];
    assert.equal(rows.filter((row) => row.kind === "vacante").length, 1500);
    assert.equal(rows.filter((row) => row.kind === "informacion").length, usefulInformation.length);
  } finally { db.close(); }
});
