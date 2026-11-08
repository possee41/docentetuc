import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifySyncPublication } from "./verify-sync-publication.mjs";
import gateway from "../workers/daily-source-gateway.mjs";
import { runDailySource } from "./daily-sources.mjs";
import { newsTarget } from "./news-via-receiver.mjs";

test("all publication imports load without network or npm runtime packages", async () => {
  const result = await verifySyncPublication();
  assert.equal(result.missingImports, 0); assert.equal(result.runtimeModules, 45);
  assert.equal(result.productionBinding, false); assert.equal(result.networkRequests, 0);
});
test("even enabled receiver refuses a production D1 before touching its binding", async () => {
  const config = JSON.parse(readFileSync(new URL("../wrangler.1.2-daily-sources.jsonc", import.meta.url), "utf8"));
  const env = { ...config.vars, DAILY_SOURCES_ENABLED: "true", IMPORT_DATABASE_ID: "baaf5886-0123-4948-96da-aa7106424549",
    DB: { prepare() { throw Error("PRODUCTION_DB_MUST_NOT_BE_TOUCHED"); } } };
  const result = await gateway.fetch(new Request("https://local.test/api/internal/import-identity?source=sime"), env);
  assert.equal(result.status, 503);
});
test("production destination rejected before credential or network access", async () => {
  assert.throws(() => newsTarget({ NEWS_DISCOVERY_ORIGIN: "https://docentetuc.com.ar", DAILY_PRODUCTION_APPROVED: "true" }), /NOT_APPROVED/);
  await assert.rejects(runDailySource({ DAILY_SOURCES_ENABLED: "false", IMPORT_GATEWAY_TARGET: "production" }, "a".repeat(40), {
    receiverFetch() { throw Error("NETWORK_MUST_NOT_BE_CALLED"); },
  }), /DAILY_SOURCE_DISABLED/);
});
test("manual validation job is read-only and does not request secrets or a canary environment", () => {
  const yaml = readFileSync(new URL("../.github/workflows/daily-public-sources.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const job = yaml.split("  validate:\n")[1].split("  sync:\n")[0];
  assert.ok(job.includes("contents: read")); assert.equal(/contents: write|secrets\.|GH_TOKEN:|environment:/.test(job), false);
  assert.equal(/^\s*schedule:/m.test(yaml), false);
});
