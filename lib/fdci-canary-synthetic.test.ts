import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { D1Database } from "@cloudflare/workers-types";
import { APP_PUBLICATIONS_QUERY } from "./app-publications-query.ts";
import { FDCI_CANARY_SYNTHETIC_IDS, isKnownFdciSynthetic } from "./fdci-canary-synthetic.ts";
import { PUBLICATION_BY_ID_SQL, publicationSearchQuery, searchCursor } from "./publication-search.ts";
import { PERSONAL_CATALOG_SQL } from "./personalized-catalog.ts";
import { PERSONAL_PUBLICATIONS_QUERY } from "./personal-publications.ts";
import { combineAppData } from "./app-data.ts";
import { agendaEntries } from "./agenda-view.ts";
import { retrieveAIRecords } from "./ai-retrieval.ts";
import { buildFdciCatalog } from "./fdci-static-catalog.ts";
import { integrateFdciCatalog } from "./fdci-catalog-integration.ts";
import type { AppData, Publication, Saved } from "./types.ts";

const officialIds = ["fdci:commission:6432", "fdci:commission:6434"];
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE publications(id TEXT PRIMARY KEY,source TEXT,external_id TEXT,kind TEXT,title TEXT,metadata TEXT,
    first_seen_at TEXT,updated_at TEXT,ends_at TEXT,starts_at TEXT,summary TEXT DEFAULT '',category TEXT DEFAULT 'Capacitaciones',
    level TEXT DEFAULT '',area TEXT DEFAULT '',junta TEXT DEFAULT '',location TEXT DEFAULT '',character TEXT DEFAULT '',
    source_circuit_raw TEXT DEFAULT '',shift TEXT DEFAULT '',normalized_status TEXT DEFAULT 'CLOSED',
    source_published_at TEXT,last_changed_at TEXT,official_url TEXT DEFAULT '',status TEXT DEFAULT 'cerrada');
    CREATE TABLE saved_publications(user_id TEXT,publication_id TEXT,in_agenda INTEGER,saved_at TEXT);
    CREATE TABLE training_reminders(user_id TEXT,publication_id TEXT,notified INTEGER);
    CREATE TABLE designation_tracking(user_id TEXT,publication_id TEXT);
    CREATE TABLE notifications(user_id TEXT,publication_id TEXT);`);
  const add = (id: string, metadata: string | null = "{}", title = "Capacitación legítima") => {
    db.prepare("INSERT INTO publications(id,source,external_id,kind,title,metadata,first_seen_at,updated_at) VALUES(?, 'Capacitación Docente',?,'capacitacion',?,?,'2026-11-01 07:33:49','2026-11-01 07:33:49')")
      .run(id, id.split(":").at(-1)!, title, metadata);
  };
  for (const id of FDCI_CANARY_SYNTHETIC_IDS) add(id, JSON.stringify({ entity: "commission", trainingId: "89001", commissionId: id.split(":").at(-1), content: "Ensayo de cursor" }), "PRUEBA SINTÉTICA FDCI CURSOR B");
  for (const id of officialIds) add(id, JSON.stringify({ entity: "commission", trainingId: id.endsWith("6432") ? "3111" : "3113", commissionId: id.split(":").at(-1) }));
  const visible = () => db.prepare(APP_PUBLICATIONS_QUERY).all() as unknown as Publication[];
  return { db, add, visible };
}

test("el ensayo antiguo excluye exactamente cinco IDs y conserva las dos capacitaciones oficiales", () => {
  const { db, visible } = fixture();
  try {
    assert.equal((db.prepare("SELECT count(*) n FROM publications").get() as { n: number }).n, 7);
    assert.deepEqual(visible().map(r => r.id).sort(), officialIds);
    assert.equal(visible().filter(r => isKnownFdciSynthetic(r.id)).length, 0);
    assert.equal(new Set(visible().map(r => r.id)).size, 2);
  } finally { db.close(); }
});
test("metadata NULL, vacío, inválido y sin marcas permanece visible; títulos o IDs vecinos no se bloquean", () => {
  const { db, add, visible } = fixture();
  try {
    const cases = [null, "", "broken{", "{}", "null", "[]", '{"preview":false}', '{"catalogOnly":0}'];
    cases.forEach((m, n) => add(`legit:${n}`, m, "PRUEBA SINTÉTICA FDCI CURSOR B"));
    add("fdci:commission:980000006"); add("fdci:commission:980000000");
    add("preview", '{"preview":true}'); add("external", '{"catalogOnly":true}');
    const rows = visible();
    assert.equal(rows.length, 12); assert(rows.every(r => !isKnownFdciSynthetic(r.id)));
    assert(!rows.some(r => ["preview", "external"].includes(r.id)));
    for (let i = 0; i < cases.length; i++) assert(rows.some(r => r.id === `legit:${i}`));
  } finally { db.close(); }
});
test("búsqueda paginada y acceso público por ID no recuperan fixtures; se conservan los parámetros", () => {
  const { db, add } = fixture();
  try {
    const ids: string[] = []; let cursor: string | undefined;
    do {
      const q = publicationSearchQuery("", cursor, 1, "capacitacion");
      const rows = db.prepare(q.sql).all(...q.params) as { id: string; updated_at: string }[];
      ids.push(...rows.slice(0, 1).map(r => r.id)); cursor = rows.length > 1 ? searchCursor(rows[0]) : undefined;
    } while (cursor);
    assert.deepEqual(ids.sort(), officialIds); assert.equal(new Set(ids).size, ids.length);
    for (const id of FDCI_CANARY_SYNTHETIC_IDS) assert.equal(db.prepare(PUBLICATION_BY_ID_SQL).get(id), undefined);
    for (const id of officialIds) assert(db.prepare(PUBLICATION_BY_ID_SQL).get(id));
    add("legit:same-title", null, "PRUEBA SINTÉTICA FDCI CURSOR B");
    const q = publicationSearchQuery("sintética");
    assert.deepEqual(db.prepare(q.sql).all(...q.params).map(r => r.id), ["legit:same-title"]);
  } finally { db.close(); }
});
test("el catálogo de coincidencias filtra antes de paginar, sin depender de fechas ni metadata", () => {
  const { db } = fixture();
  try { assert.deepEqual(db.prepare(PERSONAL_CATALOG_SQL).all("capacitacion", "").map(r => r.id), officialIds); }
  finally { db.close(); }
});
test("Guardados, Agenda y flags de recordatorios existentes se conservan, con aislamiento por usuario", () => {
  const { db, visible } = fixture();
  try {
    const synthetic = FDCI_CANARY_SYNTHETIC_IDS[0];
    db.prepare("INSERT INTO saved_publications VALUES('owner',?,1,'2026-11-01')").run(synthetic);
    db.prepare("INSERT INTO training_reminders VALUES('owner',?,0)").run(officialIds[0]);
    db.prepare("INSERT INTO notifications VALUES('other',?)").run(officialIds[1]);
    const before = db.prepare("SELECT * FROM training_reminders").all();
    const personal = db.prepare(PERSONAL_PUBLICATIONS_QUERY).all("owner", "owner", "owner", "owner") as unknown as Publication[];
    assert(personal.some(r => r.id === synthetic)); assert(!personal.some(r => r.id === officialIds[1]));
    const combined = combineAppData({ publications: visible(), sync: [] } as unknown as AppData, { personalPublications: personal, saved: [] } as never)!;
    assert.equal(new Set(combined.publications.map(r => r.id)).size, 3);
    const saved = { publication_id: synthetic, in_agenda: 1, agenda_at: "2026-11-08T12:00:00Z", agenda_reminder_notified: 0 } as Saved;
    assert.equal(agendaEntries(combined.publications, new Map([[synthetic, saved]]), []).length, 1);
    assert.equal(combined.publications.filter(r => !isKnownFdciSynthetic(r.id)).length, 2);
    assert.deepEqual(db.prepare("SELECT * FROM training_reminders").all(), before);
    assert.equal((db.prepare("SELECT count(*) n FROM publications").get() as { n: number }).n, 7);
  } finally { db.close(); }
});
test("el catálogo oficial vacío sigue siendo válido y no borra los cursos oficiales D1", async () => {
  const { db, visible } = fixture();
  try {
    const at = "2026-11-07T10:00:00.000Z";
    const merged = await integrateFdciCatalog(visible(), await buildFdciCatalog([], at), "ready", Date.parse(at), 3);
    assert.deepEqual(merged.publications.map(r => r.id).sort(), officialIds);
  } finally { db.close(); }
});
test("la recuperación pública IA no reintroduce los cinco registros por foco o selección reciente", async () => {
  const { db } = fixture();
  const database = { prepare(sql: string) { return { bind(...params: (string | number)[]) { return {
    all: async () => ({ results: db.prepare(sql).all(...params) }), first: async () => db.prepare(sql).get(...params) ?? null,
  }; }, all: async () => ({ results: db.prepare(sql).all() }) }; } } as unknown as D1Database;
  try {
    const rows = await retrieveAIRecords(database, "capacitaciones", { focusedId: FDCI_CANARY_SYNTHETIC_IDS[0] });
    assert.equal(rows.length, 2); assert(rows.every(r => !isKnownFdciSynthetic(r.id)));
  } finally { db.close(); }
});
