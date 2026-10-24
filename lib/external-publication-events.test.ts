import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { materializeNextPersistedNoticePage } from "../scripts/external-notifications.mjs";

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE publications (id TEXT PRIMARY KEY,source TEXT NOT NULL,kind TEXT,category TEXT,title TEXT,
      summary TEXT,level TEXT,area TEXT,junta TEXT,location TEXT,shift TEXT,character TEXT,circuit TEXT,
      source_circuit_raw TEXT,metadata TEXT,content_hash TEXT,normalized_status TEXT,removed_at TEXT,
      ends_at TEXT,starts_at TEXT,source_updated_at TEXT);
    CREATE TABLE profiles (user_id TEXT PRIMARY KEY,notify_new_trainings INTEGER,training_notify_scope TEXT,
      level TEXT,area TEXT,subjects TEXT,junta TEXT,roles TEXT,department TEXT,locality TEXT,shifts TEXT,
      characters TEXT,circuits TEXT,personal_match_threshold INTEGER,wants_interim INTEGER,wants_substitute INTEGER,
      training_interests TEXT);
    CREATE TABLE notifications (id INTEGER PRIMARY KEY,user_id TEXT,publication_id TEXT,type TEXT,
      dedupe_key TEXT,scheduled_at TEXT,UNIQUE(user_id,dedupe_key));`);
  sqlite.exec(readFileSync(new URL("../migrations/0025_external_publication_events.sql", import.meta.url), "utf8"));
  sqlite.prepare("INSERT INTO external_event_sources(source) VALUES('Capacitación Docente')").run();
  const db = { prepare: (sql: string) => ({ bind: (...params: unknown[]) => ({
    first: async () => sqlite.prepare(sql).get(...params as []) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...params as []) }),
    run: async () => ({ meta: { rows_written: Number(sqlite.prepare(sql).run(...params as []).changes) } }),
  }) }) } as unknown as D1Database;
  return { sqlite, db };
}

const id = "fdci:commission:synthetic", hash = "a".repeat(64);
const now = new Date("2026-10-22T12:00:00Z");
const insert = `INSERT INTO publications(id,source,kind,category,title,metadata,content_hash,normalized_status,circuit)
  VALUES (?,'Capacitación Docente','capacitacion','Capacitación','Curso sintético',?,?,'ACTIVE','UNKNOWN')`;
const metadata = JSON.stringify({ entity: "commission", availablePreCapacity: 5,
  registrationOpensAt: "2026-10-23T12:00:00Z" });

test("el evento se guarda con la publicación, sin duplicar al repetir y sin tocar históricos", () => {
  const { sqlite } = fixture();
  sqlite.prepare("INSERT INTO publications(id,source,title,content_hash) VALUES('historic:1','Otra','Histórica','old')").run();
  sqlite.exec("BEGIN");
  sqlite.prepare(insert).run(id, metadata, hash);
  sqlite.exec("ROLLBACK");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM external_publication_events").get()?.n, 0);
  sqlite.prepare(insert).run(id, metadata, hash);
  sqlite.prepare(`INSERT INTO publications(id,source,kind,category,title,metadata,content_hash,normalized_status,circuit)
    VALUES (?,'Capacitación Docente','capacitacion','Capacitación','Curso sintético',?,?,'ACTIVE','UNKNOWN')
    ON CONFLICT(id) DO UPDATE SET content_hash=excluded.content_hash WHERE publications.content_hash<>excluded.content_hash`)
    .run(id, metadata, hash);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM external_publication_events").get()?.n, 1);
  assert.equal(sqlite.prepare("SELECT title FROM publications WHERE id='historic:1'").get()?.title, "Histórica");
  sqlite.close();
});

test("una fuente legacy no encola eventos hasta completar su corte", () => {
  const { sqlite } = fixture();
  sqlite.prepare("INSERT INTO publications(id,source,title,content_hash) VALUES('sime:1','SIME','Legacy','a')").run();
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM external_publication_events").get()?.n, 0);
  sqlite.prepare("INSERT INTO external_event_sources(source) VALUES('SIME')").run();
  sqlite.prepare("UPDATE publications SET content_hash='b' WHERE id='sime:1'").run();
  assert.equal(sqlite.prepare("SELECT change FROM external_publication_events").get()?.change, "updated");
  sqlite.close();
});

test("reanudación, concurrencia, cambio posterior y deduplicación por perfil", async () => {
  const { sqlite, db } = fixture();
  sqlite.prepare(insert).run(id, metadata, hash);
  const profile = sqlite.prepare("INSERT INTO profiles(user_id,notify_new_trainings,training_notify_scope) VALUES(?,1,'all')");
  for (let index = 0; index < 30; index++) profile.run(`user-${String(index).padStart(2, "0")}`);
  const first = await Promise.all([
    materializeNextPersistedNoticePage(db, { now }), materializeNextPersistedNoticePage(db, { now }),
  ]);
  assert.equal(first.filter((result) => result.eventId !== null).length, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notifications").get()?.n, 25);
  const next = await materializeNextPersistedNoticePage(db, { now });
  assert.equal(next.profiles, 5);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notifications").get()?.n, 30);
  assert.equal(sqlite.prepare("SELECT status FROM external_publication_events WHERE id=1").get()?.status, "done");

  // A failed cursor write leaves inserted notices intact; the expired lease
  // replays the same page and the unique dedupe key prevents a second notice.
  const updatedHash = "b".repeat(64);
  sqlite.prepare("UPDATE publications SET content_hash=? WHERE id=?").run(updatedHash, id);
  const failingDb = { prepare: (sql: string) => sql.includes("SET profile_cursor=?") ? { bind: () => ({
    run: async () => { throw new Error("D1_FAILURE"); },
  }) } : db.prepare(sql) } as D1Database;
  await assert.rejects(materializeNextPersistedNoticePage(failingDb, { now }), /D1_FAILURE/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notifications").get()?.n, 55);
  const resumed = await materializeNextPersistedNoticePage(db, { now: new Date(now.getTime() + 121_000) });
  assert.equal(resumed.inserted, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notifications").get()?.n, 55);
  await materializeNextPersistedNoticePage(db, { now: new Date(now.getTime() + 121_000) });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notifications").get()?.n, 60);
  assert.equal(sqlite.prepare("SELECT status FROM external_publication_events WHERE id=2").get()?.status, "done");

  // An older, unprocessed hash is never misrepresented as the latest update.
  sqlite.prepare("UPDATE publications SET content_hash=? WHERE id=?").run("c".repeat(64), id);
  sqlite.prepare("UPDATE publications SET content_hash=? WHERE id=?").run("d".repeat(64), id);
  const obsolete = await materializeNextPersistedNoticePage(db, { now: new Date(now.getTime() + 122_000) });
  assert.equal(obsolete.superseded, true);
  assert.equal(sqlite.prepare("SELECT status FROM external_publication_events WHERE id=3").get()?.status, "superseded");
  sqlite.close();
});

test("una publicación cerrada no recorre perfiles ni genera avisos", async () => {
  const { sqlite, db } = fixture();
  sqlite.prepare(insert).run(id, metadata, hash);
  sqlite.prepare("UPDATE publications SET normalized_status='CLOSED' WHERE id=?").run(id);
  const profile = sqlite.prepare("INSERT INTO profiles(user_id,notify_new_trainings,training_notify_scope) VALUES(?,1,'all')");
  for (let index = 0; index < 500; index++) profile.run(`user-${index}`);
  const result = await materializeNextPersistedNoticePage(db, { now });
  assert.equal(result.profiles, 0);
  assert.equal(result.inserted, 0);
  assert.equal(sqlite.prepare("SELECT status FROM external_publication_events WHERE id=1").get()?.status, "done");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notifications").get()?.n, 0);
  sqlite.close();
});
