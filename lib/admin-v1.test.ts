import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { activeAdminNotices, listAdminNotices, saveAdminNotice } from "./admin-notices.ts";
import { adminAIStatus, adminDashboard, adminPublications, adminSyncStatus, adminUsers } from "./admin-data.ts";
import { requireCommunityAdmin } from "./community-admin.ts";
import type { CommunityDatabase } from "./community.ts";

const ADMIN = "550e8400-e29b-41d4-a716-446655440000";
const USER = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
const migration = readFileSync(new URL("../migrations/0019_admin_notices.sql", import.meta.url), "utf8");

function fixture() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE "user"(id TEXT PRIMARY KEY, name TEXT, email TEXT, createdAt INTEGER);
    CREATE TABLE "session"(userId TEXT, expiresAt INTEGER, token TEXT);
    CREATE TABLE community_moderators(user_id TEXT PRIMARY KEY, role TEXT);
    CREATE TABLE publications(kind TEXT, source TEXT, category TEXT, metadata TEXT, title TEXT,
      source_published_at TEXT, official_url TEXT, normalized_status TEXT, updated_at TEXT,
      removed_at TEXT, junta TEXT, level TEXT, id TEXT, starts_at TEXT, ends_at TEXT);
    CREATE TABLE sync_state(source TEXT, synced_at TEXT, last_attempt_at TEXT,
      last_successful_sync_at TEXT, sync_status TEXT, item_count INTEGER, error_code TEXT, error_message TEXT);
    CREATE TABLE ai_rate_limits(user_bucket TEXT, request_count INTEGER, expires_at TEXT);
  `);
  raw.exec(migration);
  raw.prepare('INSERT INTO "user" VALUES(?,?,?,?)').run(ADMIN, "Admin", "admin@example.invalid", Date.now());
  raw.prepare('INSERT INTO "user" VALUES(?,?,?,?)').run(USER, "Docente", "docente@example.invalid", Date.now());
  raw.prepare("INSERT INTO community_moderators VALUES(?, 'admin')").run(ADMIN);
  const database = {
    prepare(sql: string) {
      return { bind(...values: unknown[]) {
        const args = values as (null | number | bigint | string | Uint8Array)[];
        const runSync = () => ({ meta: { changes: Number(raw.prepare(sql).run(...args).changes) } });
        return { first: async <T>() => raw.prepare(sql).get(...args) as T | null,
          all: async <T>() => ({ results: raw.prepare(sql).all(...args) as T[] }), run: async () => runSync(), runSync };
      } };
    },
    async batch(statements: unknown[]) {
      raw.exec("BEGIN");
      try { const result = statements.map((statement) => (statement as { runSync(): { meta: { changes: number } } }).runSync()); raw.exec("COMMIT"); return result; }
      catch (error) { raw.exec("ROLLBACK"); throw error; }
    },
  } as CommunityDatabase;
  return { raw, database };
}

const notice = { title: "Aviso de prueba", body: "Texto público sintético.", priority: "importante", active: true,
  startsAt: "2026-10-10T00:00:00.000Z", endsAt: "2026-10-20T00:00:00.000Z", url: "https://example.invalid/info" };

test("dashboard distingue documentos indexados de oportunidades vigentes", async () => {
  const { raw, database } = fixture();
  try {
    raw.exec(`INSERT INTO publications(id,kind,category,metadata) VALUES('drive:old','junta','Llamados abiertos','{}');
      INSERT INTO publications(id,kind,category,metadata,starts_at) VALUES('call:current','junta','Llamados abiertos','{}','2026-10-15T12:00:00Z');`);
    const result = await adminDashboard(database, new Date("2026-10-13T12:00:00Z"));
    assert.deepEqual(result.boardCounts.calls, { indexed: 2, classified: 1, current: 1 });
    assert.equal(result.counts.calls, 1);
    assert.equal(result.counts.acts, 0);
  } finally { raw.close(); }
});

test("admin V1 conserva 401, 403 y acceso exclusivo al rol admin", async () => {
  const { raw, database } = fixture();
  try {
    await assert.rejects(requireCommunityAdmin(database, null), { code: "AUTH_REQUIRED", status: 401 });
    await assert.rejects(requireCommunityAdmin(database, USER), { code: "MODERATOR_REQUIRED", status: 403 });
    assert.equal(await requireCommunityAdmin(database, ADMIN), ADMIN);
  } finally { raw.close(); }
});

test("0019 es aditiva e idempotente sobre usuarios y datos anteriores", () => {
  const { raw } = fixture();
  try {
    raw.exec("CREATE TABLE legacy_agenda(id TEXT PRIMARY KEY); INSERT INTO legacy_agenda VALUES('evento-sintetico');");
    raw.exec(migration);
    assert.equal((raw.prepare("SELECT COUNT(*) AS n FROM legacy_agenda").get() as { n: number }).n, 1);
    assert.equal((raw.prepare('SELECT COUNT(*) AS n FROM "user"').get() as { n: number }).n, 2);
    const schema = raw.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index') AND name LIKE 'admin_notice%' OR name LIKE 'idx_admin_notice%'").all() as { name: string }[];
    assert.ok(schema.some((item) => item.name === "admin_notices"));
    assert.ok(schema.some((item) => item.name === "admin_notice_events"));
    assert.ok(schema.some((item) => item.name === "idx_admin_notices_active_window"));
  } finally { raw.close(); }
});

test("avisos: crear, editar, activar/desactivar y auditoría sin borrado", async () => {
  const { raw, database } = fixture();
  try {
    await assert.rejects(saveAdminNotice(database, USER, notice), { code: "MODERATOR_REQUIRED", status: 403 });
    const created = await saveAdminNotice(database, ADMIN, notice);
    assert.equal((await listAdminNotices(database)).length, 1);
    assert.equal((await activeAdminNotices(database, new Date("2026-10-12"))).length, 1);
    await saveAdminNotice(database, ADMIN, { ...notice, id: created.id, title: "Aviso actualizado", active: false });
    assert.equal((await activeAdminNotices(database, new Date("2026-10-12"))).length, 0);
    assert.equal((await listAdminNotices(database))[0].title, "Aviso actualizado");
    assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM admin_notice_events").get()?.count, 2);
    assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM admin_notices").get()?.count, 1);
  } finally { raw.close(); }
});

test("avisos futuros y vencidos nunca aparecen en Inicio", async () => {
  const { raw, database } = fixture();
  try {
    await saveAdminNotice(database, ADMIN, notice);
    assert.equal((await activeAdminNotices(database, new Date("2026-10-09"))).length, 0);
    assert.equal((await activeAdminNotices(database, new Date("2026-10-20"))).length, 0);
    assert.equal((await activeAdminNotices(database, new Date("2026-10-15"))).length, 1);
    await assert.rejects(saveAdminNotice(database, ADMIN, { ...notice, endsAt: "2026-10-01T00:00:00Z" }), { code: "INVALID_NOTICE" });
    await assert.rejects(saveAdminNotice(database, ADMIN, { ...notice, url: "javascript:alert(1)" }), { code: "INVALID_NOTICE" });
  } finally { raw.close(); }
});

test("dashboard, usuarios, sync e IA solo exponen campos mínimos", async () => {
  const { raw, database } = fixture();
  try {
    raw.prepare("INSERT INTO sync_state VALUES(?,?,?,?,?,?,?,?)").run("SIME", "2026-10-12", "2026-10-12", null, "NETWORK_ERROR", 42, "NETWORK_ERROR", "PRIVATE_HEADER=value");
    raw.prepare("INSERT INTO publications VALUES(?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL)").run("capacitacion", "Capacitación Docente", "Curso", "{}", "Curso sintético", "2026-10-12", "https://example.invalid", "ACTIVE", "2026-10-12", null, "", "");
    const users = await adminUsers(database);
    assert.equal(users.length, 2);
    assert.equal(users[0].lastAccess, null);
    assert.equal((await adminDashboard(database)).counts.fdci, 1);
    const sync = await adminSyncStatus(database);
    assert.equal(sync.find((item) => item.source === "SIME")?.errorCode, "NETWORK_ERROR");
    const ai = await adminAIStatus(database, { AI_PROVIDER: "gemini", AI_MODEL: "test-model", AI_API_KEY: "DO_NOT_EXPOSE" });
    const serialized = JSON.stringify({ users, sync, ai, dashboard: await adminDashboard(database) });
    assert.equal(serialized.includes("DO_NOT_EXPOSE"), false);
    assert.equal(serialized.includes("PRIVATE_HEADER"), false);
    assert.equal(serialized.includes("token"), false);
    assert.equal(ai.available, true);
  } finally { raw.close(); }
});

test("publicaciones administrativas son de solo lectura y filtrables", async () => {
  const { raw, database } = fixture();
  try {
    raw.prepare("INSERT INTO publications VALUES(?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL)").run("capacitacion", "INFoD / AulaS-TIC", "Curso", "{}", "Curso sintético", "2026-10-12", "https://example.invalid", "ACTIVE", "2026-10-12", null, "", "");
    assert.equal((await adminPublications(database, new URLSearchParams("source=INFoD+%2F+AulaS-TIC"))).length, 1);
    assert.equal((await adminPublications(database, new URLSearchParams("source=SIME"))).length, 0);
  } finally { raw.close(); }
});

test("mutaciones admin leen un cuerpo acotado antes de devolver 401/403", () => {
  const route = readFileSync(new URL("../app/api/admin/notices/route.ts", import.meta.url), "utf8").split("export async function POST")[1];
  assert.ok(route);
  assert.ok(route.indexOf("await jsonObject(request)") < route.indexOf("await authorizedAdmin(request)"));
});
