import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import gateway from "../workers/source-import-gateway.mjs";
import canary from "../workers/source-import-canary.mjs";

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
  post(env, "/api/internal/import-gate", { source, action: "open", ttlSeconds, owner: "test-run" }, token);
const close = (env: TestEnv, source = "fdci", token = secret) =>
  post(env, "/api/internal/import-gate", { source, action: "close", owner: "test-run" }, token);
const importBatch = (env: TestEnv, token = secret, owner = "test-run") => gateway.fetch(new Request(url("/api/internal/fdci-import"), {
  method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-import-gate-owner": owner },
  body: JSON.stringify({ mode: "batch", items: [] }) }), env);
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
    headers: { "content-type": "application/json" }, body: JSON.stringify({ source: "fdci", action: "open", owner: "test-run" }) }), env)).status, 401);
  assert.equal((await open(env, "fdci", 600, simeSecret)).status, 401);
  assert.equal((await post(env, "/api/internal/import-gate", { source: "otra", action: "open" })).status, 400);
  assert.equal((await gateway.fetch(new Request(url("/api/internal/import-gate")), env)).status, 405);
});

test("el TTL se limita a una ventana corta y acotada", async () => {
  const { env } = localEnv();
  for (const ttl of [1, 601, 999_999]) assert.equal((await open(env,"fdci",ttl)).status,400);
  const long = await open(env, "fdci", 600);
  const longSeconds = (Date.parse((await long.json()).expiresAt) - Date.now()) / 1000;
  assert.ok(longSeconds > 590 && longSeconds <= 600, `TTL máximo: ${longSeconds}`);
  assert.equal((await close(env)).status, 200);
  const short = await open(env, "fdci", 60);
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

test("dos aperturas simultáneas no pueden adquirir la misma concesión", async () => {
  const { env } = localEnv();
  const responses = await Promise.all([
    post(env, "/api/internal/import-gate", { source: "fdci", action: "open", owner: "run-a", ttlSeconds: 600 }),
    post(env, "/api/internal/import-gate", { source: "fdci", action: "open", owner: "run-b", ttlSeconds: 600 }),
  ]);
  assert.deepEqual(responses.map((r: Response) => r.status).sort(), [200, 409]);
});

test("una ejecución que no adquirió la concesión no puede cerrarla", async () => {
  const { env, sqlite } = localEnv();
  assert.equal((await post(env, "/api/internal/import-gate", { source: "fdci", action: "open", owner: "run-a" })).status, 200);
  assert.equal((await post(env, "/api/internal/import-gate", { source: "fdci", action: "close", owner: "run-b" })).status, 409);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM import_gate_lease").get()?.n, 1);
});

test("repetir open del titular no renueva el TTL ni escribe otra concesión", async () => {
  const { env, sqlite } = localEnv();
  const first = await (await open(env)).json();
  const before = sqlite.prepare("SELECT total_changes() AS n").get()?.n;
  const second = await (await open(env)).json();
  assert.deepEqual(second, first);
  assert.equal(sqlite.prepare("SELECT total_changes() AS n").get()?.n, before);
});

test("close no elimina la concesión de otra fuente aunque cambie después de leer", async () => {
  const { env, sqlite } = localEnv();
  await open(env);
  const prepare = env.DB.prepare;
  env.DB.prepare = sql => {
    if (sql.startsWith("DELETE FROM import_gate_lease")) sqlite.exec("UPDATE import_gate_lease SET source='cenet',opened_by='another-run'");
    return prepare(sql);
  };
  assert.equal((await close(env)).status, 409);
  assert.equal(sqlite.prepare("SELECT source FROM import_gate_lease").get()?.source, "cenet");
});

test("el wrapper canary rechaza otra D1 y no consulta D1 cuando está cerrado", async () => {
  const db = { prepare() { throw new Error("D1_MUST_NOT_BE_CALLED"); } };
  const env = { DB: db, IMPORT_DATABASE_NAME: "docentetuc-web-canary-1-2",
    IMPORT_DATABASE_ID: "853e2f5d-89b1-46a3-9c1c-5cbd46784756", IMPORT_GATE_ENABLED: "false" };
  const request = new Request(url("/api/internal/fdci-import"), { method: "POST" });
  assert.equal((await canary.fetch(request, { ...env, IMPORT_DATABASE_ID: "wrong-database" })).status, 503);
  const response = await canary.fetch(request, env);
  assert.equal(response.status, 503);
  assert.deepEqual(JSON.parse(response.headers.get("X-Canary-Metrics")!), { rpc: 0, queries: 0, rowsRead: 0, rowsWritten: 0 });
});

test("fuentes heredadas, tipos inválidos y JSON grande fallan sin acceso D1", async () => {
  const { env } = localEnv();
  env.DB.prepare = () => { throw new Error("D1_MUST_NOT_BE_CALLED"); };
  for (const source of ["constructor", "toString", "__proto__", null, {}, ["fdci"]]) {
    assert.equal((await post(env, "/api/internal/import-gate", { source, action: "open", owner: "test-run" })).status, 400);
  }
  const large = new Request(url("/api/internal/import-gate"), { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ source: "fdci", extra: "a".repeat(1100) }) });
  assert.equal((await gateway.fetch(large, env)).status, 413, "límite real sin Content-Length");
  assert.equal((await gateway.fetch(new Request(url("/api/internal/import-gate"), { method: "POST", body: "{}" }), env)).status, 415);
});

test("una ejecución antigua no puede importar ni cerrar durante una concesión nueva", async () => {
  const { env, sqlite } = localEnv();
  await open(env);
  assert.equal((await importBatch(env, secret, "otro-run")).status, 409);
  assert.equal((await importBatch(env, secret, "")).status, 409);
  sqlite.exec("UPDATE import_gate_lease SET expires_at='2000-01-01T00:00:00Z'");
  assert.equal((await post(env, "/api/internal/import-gate", { source: "fdci", action: "open", owner: "new-run" })).status, 200);
  assert.equal((await importBatch(env)).status, 409);
  assert.equal((await close(env)).status, 409);
  assert.equal((await importBatch(env, secret, "new-run")).status, 400);
  assert.equal((await importBatch(env, simeSecret, "new-run")).status, 401);
});

test("checkpoint FDCI exige lease y secreto de fuente; sin migración falla cerrado y nunca acepta SQL", async () => {
  const { env } = localEnv();
  assert.equal((await post(env, "/api/internal/fdci-checkpoint", { op: "get" })).status, 503);
  await open(env);
  const request = (body: unknown, token = secret) => new Request(url("/api/internal/fdci-checkpoint"), {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-import-gate-owner": "test-run" },
    body: JSON.stringify(body) });
  assert.equal((await gateway.fetch(request({ op: "get" }, simeSecret), env)).status, 401);
  assert.equal((await gateway.fetch(request({ op: "exec", sql: "DROP TABLE publications" }), env)).status, 400);
  const absent = await gateway.fetch(request({ op: "get" }), env);
  assert.equal(absent.status, 503);
  assert.equal((await absent.json()).error, "CHECKPOINT_UNAVAILABLE");
  assert.equal((await gateway.fetch(request({ op: "get" }), { ...env, IMPORT_GATE_LEASE_REQUIRED: "false" })).status, 503);
});
