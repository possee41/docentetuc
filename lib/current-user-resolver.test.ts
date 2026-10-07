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
    CREATE TABLE account_installations(device_id TEXT PRIMARY KEY, account_id TEXT NOT NULL);`);
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
    getFallbackUser: async () => null,
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
