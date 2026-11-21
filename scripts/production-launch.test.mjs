import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import gateway from "../workers/source-import-gateway.mjs";
import { runScheduledTask } from "./scheduled-task.mjs";

const config = (name) => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), "utf8"));

test("initial production preparation keeps the existing Cron inert and the gateway closed", async () => {
  const web = config("wrangler.1.2-web-production.jsonc");
  const imports = config("wrangler.1.2-import-production.jsonc");
  assert.equal(web.name, "docentetuc");
  assert.equal(web.keep_vars, true);
  assert.equal(web.vars.AI_WEB_SEARCH_ENABLED, "0");
  assert.equal(web.vars.LEGACY_SYNC_PAUSED, "true");
  assert.equal(web.vars.PUSH_DISPATCH_MODE, "disabled");
  assert.deepEqual(web.triggers.crons, ["*/5 * * * *"]);
  assert.equal(web.routes, undefined); // Existing routes are preserved by versions upload/deploy.
  assert.equal(await runScheduledTask(web.triggers.crons[0], "synthetic-secret", async () => {
    throw new Error("INITIAL_RELEASE_MUST_NOT_RUN_SCHEDULED_WORK");
  }, web.vars.LEGACY_SYNC_PAUSED === "true", web.vars.PUSH_DISPATCH_MODE), "push-disabled");
  assert.equal(imports.name, "docentetuc-import-1-2");
  assert.deepEqual(imports.routes, []);
  assert.deepEqual(imports.triggers.crons, []);
  assert.equal(imports.vars.IMPORT_GATE_ENABLED, "false");
  assert.equal(imports.vars.IMPORT_GATE_ALLOWED_SOURCE, "sime");
  assert.equal(imports.vars.FDCI_EXTERNAL_ENABLED, "false");
  for (const item of [web, imports]) {
    assert.equal(item.d1_databases.length, 1);
    assert.equal(item.d1_databases[0].binding, "DB");
    assert.equal(item.d1_databases[0].database_name, "docentetuc-db");
    assert.equal(item.d1_databases[0].database_id, "baaf5886-0123-4948-96da-aa7106424549");
    assert.equal(Object.keys(item.vars).some((key) => /SECRET|TOKEN|API_KEY/.test(key)), false);
  }
  assert.equal(imports.vars.IMPORT_DATABASE_NAME, imports.d1_databases[0].database_name);
  assert.equal(imports.vars.IMPORT_DATABASE_ID, imports.d1_databases[0].database_id);
  // No D1 binding is instantiated: prove the disabled gateway exits before DB access.
  const response = await gateway.fetch(new Request("https://gateway.invalid/api/internal/sime-import", { method: "POST" }), {
    ...imports.vars, DB: { prepare() { throw new Error("DATABASE_MUST_NOT_BE_ACCESSED"); } },
  });
  assert.equal(response.status, 503);
});
