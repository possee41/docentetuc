import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { userDataDeletionStatements } from "./data-deletion.ts";

test("borra todos los registros de una identidad sin tocar otras identidades ni publicaciones", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE publications (id TEXT PRIMARY KEY);
      CREATE TABLE profiles (user_id TEXT PRIMARY KEY);
      CREATE TABLE public_profiles (user_id TEXT PRIMARY KEY, display_name TEXT, avatar_id TEXT, bio TEXT);
      CREATE TABLE saved_publications (user_id TEXT, publication_id TEXT);
      CREATE TABLE notifications (user_id TEXT);
      CREATE TABLE training_reminders (user_id TEXT);
      CREATE TABLE designation_tracking (user_id TEXT);
      CREATE TABLE manual_events (user_id TEXT);
      CREATE TABLE manual_event_push_queue (user_id TEXT);
      CREATE TABLE push_subscriptions (endpoint TEXT PRIMARY KEY, user_id TEXT);
      CREATE TABLE push_preferences (user_id TEXT);
      CREATE TABLE push_deliveries (endpoint TEXT);
      CREATE TABLE ai_rate_limits (user_bucket TEXT);
      CREATE TABLE push_rate_limits (user_bucket TEXT);`);
    const own = "device:550e8400-e29b-41d4-a716-446655440000";
    const other = "device:550e8400-e29b-41d4-a716-446655440001";
    db.prepare("INSERT INTO publications VALUES (?)").run("official:1");
    for (const id of [own, other]) {
      for (const table of ["profiles", "notifications", "training_reminders", "designation_tracking", "manual_events", "manual_event_push_queue", "push_preferences"]) {
        db.prepare(`INSERT INTO ${table} (user_id) VALUES (?)`).run(id);
      }
      db.prepare("INSERT INTO public_profiles (user_id, display_name, avatar_id, bio) VALUES (?, ?, ?, ?)").run(id, "Nombre", "avatar_01", "Bio");
      db.prepare("INSERT INTO saved_publications VALUES (?, ?)").run(id, "official:1");
      db.prepare("INSERT INTO push_subscriptions VALUES (?, ?)").run(`endpoint:${id}`, id);
      db.prepare("INSERT INTO push_deliveries VALUES (?)").run(`endpoint:${id}`);
      db.prepare("INSERT INTO ai_rate_limits VALUES (?)").run(`${id}:42`);
      db.prepare("INSERT INTO push_rate_limits VALUES (?)").run(`${id}:push-test:today`);
    }
    for (const statement of userDataDeletionStatements(own)) db.prepare(statement.sql).run(...statement.values);
    for (const statement of userDataDeletionStatements(own)) db.prepare(statement.sql).run(...statement.values);
    for (const table of ["profiles", "public_profiles", "saved_publications", "notifications", "training_reminders", "designation_tracking", "manual_events", "manual_event_push_queue", "push_subscriptions", "push_preferences"]) {
      assert.equal((db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE user_id=?`).get(own) as { count: number }).count, 0, table);
      assert.equal((db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE user_id=?`).get(other) as { count: number }).count, 1, table);
    }
    assert.equal((db.prepare("SELECT COUNT(*) count FROM push_deliveries WHERE endpoint=?").get(`endpoint:${own}`) as { count: number }).count, 0);
    assert.equal((db.prepare("SELECT COUNT(*) count FROM push_deliveries WHERE endpoint=?").get(`endpoint:${other}`) as { count: number }).count, 1);
    for (const table of ["ai_rate_limits", "push_rate_limits"]) {
      assert.equal((db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE user_bucket LIKE ?`).get(`${own}:%`) as { count: number }).count, 0);
      assert.equal((db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE user_bucket LIKE ?`).get(`${other}:%`) as { count: number }).count, 1);
    }
    assert.equal((db.prepare("SELECT COUNT(*) count FROM publications").get() as { count: number }).count, 1);
  } finally { db.close(); }
});

test("no acepta una identidad vacía", () => assert.throws(() => userDataDeletionStatements("")));
