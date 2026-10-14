import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { D1Database } from "@cloudflare/workers-types";
import { APP_PUBLICATIONS_QUERY } from "./app-publications-query.ts";
import { buildAIContext } from "./ai.ts";
import { aiSearchTerms, retrieveAIRecords } from "./ai-retrieval.ts";

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE publications (
    id TEXT PRIMARY KEY, kind TEXT, source TEXT, category TEXT, title TEXT, summary TEXT,
    level TEXT DEFAULT '', area TEXT DEFAULT '', junta TEXT DEFAULT '', location TEXT DEFAULT '',
    character TEXT DEFAULT '', source_circuit_raw TEXT DEFAULT '', shift TEXT DEFAULT '',
    starts_at TEXT, ends_at TEXT, status TEXT DEFAULT 'vigente', official_url TEXT DEFAULT '',
    metadata TEXT DEFAULT '{}', first_seen_at TEXT DEFAULT '', updated_at TEXT DEFAULT '',
    source_published_at TEXT, last_changed_at TEXT, normalized_status TEXT DEFAULT 'UNKNOWN',
    registration_open_at TEXT, registration_close_at TEXT, expires_at TEXT, removed_at TEXT,
    source_status TEXT DEFAULT '', external_id TEXT DEFAULT ''
  ); CREATE TABLE saved_publications (user_id TEXT, publication_id TEXT, in_agenda INTEGER, saved_at TEXT);`);
  const add = (id: string, title: string, kind: string, fields: Record<string, string> = {}) => {
    const allowed = new Set(["source", "category", "summary", "level", "area", "junta", "location", "metadata", "updated_at", "source_published_at", "normalized_status", "official_url", "ends_at", "starts_at"]);
    const columns = ["id", "title", "kind", ...Object.keys(fields).filter((key) => allowed.has(key))];
    sqlite.prepare(`INSERT INTO publications (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(id, title, kind, ...columns.slice(3).map((key) => fields[key]));
  };
  const database = { prepare(sql: string) {
    return { bind(...values: unknown[]) {
      const statement = sqlite.prepare(sql);
      return {
        async all<T>() { return { results: statement.all(...values as []) as T[] }; },
        async first<T>() { return statement.get(...values as []) as T | null; },
      };
    }, async all<T>() { return { results: sqlite.prepare(sql).all() as T[] }; } };
  } } as unknown as D1Database;
  return { sqlite, database, add };
}

test("la IA encuentra en D1 un padrón fuera del lote de /api/app y no descarga toda D1", async () => {
  const { sqlite, database, add } = fixture();
  for (let index = 0; index < 1501; index++) add(`recent:${index}`, `Aviso ${index}`, "junta", { category: "Comunicados", updated_at: "2026-10-14" });
  add("old:padron", "Padrón definitivo de Música", "junta", { source: "Padrones y Comunicados", category: "Padrones", updated_at: "2025-01-01", official_url: "https://educaciontuc.gov.ar/padron" });
  assert.equal((sqlite.prepare(APP_PUBLICATIONS_QUERY).all() as { id: string }[]).some((row) => row.id === "old:padron"), false);
  const rows = await retrieveAIRecords(database, "¿Dónde está el padrón de Música?");
  assert.ok(rows.length <= 161);
  assert.equal(buildAIContext("¿Dónde está el padrón de Música?", rows).sources[0]?.id, "old:padron");
  sqlite.close();
});

test("recupera candidatos de distintas fuentes con acentos, áreas y sin alias duplicados", async () => {
  const { sqlite, database, add } = fixture();
  const cases = [
    ["sime", "vacante", "SIME", "Vacante de Filosofía", "¿Qué designaciones de Filosofía hay?"],
    ["fdci", "capacitacion", "Capacitación Docente", "Curso de Química FDCI", "¿Qué capacitaciones de Química hay?"],
    ["infod", "capacitacion", "INFoD / AulaS-TIC", "Curso de Matemática INFoD", "¿Qué cursos de Matemática hay?"],
    ["cenet", "capacitacion", "CeNET / INET", "Curso de Electrónica CeNET", "¿Qué cursos de Electrónica hay?"],
    ["com", "junta", "Padrones y Comunicados", "Comunicado de Secundaria", "¿Qué comunicados de Secundaria hay?"],
    ["res", "junta", "Padrones y Comunicados", "Resolución de Titularización", "¿Qué resolución de Titularización hay?"],
    ["call", "junta", "Padrones y Comunicados", "Llamado de Geografía", "¿Qué llamados de Geografía hay?"],
    ["info", "informacion", "Información oficial Tucumán", "Trámite de Legajo", "¿Dónde hago el trámite de Legajo?"],
  ] as const;
  for (const [id, kind, source, title] of cases) add(id, title, kind, { source, category: id === "com" ? "Comunicados" : id === "res" ? "Resoluciones" : id === "call" ? "Llamados abiertos" : kind, updated_at: "2026-10-14" });
  add("alias", "Llamado de Geografía", "junta", { metadata: JSON.stringify({ official: { canonicalId: "call" } }), updated_at: "2026-10-14" });
  for (const [id, , , , question] of cases) {
    const rows = await retrieveAIRecords(database, question);
    assert.ok(rows.some((row) => row.id === id), question);
    assert.equal(buildAIContext(question, rows).sources[0]?.id, id, question);
    assert.ok(!rows.some((row) => row.id === "alias"), question);
  }
  assert.deepEqual(aiSearchTerms("¿Qué resoluciones de TITULARIZACIÓN hay?"), ["titularizacion"]);
  sqlite.close();
});

test("agenda propia consulta guardados vinculados sólo al user_id autorizado", async () => {
  const { sqlite, database, add } = fixture();
  add("a", "Reunión A", "junta", { updated_at: "2025-01-01" });
  add("b", "Reunión B", "junta", { updated_at: "2025-01-01" });
  for (let index = 0; index < 81; index++) add(`new:${index}`, `Nuevo ${index}`, "junta", { updated_at: "2026-10-14" });
  sqlite.prepare("INSERT INTO saved_publications VALUES (?,?,1,'2026-10-14')").run("user-a", "a");
  sqlite.prepare("INSERT INTO saved_publications VALUES (?,?,1,'2026-10-14')").run("user-b", "b");
  const userA = await retrieveAIRecords(database, "¿Qué tengo en mi agenda?", { agendaUserId: "user-a" });
  const userB = await retrieveAIRecords(database, "¿Qué tengo en mi agenda?", { agendaUserId: "user-b" });
  assert.ok(userA.some((row) => row.id === "a"));
  assert.ok(!userA.some((row) => row.id === "b"));
  assert.ok(userB.some((row) => row.id === "b"));
  assert.ok(!userB.some((row) => row.id === "a"));
  sqlite.close();
});

test("sin evidencia pública no inventa fuente y evita una consulta para conversación general", async () => {
  const { sqlite, database } = fixture();
  assert.deepEqual(await retrieveAIRecords(database, "Hola"), []);
  const rows = await retrieveAIRecords(database, "¿Qué designaciones de Física hay?");
  assert.deepEqual(rows, []);
  assert.deepEqual(buildAIContext("¿Qué designaciones de Física hay?", rows).sources, []);
  sqlite.close();
});

test("los términos de búsqueda de IA respetan el límite del buscador público", () => {
  const terms = aiSearchTerms(`${"a".repeat(45)} ${"b".repeat(45)} ${"c".repeat(45)}`);
  assert.equal(terms.join(" ").length, 119);
});
