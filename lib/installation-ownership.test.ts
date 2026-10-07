import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createInstallationSecret, hashInstallationSecret, installationDataDeletionStatements, installationDeletionConfirmed, installationHasData, installationIdForProof, installationProofCookies, installationProofFor, readInstallationProof } from "./installation-ownership.ts";

const MIGRATION = readFileSync(new URL("../migrations/0017_installation_credentials.sql", import.meta.url), "utf8");
const DEVICE_A = "550e8400-e29b-41d4-a716-446655440001";
const DEVICE_B = "550e8400-e29b-41d4-a716-446655440002";
const ID_A = `device:${DEVICE_A}`;
const ID_B = `device:${DEVICE_B}`;

function d1(db: DatabaseSync) {
  return {
    prepare(sql: string) {
      const statement = db.prepare(sql);
      return { bind(...values: (string | number)[]) { return { async first<T>() { return (statement.get(...values) as T | undefined) ?? null; } }; } };
    },
  };
}

function dataDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(MIGRATION);
  db.exec(`CREATE TABLE account_installations(device_id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE profiles(user_id TEXT PRIMARY KEY, name TEXT DEFAULT 'Docente', email TEXT, level TEXT DEFAULT '', area TEXT DEFAULT '', subjects TEXT DEFAULT '', junta TEXT DEFAULT '', roles TEXT DEFAULT '', department TEXT DEFAULT '', locality TEXT DEFAULT '', shifts TEXT DEFAULT '', wants_interim INTEGER DEFAULT 1, wants_substitute INTEGER DEFAULT 1, training_interests TEXT DEFAULT '', characters TEXT DEFAULT '', circuits TEXT DEFAULT '', personal_match_threshold INTEGER DEFAULT 85, notify_new_trainings INTEGER DEFAULT 0, training_notify_scope TEXT DEFAULT 'relevant', training_match_threshold INTEGER DEFAULT 80);
    CREATE TABLE public_profiles(user_id TEXT); CREATE TABLE saved_publications(user_id TEXT); CREATE TABLE notifications(user_id TEXT);
    CREATE TABLE training_reminders(user_id TEXT); CREATE TABLE designation_tracking(user_id TEXT); CREATE TABLE manual_events(user_id TEXT);
    CREATE TABLE manual_event_push_queue(user_id TEXT); CREATE TABLE push_preferences(user_id TEXT);
    CREATE TABLE push_subscriptions(endpoint TEXT PRIMARY KEY, user_id TEXT, device_id TEXT); CREATE TABLE push_deliveries(endpoint TEXT);
    CREATE TABLE ai_rate_limits(user_bucket TEXT); CREATE TABLE push_rate_limits(user_bucket TEXT);`);
  return db;
}

test("0017 crea la tabla de posesión y puede aplicarse dos veces sin datos ni secretos", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(MIGRATION);
    db.exec(MIGRATION);
    const columns = db.prepare("PRAGMA table_info(installation_credentials)").all() as { name: string }[];
    assert.deepEqual(columns.map((column) => column.name), ["device_id", "secret_hash", "created_at"]);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM installation_credentials").get() as { n: number }).n, 0);
  } finally { db.close(); }
});

test("solo el secreto de posesión correcto acredita el ID registrado; el ID solo y el secreto de otra instalación fallan", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(MIGRATION);
    const secretA = createInstallationSecret();
    db.prepare("INSERT INTO installation_credentials(device_id, secret_hash) VALUES (?,?)").run(DEVICE_A, await hashInstallationSecret(secretA));
    const database = d1(db);
    assert.equal(await installationProofFor(database, new Request("https://local.test/api/app"), DEVICE_A), "invalid");
    assert.equal(await installationProofFor(database, new Request("https://local.test/api/app", { headers: { cookie: `docentetuc_installation_proof=${secretA}` } }), DEVICE_A), "valid");
    assert.equal(await installationProofFor(database, new Request("https://local.test/api/app", { headers: { cookie: `docentetuc_installation_proof=${secretA}` } }), DEVICE_B), "missing");
    db.prepare("INSERT INTO installation_credentials(device_id, secret_hash) VALUES (?,?)").run(DEVICE_B, await hashInstallationSecret(createInstallationSecret()));
    assert.equal(await installationProofFor(database, new Request("https://local.test/api/app", { headers: { cookie: `docentetuc_installation_proof=${secretA}` } }), DEVICE_B), "invalid");
    assert.notEqual(db.prepare("SELECT secret_hash FROM installation_credentials WHERE device_id=?").get(DEVICE_A)?.secret_hash, secretA);
  } finally { db.close(); }
});

