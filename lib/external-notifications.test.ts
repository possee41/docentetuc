import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { materializeExternalNoticePage } from "../scripts/external-notifications.mjs";

const HASH = "a".repeat(64);
function isolated(count: number) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE publications (id TEXT PRIMARY KEY, content_hash TEXT, normalized_status TEXT,
    removed_at TEXT, kind TEXT, title TEXT, summary TEXT, level TEXT, area TEXT, junta TEXT,
    location TEXT, shift TEXT, character TEXT, circuit TEXT, source_circuit_raw TEXT,
    category TEXT, metadata TEXT, ends_at TEXT, starts_at TEXT, source_updated_at TEXT);
    CREATE TABLE profiles (user_id TEXT PRIMARY KEY, notify_new_trainings INTEGER,
      training_notify_scope TEXT, level TEXT, area TEXT, subjects TEXT, junta TEXT, roles TEXT,
      department TEXT, locality TEXT, shifts TEXT, characters TEXT, circuits TEXT,
      personal_match_threshold INTEGER, wants_interim INTEGER, wants_substitute INTEGER, training_interests TEXT);
    CREATE TABLE notifications (id INTEGER PRIMARY KEY, user_id TEXT, publication_id TEXT,
      type TEXT, dedupe_key TEXT, scheduled_at TEXT);
    CREATE UNIQUE INDEX idx_notifications_dedupe ON notifications(user_id,dedupe_key) WHERE dedupe_key<>'';`);
  const add = sqlite.prepare("INSERT INTO profiles(user_id,notify_new_trainings,training_notify_scope,level) VALUES(?,?,?,?)");
  for (let i = 0; i < count; i++) add.run(`user-${String(i).padStart(3, "0")}`, i % 2 === 0 ? 1 : 0, "all", "Primaria");
  const put = (id: string, metadata: object, normalized = "ACTIVE") => sqlite.prepare(`INSERT INTO publications
    (id,content_hash,normalized_status,kind,title,summary,level,area,category,metadata,circuit)
    VALUES(?, ?, ?, 'capacitacion', 'Capacitación sintética', '', 'Primaria', '', 'Capacitación', ?, 'UNKNOWN')`)
    .run(id, HASH, normalized, JSON.stringify(metadata));
  const metrics = { queries: 0, rowsRead: 0, rowsWritten: 0 };
  const db = { prepare: (sql: string) => ({ bind: (...params: unknown[]) => ({
    first: async () => { metrics.queries++; metrics.rowsRead++; return sqlite.prepare(sql).get(...params as []) || null; },
    all: async () => { metrics.queries++; const results = sqlite.prepare(sql).all(...params as []); metrics.rowsRead += results.length; return { results }; },
    run: async () => { metrics.queries++; const result = sqlite.prepare(sql).run(...params as []); metrics.rowsWritten += Number(result.changes); return { meta: { rows_written: Number(result.changes), changes: Number(result.changes) } }; },
  }) }) };
  return { sqlite, put, db, metrics };
}

test("avisos externos: 25/100/500 perfiles en páginas, preferencias e idempotencia", async () => {
  for (const count of [25, 100, 500]) {
    const fixture = isolated(count);
    fixture.put("fdci:commission:1", { entity: "commission", availablePreCapacity: 5, registrationOpensAt: "2026-10-22T12:00:00Z" });
    const input = { events: [{ id: "fdci:commission:1", contentHash: HASH, change: "created" }],
      now: new Date("2026-10-22T11:00:00Z") };
    let cursor = "", pages = 0;
    do {
      const result = await materializeExternalNoticePage(fixture.db, { ...input, cursor });
      pages++;
      cursor = result.nextCursor || "";
      if (!result.nextCursor) break;
    } while (pages < 25);
    const expected = Math.ceil(count / 2);
    assert.equal((fixture.sqlite.prepare("SELECT COUNT(*) AS n FROM notifications").get() as { n: number }).n, expected);
    assert.ok(pages <= Math.ceil(count / 25) + 1);
    const rerun = await materializeExternalNoticePage(fixture.db, input);
    assert.equal(rerun.inserted, 0);
    assert.equal((fixture.sqlite.prepare("SELECT COUNT(*) AS n FROM notifications").get() as { n: number }).n, expected);
    fixture.sqlite.close();
  }
});

test("cupo cero, retirada y registro cambiado no producen avisos engañosos", async () => {
  const fixture = isolated(2);
  fixture.put("fdci:commission:6397", { entity: "commission", availablePreCapacity: 0 });
  const input = { events: [{ id: "fdci:commission:6397", contentHash: HASH, change: "created" }], now: new Date("2026-10-22T11:00:00Z") };
  assert.equal((await materializeExternalNoticePage(fixture.db, input)).inserted, 0);
  fixture.sqlite.prepare("UPDATE publications SET normalized_status='REMOVED_FROM_SOURCE' WHERE id=?").run(input.events[0].id);
  assert.equal((await materializeExternalNoticePage(fixture.db, input)).inserted, 0);
  fixture.sqlite.prepare("UPDATE publications SET content_hash=? WHERE id=?").run("b".repeat(64), input.events[0].id);
  await assert.rejects(materializeExternalNoticePage(fixture.db, input), /EXTERNAL_NOTICE_PUBLICATION_CHANGED/);
  fixture.sqlite.close();
});

test("fallo a mitad de página se recupera sin duplicar avisos", async () => {
  const fixture = isolated(25);
  fixture.sqlite.prepare("UPDATE profiles SET notify_new_trainings=1").run();
  fixture.put("fdci:commission:2", { entity: "commission", availablePreCapacity: 3 });
  const input = { events: [{ id: "fdci:commission:2", contentHash: HASH, change: "created" }], now: new Date("2026-10-22T11:00:00Z") };
  let writes = 0;
  const db = { prepare: (sql: string) => ({ bind: (...params: unknown[]) => {
    const statement = fixture.db.prepare(sql).bind(...params);
    return { ...statement, run: async () => { if (++writes === 2) throw new Error("D1_INTERRUPTED"); return statement.run(); } };
  } }) };
  await assert.rejects(materializeExternalNoticePage(db, input), /D1_INTERRUPTED/);
  const retried = await materializeExternalNoticePage(fixture.db, input);
  assert.equal(retried.inserted, 5);
  assert.equal((fixture.sqlite.prepare("SELECT COUNT(*) AS n FROM notifications").get() as { n: number }).n, 25);
  fixture.sqlite.close();
});
