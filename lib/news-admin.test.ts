import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { listNewsAdmin, mutateNewsAdmin, newsAdminDetail, searchNewsOrigins } from "./news-admin.ts";
import type { CommunityDatabase } from "./community.ts";

const ADMIN = "550e8400-e29b-41d4-a716-446655440000";
const USER = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
const ADMIN_B = "77c39c3b-a822-4b0f-b196-9f05209c4079";
const migration = readFileSync(new URL("../migrations/0021_news_editorial.sql", import.meta.url), "utf8");
type SqlValue = null | number | bigint | string | Uint8Array;

function fixture() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE "user"(id TEXT PRIMARY KEY,name TEXT);
    CREATE TABLE community_moderators(user_id TEXT PRIMARY KEY,role TEXT NOT NULL);
    CREATE TABLE publications(id TEXT PRIMARY KEY,title TEXT NOT NULL,summary TEXT NOT NULL,source TEXT NOT NULL,
      official_url TEXT NOT NULL,source_published_at TEXT,removed_at TEXT,updated_at TEXT NOT NULL);
    INSERT INTO "user" VALUES('${ADMIN}','Admin A'),('${USER}','Usuario normal');
    INSERT INTO community_moderators VALUES('${ADMIN}','admin'),('${USER}','moderator');
    INSERT INTO publications VALUES('SIME:vac-1','Convocatoria docente','Resumen oficial','SIME',
      'https://sime.educaciontuc.gov.ar/aviso/1','2026-10-10',NULL,'2026-10-14');
    INSERT INTO publications VALUES('JUNTA:2','Otra convocatoria','Otro resumen','Padrones y Comunicados',
      'https://educaciontuc.gov.ar/aviso/2','2026-10-11',NULL,'2026-10-14');`);
  raw.exec(migration);
  const database = {
    prepare(sql: string) { return { bind(...values: unknown[]) {
      const args = values as SqlValue[];
      return { first: async <T>() => raw.prepare(sql).get(...args) as T | null,
        all: async <T>() => ({ results: raw.prepare(sql).all(...args) as T[] }),
        run: async () => ({ meta: { changes: Number(raw.prepare(sql).run(...args).changes) } }),
        runSync: () => ({ meta: { changes: Number(raw.prepare(sql).run(...args).changes) } }) };
    } }; },
    async batch(statements: unknown[]) {
      raw.exec("BEGIN");
      try {
        const result = statements.map((statement) => (statement as { runSync(): { meta: { changes: number } } }).runSync());
        raw.exec("COMMIT"); return result;
      } catch (error) { raw.exec("ROLLBACK"); throw error; }
    },
  } as CommunityDatabase;
  return { raw, database };
}

const create = (db: CommunityDatabase, publicationId = "SIME:vac-1", actor = ADMIN) =>
  mutateNewsAdmin(db, actor, { action: "create_candidate", publicationId });
const change = (db: CommunityDatabase, id: string, updatedAt: string, action: string, extra: Record<string, unknown> = {}, actor = ADMIN) =>
  mutateNewsAdmin(db, actor, { id, updatedAt, action, ...extra });
const details = (db: CommunityDatabase, id: string) => newsAdminDetail(db, id);
const count = (raw: DatabaseSync, table: string) => (raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

test("solo admin crea candidata manual, sin duplicar publicación ni modificarla", async () => {
  const { raw, database } = fixture();
  try {
    await assert.rejects(create(database, "SIME:vac-1", USER), { status: 403 });
    const original = raw.prepare("SELECT * FROM publications WHERE id='SIME:vac-1'").get();
    const result = await create(database);
    assert.equal((await details(database, result.id)).item.status, "candidate");
    assert.equal((await details(database, result.id)).sources[0].is_primary, 1);
    assert.equal((await details(database, result.id)).events[0].action, "create_candidate");
    assert.deepEqual(raw.prepare("SELECT * FROM publications WHERE id='SIME:vac-1'").get(), original);
    await assert.rejects(create(database), { status: 409 });
    assert.equal(count(raw, "news_items"), 1);
    assert.equal(count(raw, "news_events"), 1);
    assert.equal((await searchNewsOrigins(database, "Convocatoria"))[0].existing_news_id, result.id);
  } finally { raw.close(); }
});

test("edición usa updated_at y rechaza versiones viejas sin evento adicional", async () => {
  const { raw, database } = fixture();
  try {
    const { id } = await create(database), old = (await details(database, id)).item.updated_at;
    const input = { title: "Título revisado", summary: "Resumen contrastado", topic: "Juntas", relevance: "importante",
      validFrom: "2026-10-14T00:00:00.000Z", validUntil: "2026-10-16T00:00:00.000Z" };
    const edited = await change(database, id, old, "edit", input);
    assert.equal((await details(database, id)).item.editorial_title, input.title);
    assert.notEqual(edited.updatedAt, old);
    assert.ok(edited.updatedAt);
    await assert.rejects(change(database, id, old, "approve"), { status: 409 });
    assert.equal(count(raw, "news_events"), 2);
    await assert.rejects(change(database, id, edited.updatedAt, "edit", { ...input, validUntil: "2026-10-13T00:00:00.000Z" }), { status: 400 });
  } finally { raw.close(); }
});

test("dos admins no pisan ediciones concurrentes ni atribuyen eventos al actor equivocado", async () => {
  const { raw, database } = fixture();
  try {
    raw.prepare('INSERT INTO "user" VALUES(?,?)').run(ADMIN_B, "Admin B");
    raw.prepare("INSERT INTO community_moderators VALUES(?,'admin')").run(ADMIN_B);
    const { id } = await create(database), version = (await details(database, id)).item.updated_at;
    const edit = { title: "Revisada por A", summary: "Resumen", topic: "", relevance: "informativa", validFrom: null, validUntil: null };
    await change(database, id, version, "edit", edit, ADMIN);
    await assert.rejects(change(database, id, version, "edit", { ...edit, title: "Revisada por B" }, ADMIN_B), { status: 409 });
    assert.equal((await details(database, id)).item.editorial_title, "Revisada por A");
    assert.equal(count(raw, "news_events"), 2);
    assert.equal((raw.prepare("SELECT actor_user_id AS actor FROM news_events WHERE action='edit'").get() as { actor: string }).actor, ADMIN);
  } finally { raw.close(); }
});

test("fuentes HTTPS se normalizan, máximo una principal y duplicado revierte evento", async () => {
  const { raw, database } = fixture();
  try {
    const { id } = await create(database);
    let item = (await details(database, id)).item;
    await assert.rejects(change(database, id, item.updated_at, "source_add", { sourceName: "Prueba", sourceTitle: "Insegura",
      url: "https://usuario:clave@example.com", sourceType: "official", isPrimary: false }), { status: 400 });
    assert.equal(count(raw, "news_events"), 1);
    await assert.rejects(change(database, id, item.updated_at, "source_add", { sourceName: "SIME", sourceTitle: "Duplicada",
      url: "https://sime.educaciontuc.gov.ar/aviso/1#detalle", sourceType: "official", isPrimary: false }), { status: 409 });
    assert.equal(count(raw, "news_events"), 1);
    const added = await change(database, id, item.updated_at, "source_add", { sourceName: "Ministerio", sourceTitle: "Nota",
      url: "HTTPS://educaciontuc.gov.ar:443/nota#fragmento", sourceType: "official", isPrimary: true });
    item = (await details(database, id)).item;
    assert.equal(added.updatedAt, item.updated_at);
    const sources = (await details(database, id)).sources;
    assert.equal(sources.filter((source) => source.is_primary).length, 1);
    assert.ok(sources.some((source) => source.url === "https://educaciontuc.gov.ar/nota"));
    await change(database, id, item.updated_at, "source_remove", { sourceId: sources[0].id });
    assert.equal((await details(database, id)).sources.length, 1);
  } finally { raw.close(); }
});

test("publicación exige aprobación, contenido, fuente principal y caducidad urgente", async () => {
  const { raw, database } = fixture();
  try {
    const { id } = await create(database);
    let item = (await details(database, id)).item;
    await assert.rejects(change(database, id, item.updated_at, "publish"), { status: 409 });
    await change(database, id, item.updated_at, "approve");
    item = (await details(database, id)).item;
    await change(database, id, item.updated_at, "source_remove", { sourceId: (await details(database, id)).sources[0].id });
    item = (await details(database, id)).item;
    await assert.rejects(change(database, id, item.updated_at, "publish"), { status: 409 });
    const added = await change(database, id, item.updated_at, "source_add", { sourceName: "Ministerio", sourceTitle: "Comunicado",
      url: "https://educaciontuc.gov.ar/comunicado", sourceType: "official", isPrimary: true });
    assert.ok(added.updatedAt);
    await change(database, id, added.updatedAt, "edit", { title: "Urgente", summary: "Resumen", topic: "Juntas", relevance: "urgente", validFrom: null, validUntil: null });
    item = (await details(database, id)).item;
    await assert.rejects(change(database, id, item.updated_at, "publish"), { status: 409 });
    const expiry = new Date(Date.now() + 86_400_000).toISOString();
    const edited = await change(database, id, item.updated_at, "edit", { title: "Urgente", summary: "Resumen", topic: "Juntas", relevance: "urgente", validFrom: null, validUntil: expiry });
    assert.ok(edited.updatedAt);
    await change(database, id, edited.updatedAt, "publish");
    assert.equal((await details(database, id)).item.status, "published");
    assert.ok((await details(database, id)).item.published_at);
    assert.equal(count(raw, "news_events"), 7);
  } finally { raw.close(); }
});

test("rechazar, reabrir, archivar y destacar dejan eventos y transiciones válidas", async () => {
  const { raw, database } = fixture();
  try {
    const { id } = await create(database);
    let item = (await details(database, id)).item;
    await change(database, id, item.updated_at, "reject", { reason: "Evidencia insuficiente" });
    item = (await details(database, id)).item;
    assert.equal(item.status, "rejected");
    await assert.rejects(change(database, id, item.updated_at, "publish"), { status: 409 });
    await change(database, id, item.updated_at, "reopen");
    item = (await details(database, id)).item;
    await change(database, id, item.updated_at, "approve");
    item = (await details(database, id)).item;
    await change(database, id, item.updated_at, "publish");
    item = (await details(database, id)).item;
    await change(database, id, item.updated_at, "feature");
    item = (await details(database, id)).item;
    await change(database, id, item.updated_at, "unfeature");
    item = (await details(database, id)).item;
    await change(database, id, item.updated_at, "archive");
    item = (await details(database, id)).item;
    await change(database, id, item.updated_at, "reopen");
    assert.equal((await details(database, id)).item.status, "candidate");
    assert.equal(count(raw, "news_events"), 9);
    const list = await listNewsAdmin(database, new URLSearchParams({ status: "candidate" }));
    assert.equal(list.counts.candidate, 1);
    assert.equal(list.items.length, 1);
  } finally { raw.close(); }
});

test("origen retirado obliga confirmación humana y no altera publicaciones", async () => {
  const { raw, database } = fixture();
  try {
    const { id } = await create(database);
    let item = (await details(database, id)).item;
    await change(database, id, item.updated_at, "approve");
    raw.prepare("UPDATE publications SET removed_at='2026-10-14' WHERE id='SIME:vac-1'").run();
    item = (await details(database, id)).item;
    await assert.rejects(change(database, id, item.updated_at, "publish"), { status: 409 });
    await change(database, id, item.updated_at, "publish", { confirmWithdrawnOrigin: true });
    assert.equal((await details(database, id)).item.status, "published");
    assert.equal((raw.prepare("SELECT removed_at FROM publications WHERE id='SIME:vac-1'").get() as { removed_at: string }).removed_at, "2026-10-14");
  } finally { raw.close(); }
});

test("advierte fuente compartida, conserva aislamiento editorial y protege principal publicada", async () => {
  const { raw, database } = fixture();
  try {
    const first = await create(database), second = await create(database, "JUNTA:2");
    let item = (await details(database, second.id)).item;
    const shared = await change(database, second.id, item.updated_at, "source_add", { sourceName: "SIME", sourceTitle: "Referencia compartida",
      url: "https://sime.educaciontuc.gov.ar/aviso/1", sourceType: "official", isPrimary: false });
    assert.match(shared.warning || "", /otra noticia/i);
    assert.equal((await details(database, second.id)).sharedSourceIds.length, 1);
    assert.equal((await details(database, first.id)).sources.length, 1);
    item = (await details(database, first.id)).item;
    await change(database, first.id, item.updated_at, "approve");
    item = (await details(database, first.id)).item;
    await change(database, first.id, item.updated_at, "publish");
    item = (await details(database, first.id)).item;
    await assert.rejects(change(database, first.id, item.updated_at, "source_remove", { sourceId: (await details(database, first.id)).sources[0].id }), { status: 409 });
    assert.equal(count(raw, "news_sources"), 3);
    assert.equal((await details(database, second.id)).item.status, "candidate");
  } finally { raw.close(); }
});

test("ruta Admin comprueba autorización, mismo origen y actor de sesión", () => {
  const route = readFileSync(new URL("../app/api/admin/news/route.ts", import.meta.url), "utf8");
  assert.match(route, /authorizedAdmin\(request\)/);
  assert.match(route, /isSameOriginMutation\(request\)/);
  assert.match(route, /account\.accountId/);
  assert.doesNotMatch(route, /body\.(?:actor|role|userId)/);
});

test("panel editorial mantiene cola, evidencia, auditoría y confirmaciones dentro de Admin", () => {
  const panel = readFileSync(new URL("../components/news-admin-panel.tsx", import.meta.url), "utf8");
  const admin = readFileSync(new URL("../components/admin-panel.tsx", import.meta.url), "utf8");
  assert.match(admin, /section === "news" && <NewsAdminPanel \/>/);
  for (const marker of ["list.counts[value]", "Crear candidata desde publicación", "Ficha editorial", "Evidencia y fuentes",
    "Historial editorial", "window.confirm", "Recargar noticia"]) assert.ok(panel.includes(marker), marker);
  assert.match(panel, /disabled=\{busy \|\| !\["candidate", "approved", "published"\]\.includes\(detail\.item\.status\) \|\| Boolean\(detail\.item\.status === "published" && entry\.is_primary\)\}/);
});
