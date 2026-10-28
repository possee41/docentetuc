// Upload the in-memory synthetic Juntas secret after the last canary deployment.
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const configFile = "wrangler.1.2-import-canary.remote.jsonc";
const config = JSON.parse(readFileSync(configFile, "utf8"));
const db = config.d1_databases?.[0];
if (config.name !== "docentetuc-import-canary-1-2" || config.vars?.IMPORT_GATE_ENABLED !== "true" ||
    config.vars?.IMPORT_GATE_ALLOWED_SOURCE !== "juntas" || config.d1_databases?.length !== 1 ||
    db?.binding !== "DB" || db.database_name !== "docentetuc-web-canary-1-2" ||
    db.database_id !== "853e2f5d-89b1-46a3-9c1c-5cbd46784756" ||
    config.routes || config.route || config.triggers?.crons?.length)
  throw new Error("CANARY_CONFIG_UNSAFE");
const secret = process.env.JUNTAS_IMPORT_SECRET;
if (!/^[A-Za-z0-9_-]{32,}$/.test(secret || "")) throw new Error("CANARY_SECRET_INVALID");
const log = resolve(".wrangler/rotate-juntas-secret.log");
try {
  const result = spawnSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "secret", "put",
    "JUNTAS_IMPORT_SECRET", "--config", configFile], {
    input: secret, encoding: "utf8", timeout: 60_000,
    env: { ...process.env, WRANGLER_LOG_PATH: log },
  });
  if (result.status !== 0) throw new Error("CANARY_SECRET_UPLOAD_FAILED");
  console.log("CANARY_JUNTAS_SECRET_ROTATED");
} finally { rmSync(log, { force: true }); }
