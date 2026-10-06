import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { accountDataDeletionStatements } from "./account-deletion.ts";

const ACCOUNT_A = "550e8400-e29b-41d4-a716-446655440000";
const ACCOUNT_B = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
const DEVICE_A = "device:550e8400-e29b-41d4-a716-446655440001";
const DEVICE_B = "device:550e8400-e29b-41d4-a716-446655440002";

test("eliminación autenticada borra todos los datos propios y vinculados, no los ajenos ni publicaciones", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE "user" (id TEXT PRIMARY KEY,email TEXT);
      CREATE TABLE "account" (id TEXT PRIMARY KEY,userId TEXT);
      CREATE TABLE "session" (id TEXT PRIMARY KEY,userId TEXT REFERENCES "user"(id) ON DELETE CASCADE);
      CREATE TABLE verification (identifier TEXT);
      CREATE TABLE account_installations (device_id TEXT PRIMARY KEY,source_user_id TEXT UNIQUE,account_id TEXT REFERENCES "user"(id) ON DELETE CASCADE);
      CREATE TABLE push_subscriptions (endpoint TEXT PRIMARY KEY,user_id TEXT);
      CREATE TABLE push_deliveries (endpoint TEXT,event_key TEXT);
      CREATE TABLE manual_event_push_queue (user_id TEXT);
      CREATE TABLE push_preferences (user_id TEXT);
      CREATE TABLE notifications (user_id TEXT);
      CREATE TABLE training_reminders (user_id TEXT);
      CREATE TABLE designation_tracking (user_id TEXT);
      CREATE TABLE saved_publications (user_id TEXT);
      CREATE TABLE manual_events (user_id TEXT);
      CREATE TABLE ai_rate_limits (user_bucket TEXT PRIMARY KEY);
      CREATE TABLE push_rate_limits (user_bucket TEXT PRIMARY KEY);
      CREATE TABLE public_profiles (user_id TEXT PRIMARY KEY);
      CREATE TABLE profiles (user_id TEXT PRIMARY KEY);
      CREATE TABLE publications (id TEXT PRIMARY KEY);`);
    for (const [id, email] of [[ACCOUNT_A, "a@example.invalid"], [ACCOUNT_B, "b@example.invalid"]]) {
      db.prepare('INSERT INTO "user" VALUES (?,?)').run(id, email);
      db.prepare('INSERT INTO "account" VALUES (?,?)').run(`${id}:google`, id);
      db.prepare('INSERT INTO "session" VALUES (?,?)').run(`${id}:session`, id);
      for (const table of ["push_preferences", "manual_event_push_queue", "notifications", "training_reminders", "designation_tracking", "saved_publications", "manual_events", "public_profiles", "profiles"]) db.prepare(`INSERT INTO ${table} VALUES (?)`).run(id);
      db.prepare("INSERT INTO push_subscriptions VALUES (?,?)").run(`endpoint:${id}`, id);
      db.prepare("INSERT INTO push_deliveries VALUES (?,?)").run(`endpoint:${id}`, `delivery:${id}`);
      db.prepare("INSERT INTO ai_rate_limits VALUES (?)").run(`${id}:bucket`);
      db.prepare("INSERT INTO push_rate_limits VALUES (?)").run(`${id}:bucket`);
    }
    for (const [device, account, email] of [[DEVICE_A, ACCOUNT_A, "a@example.invalid"], [DEVICE_B, ACCOUNT_B, "b@example.invalid"]]) {
      db.prepare("INSERT INTO account_installations VALUES (?,?,?)").run(device.slice(7), device, account);
      for (const table of ["push_preferences", "manual_event_push_queue", "notifications", "training_reminders", "designation_tracking", "saved_publications", "manual_events", "public_profiles", "profiles"]) db.prepare(`INSERT INTO ${table} VALUES (?)`).run(device);
      db.prepare("INSERT INTO push_subscriptions VALUES (?,?)").run(`endpoint:${device}`, device);
      db.prepare("INSERT INTO push_deliveries VALUES (?,?)").run(`endpoint:${device}`, `delivery:${device}`);
      db.prepare("INSERT INTO ai_rate_limits VALUES (?)").run(`${device}:bucket`);
      db.prepare("INSERT INTO push_rate_limits VALUES (?)").run(`${device}:bucket`);
      db.prepare("INSERT INTO verification VALUES (?)").run(email);
    }
    db.prepare("INSERT INTO publications VALUES ('official:one')").run();
    for (const { sql, values } of accountDataDeletionStatements(ACCOUNT_A)) db.prepare(sql).run(...values);

    for (const table of ["push_preferences", "manual_event_push_queue", "notifications", "training_reminders", "designation_tracking", "saved_publications", "manual_events", "public_profiles", "profiles"]) {
      assert.equal((db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id=?`).get(ACCOUNT_A) as { count: number }).count, 0, table);
      assert.equal((db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id=?`).get(DEVICE_A) as { count: number }).count, 0, table);
      assert.equal((db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id=?`).get(ACCOUNT_B) as { count: number }).count, 1, table);
      assert.equal((db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id=?`).get(DEVICE_B) as { count: number }).count, 1, table);
    }
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM "user" WHERE id=?').get(ACCOUNT_A) as { count: number }).count, 0);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM "user" WHERE id=?').get(ACCOUNT_B) as { count: number }).count, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM account_installations WHERE account_id=?").get(ACCOUNT_A) as { count: number }).count, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM account_installations WHERE account_id=?").get(ACCOUNT_B) as { count: number }).count, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM publications").get() as { count: number }).count, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM verification WHERE identifier=?").get("a@example.invalid") as { count: number }).count, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM verification WHERE identifier=?").get("b@example.invalid") as { count: number }).count, 1);
  } finally { db.close(); }
});

test("no construye un plan de borrado sin identidad de cuenta válida", () => {
  assert.throws(() => accountDataDeletionStatements("device:550e8400-e29b-41d4-a716-446655440001"));
});
