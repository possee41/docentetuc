import assert from "node:assert/strict";
import test from "node:test";
import { resolveDirectD1Target, verifyDirectD1Identity } from "../scripts/import-direct-d1.mjs";

const account = "a".repeat(32), revision = "b".repeat(40);
const approved = { DIRECT_D1_TARGET: "production", DIRECT_D1_PRODUCTION_ENABLED: "true",
  CF_ACCOUNT_ID: account, D1_PRODUCTION_ACCOUNT_ID: account, DIRECT_D1_APPROVED_SHA: revision };

test("D1 REST usa canary por defecto y rechaza un destino productivo incompleto", () => {
  assert.equal(resolveDirectD1Target({}, "").name, "docentetuc-fdci-canary-1-1");
  assert.throws(() => resolveDirectD1Target({ D1_DATABASE_ID: "otro" }, ""), /D1_DATABASE_OVERRIDE_FORBIDDEN/);
  for (const config of [
    { ...approved, DIRECT_D1_TARGET: "otro" },
    { ...approved, DIRECT_D1_PRODUCTION_ENABLED: "false" },
    { ...approved, D1_PRODUCTION_ACCOUNT_ID: "c".repeat(32) },
    { ...approved, DIRECT_D1_APPROVED_SHA: "c".repeat(40) },
  ]) assert.throws(() => resolveDirectD1Target(config, revision), /PRODUCTION_D1_NOT_APPROVED/);
  assert.throws(() => resolveDirectD1Target(approved, "c".repeat(40)), /PRODUCTION_D1_NOT_APPROVED/);
  assert.equal(resolveDirectD1Target(approved, revision).name, "docentetuc-db");
});

test("D1 REST comprueba UUID y nombre antes de importar; no consulta SQL", async () => {
  const target = resolveDirectD1Target(approved, revision);
  const calls: string[] = [];
  const fetcher = async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return Response.json({ success: true, result: { uuid: target.id, name: target.name } });
  };
  await verifyDirectD1Identity({ accountId: account, token: "synthetic-token", target, fetcher });
  assert.deepEqual(calls, [`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${target.id}`]);
  await assert.rejects(verifyDirectD1Identity({ accountId: account, token: "synthetic-token", target,
    fetcher: async () => Response.json({ success: true, result: { uuid: target.id, name: "otra-base" } }) }),
  /D1_IDENTITY_MISMATCH/);
});
