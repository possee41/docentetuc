import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import gateway from "../workers/source-import-gateway.mjs";

const secret = "synthetic_fdci_gateway_secret_123456789";
const simeSecret = "synthetic_sime_gateway_secret_123456789";
const database = { name: "docentetuc-web-canary-1-2", id: "00000000-0000-4000-8000-000000000012" };

function localEnv(options: { lease?: boolean; gate?: boolean; fdci?: boolean; leaseTable?: boolean } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE import_gateway_identity (
    id INTEGER PRIMARY KEY CHECK (id = 1), database_name TEXT NOT NULL, database_id TEXT NOT NULL);
    INSERT INTO import_gateway_identity VALUES (1, '${database.name}', '${database.id}');`);
  if (options.leaseTable !== false) sqlite.exec(`CREATE TABLE import_gate_lease (
    id INTEGER PRIMARY KEY CHECK (id = 1), source TEXT NOT NULL, expires_at TEXT NOT NULL,
    opened_at TEXT NOT NULL, opened_by TEXT NOT NULL);`);
  const db = { prepare(sql: string) {
    const statement = sqlite.prepare(sql);
    let args: (string | number | null)[] = [];
    return {
      bind(...values: (string | number | null)[]) { args = values; return this; },
      async first() { return statement.get(...args) ?? null; },
      async run() { const result = statement.run(...args); return { success: true, meta: { changes: Number(result.changes) } }; },
    };
  } };
  return { sqlite, env: {
    DB: db,
    IMPORT_GATE_ENABLED: options.gate ? "true" : "false",
    IMPORT_GATE_LEASE_REQUIRED: options.lease === false ? "false" : "true",
    IMPORT_DATABASE_NAME: database.name,
    IMPORT_DATABASE_ID: database.id,
    FDCI_EXTERNAL_ENABLED: options.fdci === false ? "false" : "true",
    FDCI_IMPORT_SECRET: secret,
    SIME_IMPORT_SECRET: simeSecret,
  } };
}

const url = (path: string) => `https://gateway.example${path}`;
type TestEnv = ReturnType<typeof localEnv>["env"];
const post = (env: TestEnv, path: string, body: unknown, token = secret) => gateway.fetch(new Request(url(path), {
  method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify(body) }), env);
const open = (env: TestEnv, source = "fdci", ttlSeconds = 600, token = secret) =>
  post(env, "/api/internal/import-gate", { source, action: "open", ttlSeconds }, token);
const close = (env: TestEnv, source = "fdci", token = secret) =>
  post(env, "/api/internal/import-gate", { source, action: "close" }, token);
const importBatch = (env: TestEnv, token = secret) => post(env, "/api/internal/fdci-import",
  { mode: "batch", items: [] }, token);
const identity = (env: TestEnv) => gateway.fetch(new Request(url("/api/internal/import-identity?source=fdci"),
  { headers: { authorization: `Bearer ${secret}` } }), env);

test("sin modo de concesión el gateway sigue cerrado por defecto", async () => {
  const { env } = localEnv({ lease: false });
  assert.equal((await open(env)).status, 503);
  assert.equal((await importBatch(env)).status, 503);
  assert.equal((await identity(env)).status, 503);
});

test("una concesión autenticada habilita su fuente y expira sin depender del runner", async () => {
  const { env, sqlite } = localEnv();
  assert.equal((await importBatch(env)).status, 503, "sin concesión no se importa");
  const opened = await open(env);
  assert.equal(opened.status, 200);
  assert.ok(Date.parse((await opened.json()).expiresAt) > Date.now());
  assert.equal((await importBatch(env)).status, 400, "la concesión válida llega al receptor");
  sqlite.exec("UPDATE import_gate_lease SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=1");
  assert.equal((await importBatch(env)).status, 503, "una concesión vencida cierra la compuerta");
  assert.equal((await close(env)).status, 200);
  assert.equal((await importBatch(env)).status, 503);
});

test("otra fuente no puede abrir ni cerrar una concesión vigente", async () => {
  const { env } = localEnv();
  assert.equal((await open(env)).status, 200);
  assert.equal((await open(env, "sime", 600, simeSecret)).status, 409);
  assert.equal((await close(env, "sime", simeSecret)).status, 409);
  assert.equal((await importBatch(env)).status, 400, "la fuente titular conserva el acceso");
  assert.equal((await close(env)).status, 200);
  assert.equal((await open(env, "sime", 600, simeSecret)).status, 200, "la concesión quedó libre");
});

test("la concesión exige autenticación y rechaza fuentes desconocidas", async () => {
  const { env } = localEnv();
  assert.equal((await gateway.fetch(new Request(url("/api/internal/import-gate"), { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ source: "fdci", action: "open" }) }), env)).status, 401);
  assert.equal((await open(env, "fdci", 600, simeSecret)).status, 401);
  assert.equal((await post(env, "/api/internal/import-gate", { source: "otra", action: "open" })).status, 400);
  assert.equal((await gateway.fetch(new Request(url("/api/internal/import-gate")), env)).status, 405);
});

test("el TTL se limita a una ventana corta y acotada", async () => {
  const { env } = localEnv();
  const long = await open(env, "fdci", 999_999);
  const longSeconds = (Date.parse((await long.json()).expiresAt) - Date.now()) / 1000;
  assert.ok(longSeconds > 890 && longSeconds <= 900, `TTL máximo: ${longSeconds}`);
  const short = await open(env, "fdci", 1);
  const shortSeconds = (Date.parse((await short.json()).expiresAt) - Date.now()) / 1000;
  assert.ok(shortSeconds > 50 && shortSeconds <= 60, `TTL mínimo: ${shortSeconds}`);
});

test("sin la tabla de concesiones el gateway falla cerrado", async () => {
  const { env } = localEnv({ leaseTable: false });
  assert.equal((await open(env)).status, 503);
  assert.equal((await importBatch(env)).status, 503);
});

test("la identidad sigue disponible para el runner autenticado sin abrir la compuerta", async () => {
  const { env } = localEnv();
  const response = await identity(env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), database);
  assert.equal((await importBatch(env)).status, 503);
});
