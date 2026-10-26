import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { APP_PUBLICATIONS_QUERY } from "./app-publications-query.ts";
import { publicationSearchQuery, searchCursor } from "./publication-search.ts";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE publications (
    id TEXT PRIMARY KEY, kind TEXT, source TEXT, category TEXT, title TEXT, summary TEXT,
    level TEXT, area TEXT, junta TEXT, location TEXT, character TEXT, source_circuit_raw TEXT,
    metadata TEXT, starts_at TEXT, ends_at TEXT, updated_at TEXT
  )`);
  const insert = db.prepare("INSERT INTO publications VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)");
  const add = (id: string, title: string, kind = "junta", fields: Record<string, string> = {}) =>
    insert.run(id, kind, fields.source || "Junta Secundaria", fields.category || "Comunicados", title,
      fields.summary || "", fields.level || "", fields.area || "", fields.junta || "",
      fields.location || "", fields.character || "", fields.source_circuit_raw || "",
      fields.metadata || "{}", fields.updated_at || "2026-10-14");
  const search = (term: string, cursor?: string) => {
    const { sql, params } = publicationSearchQuery(term, cursor);
    return db.prepare(sql).all(...params) as { id: string; updated_at: string }[];
  };
  return { db, add, search };
}

test("encuentra una publicación pública fuera de las 1500 cargadas por la app", () => {
  const { db, add, search } = fixture();
  for (let index = 0; index < 1501; index++) add(`recent:${index}`, `Aviso ${index}`);
  add("old:padron", "Padrón de Música", "junta", { category: "Padrones", updated_at: "2025-01-01" });
  assert.equal((db.prepare(APP_PUBLICATIONS_QUERY).all() as { id: string }[]).some(row => row.id === "old:padron"), false);
  assert.deepEqual(search("música").map(row => row.id), ["old:padron"]);
  db.close();
});

test("coincide sin distinción de mayúsculas, acentos y términos parciales", () => {
  const { db, add, search } = fixture();
  add("a", "Matemática en Tafí Viejo", "vacante");
  assert.deepEqual(search("MATEMATICA tafi").map(row => row.id), ["a"]);
  assert.deepEqual(search("matemát").map(row => row.id), ["a"]);
  assert.deepEqual(search("término ausente").map(row => row.id), []);
  db.close();
});

test("busca distintas secciones y campos útiles sin acceder a tablas privadas", () => {
  const { db, add, search } = fixture();
  add("d", "Cargo", "vacante", { location: "Burruyacú" });
  add("t", "Curso", "capacitacion", { area: "Burruyacú" });
  add("i", "Trámite", "informacion", { source: "Burruyacú" });
  add("c", "Comunicado", "junta", { junta: "Burruyacú" });
  add("r", "Resolución", "junta", { category: "Burruyacú" });
  add("p", "Padrón", "junta", { summary: "Burruyacú" });
  add("l", "Llamado", "junta", { source_circuit_raw: "Burruyacú" });
  assert.deepEqual(search("burruyacu").map(row => row.id).sort(), ["c", "d", "i", "l", "p", "r", "t"]);
  db.close();
});

test("encuentra establecimiento y materia presentes solo en metadatos oficiales", () => {
  const { db, add, search } = fixture();
  add("scope", "Cargo disponible", "vacante", { metadata: JSON.stringify({ official: { scope: { school: "Escuela República", subject: "Geografía" } } }) });
  assert.deepEqual(search("republica geografia").map(row => row.id), ["scope"]);
  db.close();
});

test("omite alias duplicados, conserva la publicación canónica", () => {
  const { db, add, search } = fixture();
  add("canonical", "Oferta docente", "vacante");
  add("alias", "Oferta docente", "junta", { metadata: JSON.stringify({ official: { canonicalId: "canonical" } }) });
  assert.deepEqual(search("oferta docente").map(row => row.id), ["canonical"]);
  db.close();
});

test("pagina resultados sin un tope global ni repetir elementos", () => {
  const { db, add, search } = fixture();
  for (let index = 0; index < 47; index++) add(`item:${String(index).padStart(2, "0")}`, "Lengua", "junta", { updated_at: `2026-10-${String(index % 28 + 1).padStart(2, "0")}` });
  const first = search("lengua");
  const second = search("lengua", searchCursor(first[19]));
  const third = search("lengua", searchCursor(second[19]));
  assert.equal(first.length, 21);
  assert.equal(second.length, 21);
  assert.equal(third.length, 7);
  assert.equal(new Set([...first.slice(0, 20), ...second.slice(0, 20), ...third].map(row => row.id)).size, 47);
  db.close();
});

test("permite recorrer una sección completa sin texto de búsqueda", () => {
  const { db, add } = fixture();
  for (let index = 0; index < 48; index++) add(`course:${String(index).padStart(2, "0")}`, "Curso", "capacitacion");
  add("notice", "Aviso", "junta");
  let cursor: string | undefined;
  const found: string[] = [];
  do {
    const { sql, params } = publicationSearchQuery("", cursor, 20, "capacitacion");
    const rows = db.prepare(sql).all(...params) as { id: string; updated_at: string }[];
    found.push(...rows.slice(0, 20).map(row => row.id));
    cursor = rows.length > 20 ? searchCursor(rows[19]) : undefined;
  } while (cursor);
  assert.equal(found.length, 48);
  assert.equal(new Set(found).size, 48);
  assert.ok(!found.includes("notice"));
  db.close();
});

test("rechaza cursores inválidos y no interpreta comodines del usuario", () => {
  const { db, add, search } = fixture();
  add("literal", "Curso 100% presencial");
  add("other", "Curso 1000 presencial");
  assert.deepEqual(search("100%").map(row => row.id), ["literal"]);
  assert.throws(() => publicationSearchQuery("curso", "not-json"));
  db.close();
});
