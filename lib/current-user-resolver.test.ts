import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createInstallationSecret, hashInstallationSecret } from "./installation-ownership.ts";
import { resolveCurrentUser } from "./current-user-resolver.ts";

const DEVICE = "550e8400-e29b-41d4-a716-446655440001";
const ACCOUNT_A = "account-a";
const ACCOUNT_B = "account-b";

function createDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE installation_credentials(device_id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL);
    CREATE TABLE account_installations(device_id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE profiles(user_id TEXT PRIMARY KEY, name TEXT NOT NULL);`);
  return database;
}

function asD1(database: DatabaseSync) {
  return {
    prepare(sql: string) {
      const statement = database.prepare(sql);
      return { bind(...values: string[]) { return { async first<T>() { return (statement.get(...values) as T | undefined) ?? null; } }; } };
    },
  };
}

function resolverDependencies(database: DatabaseSync, account: { accountId: string } | null = null) {
  return {
    getDatabase: () => asD1(database),
    getAccount: async () => account,
  };
}

test("una instalación no vinculada puede utilizar IA sin iniciar sesión", async () => {
  const database = createDatabase();
  try {
    const proof = createInstallationSecret();
    database.prepare("INSERT INTO installation_credentials(device_id, secret_hash) VALUES (?,?)").run(DEVICE, await hashInstallationSecret(proof));
    const request = new Request("http://localhost/api/ai/chat", {
      headers: { "X-DocenteTuc-Device": DEVICE, cookie: `docentetuc_installation_proof=${proof}` },
    });
    const user = await resolveCurrentUser(request, resolverDependencies(database));
    assert.equal(user.userId, `device:${DEVICE}`);
  } finally { database.close(); }
});

test("un UUID heredado sin prueba no autoriza datos privados en ninguno de los dos dominios", async () => {
  const database = createDatabase();
  try {
    database.prepare("INSERT INTO profiles(user_id,name) VALUES (?, 'Perfil sintético B')").run(`device:${DEVICE}`);
    const legacyRequest = new Request("https://docentetuc.possee41.workers.dev/api/app", { headers: { "X-DocenteTuc-Device": DEVICE } });
    const newOriginRequest = new Request("https://docentetuc.com.ar/api/app", { headers: { "X-DocenteTuc-Device": DEVICE } });
    await assert.rejects(resolveCurrentUser(legacyRequest, resolverDependencies(database)), /UNAUTHENTICATED/);
    await assert.rejects(resolveCurrentUser(newOriginRequest, resolverDependencies(database)), /UNAUTHENTICATED/);
    assert.equal((await resolveCurrentUser(legacyRequest, resolverDependencies(database, { accountId: ACCOUNT_A }))).userId, ACCOUNT_A);
    assert.equal((await resolveCurrentUser(newOriginRequest, resolverDependencies(database, { accountId: ACCOUNT_A }))).userId, ACCOUNT_A);
    assert.equal((database.prepare("SELECT name FROM profiles WHERE user_id=?").get(`device:${DEVICE}`) as { name: string }).name, "Perfil sintético B");
  } finally { database.close(); }
});

test("ni una tabla de vínculos ausente ni cabeceras de identidad no validadas habilitan un UUID heredado", async () => {
  const database = createDatabase();
  try {
    database.exec("DROP TABLE account_installations");
    const headers = { "X-DocenteTuc-Device": DEVICE, "oai-authenticated-user-id": `device:${DEVICE}`, "oai-authenticated-user-email": "synthetic@example.invalid" };
    for (const origin of ["https://docentetuc.possee41.workers.dev", "https://docentetuc.com.ar"]) {
      await assert.rejects(resolveCurrentUser(new Request(`${origin}/api/app`, { headers }), resolverDependencies(database)), /UNAUTHENTICATED/);
      await assert.rejects(resolveCurrentUser(new Request(`${origin}/api/app`, { headers }), resolverDependencies(database, { accountId: ACCOUNT_A })), /UNAUTHENTICATED/);
    }
  } finally { database.close(); }
});

test("la prueba privada de A nunca autoriza el UUID de B", async () => {
  const database = createDatabase();
  try {
    const secret = createInstallationSecret();
    const otherDevice = "550e8400-e29b-41d4-a716-446655440002";
    database.prepare("INSERT INTO installation_credentials(device_id, secret_hash) VALUES (?, ?), (?, ?)")
      .run(DEVICE, await hashInstallationSecret(secret), otherDevice, await hashInstallationSecret(createInstallationSecret()));
    const headers = { "X-DocenteTuc-Device": otherDevice, cookie: `docentetuc_installation_proof=${secret}` };
    await assert.rejects(resolveCurrentUser(new Request("https://docentetuc.possee41.workers.dev/api/app", { headers }), resolverDependencies(database)), /UNAUTHENTICATED/);
    assert.equal((await resolveCurrentUser(new Request("https://docentetuc.com.ar/api/app", { headers }), resolverDependencies(database, { accountId: ACCOUNT_A }))).userId, ACCOUNT_A);
  } finally { database.close(); }
});

test("una instalación vinculada no permite a otra identidad ni a una sesión ausente acceder a sus datos privados", async () => {
  const database = createDatabase();
  try {
    const proof = createInstallationSecret();
    database.prepare("INSERT INTO installation_credentials(device_id, secret_hash) VALUES (?,?)").run(DEVICE, await hashInstallationSecret(proof));
    database.prepare("INSERT INTO account_installations(device_id, account_id) VALUES (?,?)").run(DEVICE, ACCOUNT_A);
    const request = new Request("http://localhost/api/ai/chat", {
      headers: { "X-DocenteTuc-Device": DEVICE, cookie: `docentetuc_installation_proof=${proof}` },
    });

    await assert.rejects(resolveCurrentUser(request, resolverDependencies(database)), /UNAUTHENTICATED/);
    await assert.rejects(resolveCurrentUser(request, resolverDependencies(database, { accountId: ACCOUNT_B })), /UNAUTHENTICATED/);
    assert.equal((await resolveCurrentUser(request, resolverDependencies(database, { accountId: ACCOUNT_A }))).userId, ACCOUNT_A);
  } finally { database.close(); }
});