test("se puede recuperar un ID local perdido solo con la cookie de posesión correspondiente", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(MIGRATION);
    const secret = createInstallationSecret();
    db.prepare("INSERT INTO installation_credentials(device_id, secret_hash) VALUES (?,?)").run(DEVICE_A, await hashInstallationSecret(secret));
    const database = d1(db);
    assert.equal(await installationIdForProof(database, new Request("https://local.test/api/installations/credential")), null);
    assert.equal(await installationIdForProof(database, new Request("https://local.test/api/installations/credential", { headers: { cookie: `docentetuc_installation_proof=${createInstallationSecret()}` } })), null);
    assert.equal(await installationIdForProof(database, new Request("https://local.test/api/installations/credential", { headers: { cookie: `docentetuc_installation_proof=${secret}` } })), DEVICE_A);
  } finally { db.close(); }
});

test("secreto de instalación aleatorio y HttpOnly queda limitado a rutas propias, nunca Comunidad", () => {
  const request = new Request("https://docentetuc.test/api/installations/credential");
  const secret = createInstallationSecret();
  const cookies = installationProofCookies(request, secret);
  assert.match(secret, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(cookies.every((cookie) => cookie.includes("HttpOnly") && cookie.includes("SameSite=Lax") && cookie.includes("Secure")));
  assert.ok(cookies.every((cookie) => !cookie.includes("/api/community")));
  assert.equal(readInstallationProof(new Request(request.url, { headers: { cookie: cookies[0].split(";")[0] } })), secret);
  assert.ok(installationProofCookies(request, "", true).every((cookie) => cookie.includes("Max-Age=0")));
});

test("un fallo o una respuesta parcial no autoriza limpiar el identificador local; solo éxito confirmado", () => {
  assert.equal(installationDeletionConfirmed(false, { installationDataDeleted: true }), false);
  assert.equal(installationDeletionConfirmed(true, { installationDataDeleted: false }), false);
  assert.equal(installationDeletionConfirmed(true, {}), false);
  assert.equal(installationDeletionConfirmed(true, { installationDataDeleted: true }), true);
});

test("no convierte un perfil vacío de compatibilidad en una instalación con datos; sí detecta datos heredados", async () => {
  const db = dataDatabase();
  try {
    const database = d1(db);
    db.prepare("INSERT INTO profiles(user_id) VALUES (?)").run(ID_A);
    assert.equal(await installationHasData(database, DEVICE_A), false);
    db.prepare("INSERT INTO saved_publications(user_id) VALUES (?)").run(ID_A);
    assert.equal(await installationHasData(database, DEVICE_A), true);
    assert.equal(await installationHasData(database, DEVICE_B), false);
  } finally { db.close(); }
});

test("borrar instalación elimina únicamente su propio alcance y se niega si ya está vinculada", () => {
  const db = dataDatabase();
  try {
    db.prepare("INSERT INTO installation_credentials(device_id, secret_hash) VALUES (?, 'hash-a'), (?, 'hash-b')").run(DEVICE_A, DEVICE_B);
    for (const table of ["profiles", "saved_publications", "notifications", "training_reminders", "designation_tracking", "manual_events", "manual_event_push_queue", "push_preferences", "public_profiles"]) {
      db.prepare(`INSERT INTO ${table}(user_id) VALUES (?), (?)`).run(ID_A, ID_B);
    }
    db.prepare("INSERT INTO push_subscriptions VALUES ('endpoint-a', ?, ?), ('endpoint-b', ?, ?)").run(ID_A, DEVICE_A, ID_B, DEVICE_B);
    db.prepare("INSERT INTO push_deliveries VALUES ('endpoint-a'), ('endpoint-b')").run();
    db.prepare("INSERT INTO ai_rate_limits VALUES (?), (?)").run(`${ID_A}:ai`, `${ID_B}:ai`);
    db.prepare("INSERT INTO push_rate_limits VALUES (?), (?)").run(`${ID_A}:push`, `${ID_B}:push`);

    for (const { sql, values } of installationDataDeletionStatements(DEVICE_A)) db.prepare(sql).run(...values);
    for (const table of ["profiles", "saved_publications", "notifications", "training_reminders", "designation_tracking", "manual_events", "manual_event_push_queue", "push_preferences", "public_profiles"]) {
      assert.equal((db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id=?`).get(ID_A) as { count: number }).count, 0, table);
      assert.equal((db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id=?`).get(ID_B) as { count: number }).count, 1, table);
    }
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM push_subscriptions WHERE device_id=?").get(DEVICE_A) as { count: number }).count, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM push_subscriptions WHERE device_id=?").get(DEVICE_B) as { count: number }).count, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM installation_credentials WHERE device_id=?").get(DEVICE_A) as { count: number }).count, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM installation_credentials WHERE device_id=?").get(DEVICE_B) as { count: number }).count, 1);

    db.prepare("INSERT INTO installation_credentials(device_id, secret_hash) VALUES (?, 'hash-a')").run(DEVICE_A);
    db.prepare("INSERT INTO account_installations(device_id,account_id) VALUES (?, 'account-a')").run(DEVICE_A);
    for (const { sql, values } of installationDataDeletionStatements(DEVICE_A)) db.prepare(sql).run(...values);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM installation_credentials WHERE device_id=?").get(DEVICE_A) as { count: number }).count, 1, "linked installation remains for account deletion");
  } finally { db.close(); }
});
