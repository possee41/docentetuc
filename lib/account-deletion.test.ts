import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { accountDataDeletionStatements } from "./account-deletion.ts";

const COMMUNITY_MIGRATION = readFileSync(new URL("../migrations/0015_community.sql", import.meta.url), "utf8");
const SAVED_POSTS_MIGRATION = readFileSync(new URL("../migrations/0016_community_saved_posts.sql", import.meta.url), "utf8");

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
    db.exec(COMMUNITY_MIGRATION);
    db.exec(SAVED_POSTS_MIGRATION);
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
    db.prepare("INSERT INTO community_rules_acceptances(user_id, rules_version) VALUES (?, '1'), (?, '1')").run(ACCOUNT_A, ACCOUNT_B);
    db.prepare("INSERT INTO community_moderators(user_id) VALUES (?), (?)").run(ACCOUNT_A, ACCOUNT_B);
    const postA = "650e8400-e29b-41d4-a716-446655440001", postB = "650e8400-e29b-41d4-a716-446655440002";
    const commentA = "650e8400-e29b-41d4-a716-446655440003", commentB = "650e8400-e29b-41d4-a716-446655440004";
    db.prepare("INSERT INTO community_posts(id, author_user_id, body) VALUES (?, ?, 'post A'), (?, ?, 'post B')").run(postA, ACCOUNT_A, postB, ACCOUNT_B);
    db.prepare("INSERT INTO community_saved_posts(user_id, post_id) VALUES (?, ?), (?, ?)").run(ACCOUNT_A, postA, ACCOUNT_B, postB);
    db.prepare("INSERT INTO community_comments(id, post_id, author_user_id, body) VALUES (?, ?, ?, 'comment A'), (?, ?, ?, 'comment B')").run(commentA, postB, ACCOUNT_A, commentB, postA, ACCOUNT_B);
    db.prepare("INSERT INTO community_reports(id, reporter_user_id, target_type, post_id, reason) VALUES (?, ?, 'post', ?, 'spam'), (?, ?, 'post', ?, 'other')").run("650e8400-e29b-41d4-a716-446655440005", ACCOUNT_A, postB, "650e8400-e29b-41d4-a716-446655440006", ACCOUNT_B, postA);
    db.prepare("INSERT INTO community_blocks(id, blocker_user_id, blocked_user_id) VALUES (?, ?, ?), (?, ?, ?)").run("650e8400-e29b-41d4-a716-446655440007", ACCOUNT_A, ACCOUNT_B, "650e8400-e29b-41d4-a716-446655440008", ACCOUNT_B, ACCOUNT_A);
    db.prepare("INSERT INTO community_moderation_events(id, actor_user_id, target_type, post_id, action, reason) VALUES (?, ?, 'post', ?, 'hide', 'spam'), (?, ?, 'post', ?, 'hide', 'other')").run("650e8400-e29b-41d4-a716-446655440009", ACCOUNT_A, postB, "650e8400-e29b-41d4-a716-446655440010", ACCOUNT_B, postA);
    db.prepare("INSERT INTO community_rate_limits(user_id, action, window_key, request_count) VALUES (?, 'post', 1, 1), (?, 'post', 1, 1)").run(ACCOUNT_A, ACCOUNT_B);
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
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM community_posts WHERE author_user_id=?").get(ACCOUNT_A) as { count: number }).count, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM community_posts WHERE author_user_id=?").get(ACCOUNT_B) as { count: number }).count, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM community_comments WHERE author_user_id=?").get(ACCOUNT_A) as { count: number }).count, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM community_comments WHERE author_user_id=?").get(ACCOUNT_B) as { count: number }).count, 0, "comment on deleted A post cascades");
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM community_reports").get() as { count: number }).count, 0, "report rows authored by A or targeting deleted A content are removed");
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM community_blocks").get() as { count: number }).count, 0, "blocks involving A are removed");
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM community_rules_acceptances WHERE user_id=?").get(ACCOUNT_A) as { count: number }).count, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM community_moderators WHERE user_id=?").get(ACCOUNT_A) as { count: number }).count, 0);
    assert.equal((db.prepare("SELECT actor_user_id FROM community_moderation_events WHERE post_id=?").get(postB) as { actor_user_id: string | null }).actor_user_id, null, "audit actor is anonymized on account deletion");
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM community_moderation_events WHERE post_id=?").get(postA) as { count: number }).count, 0, "audit for deleted target is removed");
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM community_rate_limits WHERE user_id=?").get(ACCOUNT_A) as { count: number }).count, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM community_saved_posts WHERE user_id=?").get(ACCOUNT_A) as { count: number }).count, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM community_saved_posts WHERE user_id=?").get(ACCOUNT_B) as { count: number }).count, 1);
  } finally { db.close(); }
});

test("no construye un plan de borrado sin identidad de cuenta válida", () => {
  assert.throws(() => accountDataDeletionStatements("device:550e8400-e29b-41d4-a716-446655440001"));
});
