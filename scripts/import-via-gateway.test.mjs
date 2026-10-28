import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import gateway from "../workers/source-import-gateway.mjs";
import { resolveGatewayConfig, verifyGatewayIdentity } from "./import-via-gateway.mjs";

const secret = "synthetic_sime_gateway_secret_123456789";
const local = { SYNC_SOURCE: "sime", IMPORT_GATEWAY_ORIGIN: "http://127.0.0.1:8798/",
  IMPORT_GATEWAY_DATABASE_ID: "00000000-0000-4000-8000-000000000012",
  IMPORT_GATEWAY_DATABASE_NAME: "docentetuc-web-canary-1-2-local", SIME_IMPORT_SECRET: secret };
const identity = { database_name: local.IMPORT_GATEWAY_DATABASE_NAME, database_id: local.IMPORT_GATEWAY_DATABASE_ID };
const db = { reads: 0, prepare(sql) {
  assert.equal(sql, "SELECT database_name,database_id FROM import_gateway_identity WHERE id=1");
  return { first: async () => { this.reads++; return identity; } };
} };
const env = { DB: db, IMPORT_GATE_ENABLED: "true", IMPORT_DATABASE_NAME: identity.database_name,
  IMPORT_DATABASE_ID: identity.database_id, SIME_IMPORT_SECRET: secret };
const request = (token) => new Request("https://canary.invalid/api/internal/import-identity?source=sime",
  { headers: token ? { Authorization: `Bearer ${token}` } : {} });

test("gateway fails closed before any D1 query when disabled or unauthenticated", async () => {
  db.reads = 0;
  assert.equal((await gateway.fetch(request(secret), { ...env, IMPORT_GATE_ENABLED: "false" })).status, 503);
  assert.equal((await gateway.fetch(request(), env)).status, 401);
  assert.equal(db.reads, 0);
  assert.equal((await gateway.fetch(new Request("https://canary.invalid/", { method: "POST", body: "DROP TABLE publications" }), env)).status, 404);
});

test("gateway verifies its bound D1 and Node verifies the same target", async () => {
  const target = resolveGatewayConfig(local);
  assert.deepEqual({ id: target.id, name: target.name }, { id: identity.database_id, name: identity.database_name });
  const fetcher = async (url, init) => gateway.fetch(new Request(url, init), env);
  await verifyGatewayIdentity(target, fetcher);
  assert.equal((await gateway.fetch(request(secret), { ...env, IMPORT_DATABASE_ID: "other" })).status, 503);
  await assert.rejects(verifyGatewayIdentity({ ...target, id: "other" }, fetcher), /GATEWAY_IDENTITY_MISMATCH/);
});

test("runner rejects production, unrelated hosts and incomplete configuration", () => {
  assert.throws(() => resolveGatewayConfig({ ...local, IMPORT_GATEWAY_DATABASE_ID: "baaf5886-0123-4948-96da-aa7106424549" }), /GATEWAY_TARGET_FORBIDDEN/);
  assert.throws(() => resolveGatewayConfig({ ...local, IMPORT_GATEWAY_ORIGIN: "https://docentetuc.com.ar/" }), /GATEWAY_CONFIG_INVALID/);
  assert.throws(() => resolveGatewayConfig({ ...local, IMPORT_GATEWAY_TARGET: "production" }), /GATEWAY_PRODUCTION_NOT_APPROVED/);
  assert.throws(() => resolveGatewayConfig({ ...local, SIME_IMPORT_SECRET: "" }), /GATEWAY_SECRET_INVALID/);
  assert.throws(() => resolveGatewayConfig({ ...local, SYNC_SOURCE: "juntas" }), /GATEWAY_SECRET_INVALID/);
  assert.equal(resolveGatewayConfig({ ...local, SYNC_SOURCE: "juntas", JUNTAS_IMPORT_SECRET: secret }).source, "juntas");
});

test("the other three gateway routes remain source-specific", () => {
  for (const source of ["fdci", "cenet", "infd"]) {
    const target = resolveGatewayConfig({ ...local, SYNC_SOURCE: source, [`${source.toUpperCase()}_IMPORT_SECRET`]: secret });
    assert.equal(new URL(target.endpoint).pathname, source === "fdci" ? "/api/internal/fdci-import" :
      `/api/internal/public-source-import/${source}`);
    assert.equal(target.id, local.IMPORT_GATEWAY_DATABASE_ID);
  }
});

test("both canary configs bind only the synthetic D1, with no route or Cron", () => {
  for (const file of ["wrangler.1.2-web-canary.jsonc", "wrangler.1.2-import-canary.jsonc"]) {
    const config = JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
    assert.equal(config.d1_databases.length, 1);
    assert.equal(config.d1_databases[0].database_id, local.IMPORT_GATEWAY_DATABASE_ID);
    assert.equal(config.d1_databases[0].database_name, local.IMPORT_GATEWAY_DATABASE_NAME);
    assert.deepEqual(config.triggers.crons, []);
    assert.equal(config.routes, undefined);
    assert.equal(config.route, undefined);
  }
});
