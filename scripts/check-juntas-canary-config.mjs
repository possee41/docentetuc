// Read-only preflight. Never prints Wrangler credentials or other D1 metadata.
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const name = "docentetuc-web-canary-1-2";
const id = "853e2f5d-89b1-46a3-9c1c-5cbd46784756";
const production = "baaf5886-0123-4948-96da-aa7106424549";
for (const file of ["wrangler.1.2-import-canary.remote.jsonc", "wrangler.1.2-web-canary.remote.jsonc"]) {
  const config = JSON.parse(readFileSync(file, "utf8"));
  const binding = config.d1_databases?.[0];
  if (config.d1_databases?.length !== 1 || binding?.binding !== "DB" ||
      binding.database_name !== name || binding.database_id !== id || id === production ||
      config.routes || config.route || config.triggers?.crons?.length ||
      !["docentetuc-import-canary-1-2", "docentetuc-web-canary-1-2"].includes(config.name))
    throw new Error("CANARY_CONFIG_UNSAFE");
}
const gateway = JSON.parse(readFileSync("wrangler.1.2-import-canary.remote.jsonc", "utf8"));
if (gateway.vars?.IMPORT_GATE_ALLOWED_SOURCE !== "juntas" || gateway.vars?.IMPORT_DATABASE_ID !== id ||
    gateway.vars?.IMPORT_DATABASE_NAME !== name) throw new Error("CANARY_CONFIG_UNSAFE");
const log = resolve(".wrangler/juntas-preflight.log");
try {
  const raw = execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "list", "--json"], {
    encoding: "utf8", timeout: 30_000, env: { ...process.env, WRANGLER_LOG_PATH: log },
  });
  const databases = JSON.parse(raw);
  if (!Array.isArray(databases) || databases.filter((item) => item.name === name && item.uuid === id).length !== 1)
    throw new Error("CANARY_DATABASE_IDENTITY_MISMATCH");
  console.log(JSON.stringify({ accountAuthenticated: true, database: name, id,
    gateway: gateway.name, gatewayEnabled: gateway.vars.IMPORT_GATE_ENABLED,
    allowedSource: gateway.vars.IMPORT_GATE_ALLOWED_SOURCE, cron: false, routes: false }));
} catch (error) {
  throw new Error(error?.message === "CANARY_DATABASE_IDENTITY_MISMATCH" ? error.message : "CANARY_PREFLIGHT_FAILED");
} finally { rmSync(log, { force: true }); }
