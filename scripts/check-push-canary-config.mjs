import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const NAME = "docentetuc-push-canary-1-2";
const PRODUCTION_D1_ID = "baaf5886-0123-4948-96da-aa7106424549";
const allowedKeys = ["name", "main", "compatibility_date", "workers_dev", "vars", "routes", "triggers", "observability", "d1_databases"];

export function checkPushCanaryConfig(config) {
  const database = config?.d1_databases?.[0];
  if (!config || Object.keys(config).some((key) => !allowedKeys.includes(key)) ||
      config.name !== NAME || config.main !== "workers/push-canary.mjs" ||
      config.compatibility_date !== "2026-10-26" ||
      config.workers_dev !== true || !Array.isArray(config.routes) || config.routes.length !== 0 ||
      !config.vars || Object.keys(config.vars).length !== 1 ||
      !/^[a-z0-9-]{1,32}$/.test(config.vars.CANARY_BUILD_ID || "") ||
      !Array.isArray(config.triggers?.crons) || config.triggers.crons.length !== 0 ||
      config.observability?.enabled !== true || config.observability?.logs?.invocation_logs !== true ||
      config.observability?.logs?.head_sampling_rate !== 1 ||
      !Array.isArray(config.d1_databases) || config.d1_databases.length !== 1 ||
      database.binding !== "DB" || database.database_name !== NAME ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(database.database_id || "") ||
      database.database_id === "00000000-0000-0000-0000-000000000000" ||
      database.database_id.toLowerCase() === PRODUCTION_D1_ID)
    throw new Error("PUSH_CANARY_CONFIG_UNSAFE");
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    checkPushCanaryConfig(JSON.parse(readFileSync(process.argv[2] || "wrangler.push-canary.json", "utf8")));
    console.log("PUSH_CANARY_CONFIG_OK");
  } catch { console.error("PUSH_CANARY_CONFIG_UNSAFE"); process.exitCode = 1; }
}
