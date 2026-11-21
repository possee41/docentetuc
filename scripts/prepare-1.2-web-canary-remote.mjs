// One-time schema setup for the approved isolated D1. Refuses any other account or UUID.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const expected = { account: "6bbc3dae7e111660f0c835677ceffb69",
  name: "docentetuc-web-canary-1-2", id: "853e2f5d-89b1-46a3-9c1c-5cbd46784756" };
const web = JSON.parse(readFileSync(join(root, "wrangler.1.2-web-canary.remote.jsonc"), "utf8"));
const gateway = JSON.parse(readFileSync(join(root, "wrangler.1.2-import-canary.remote.jsonc"), "utf8"));
for (const [config, name] of [[web, "docentetuc-web-canary-1-2"], [gateway, "docentetuc-import-canary-1-2"]]) {
  const binding = config.d1_databases?.[0];
  if (config.name !== name || config.d1_databases?.length !== 1 || binding?.binding !== "DB" ||
      binding?.database_name !== expected.name || binding?.database_id !== expected.id ||
      config.route || config.routes || config.triggers?.crons?.length)
    throw new Error("REMOTE_CANARY_CONFIG_UNSAFE");
}
if (web.vars?.PUSH_DISPATCH_MODE !== "disabled" || web.vars?.AI_WEB_SEARCH_ENABLED !== "0" ||
    web.vars?.LEGACY_SYNC_PAUSED !== "true" || gateway.vars?.IMPORT_GATE_ENABLED !== "false" ||
    gateway.vars?.IMPORT_DATABASE_NAME !== expected.name || gateway.vars?.IMPORT_DATABASE_ID !== expected.id)
  throw new Error("REMOTE_CANARY_CONFIG_UNSAFE");

const environment = { ...process.env, WRANGLER_SEND_METRICS: "false",
  WRANGLER_LOG_PATH: join(root, ".wrangler", "web-canary-remote.log") };
const wrangler = (...args) => execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", ...args],
  { cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 10_000_000, env: environment });
const account = JSON.parse(wrangler("whoami", "--json"));
if (account.accounts?.length !== 1 || account.accounts[0]?.id !== expected.account)
  throw new Error("REMOTE_CANARY_ACCOUNT_MISMATCH");
const database = JSON.parse(wrangler("d1", "info", expected.name, "--json"));
if (database.name !== expected.name || database.uuid !== expected.id || database.num_tables !== 0)
  throw new Error("REMOTE_CANARY_DATABASE_MISMATCH_OR_NOT_EMPTY");

const baseline = ["0000_docentetuc.sql", "0001_training_metadata.sql", "0002_reminders_ai.sql", "0003_web_push.sql"]
  .map((name) => join(root, "drizzle", name));
const migrations = readdirSync(join(root, "migrations")).filter((name) => {
  const match = name.match(/^(\d{4})_.+\.sql$/), number = Number(match?.[1]);
  return match && (number >= 2 && number <= 22 || number >= 25 && number <= 29);
}).sort().map((name) => join(root, "migrations", name));
if (migrations.length !== 26 || migrations.at(-1)?.endsWith("0029_import_gateway_identity.sql") !== true)
  throw new Error("REMOTE_CANARY_MIGRATIONS_UNEXPECTED");
const identity = `INSERT INTO import_gateway_identity(id,database_name,database_id)
VALUES(1,'${expected.name}','${expected.id}');`;
const directory = join(root, ".wrangler");
mkdirSync(directory, { recursive: true });
const file = join(directory, "web-canary-remote-schema.sql");
writeFileSync(file, [...baseline, ...migrations].map((path) => readFileSync(path, "utf8")).join("\n") +
  "\n" + identity + "\n" + readFileSync(join(root, "scripts", "seed-1.2-canary.sql"), "utf8"));
try {
  wrangler("d1", "execute", "DB", "--config", "wrangler.1.2-web-canary.remote.jsonc",
    "--remote", "--yes", "--file", file);
} finally { unlinkSync(file); }
const checked = JSON.parse(wrangler("d1", "execute", "DB", "--config", "wrangler.1.2-web-canary.remote.jsonc",
  "--remote", "--command", "SELECT database_name,database_id FROM import_gateway_identity WHERE id=1; SELECT COUNT(*) AS total FROM publications", "--json"));
if (checked?.[0]?.results?.[0]?.database_name !== expected.name ||
    checked?.[0]?.results?.[0]?.database_id !== expected.id || checked?.[1]?.results?.[0]?.total !== 5)
  throw new Error("REMOTE_CANARY_SEED_VERIFICATION_FAILED");
console.log(JSON.stringify({ database: expected.name, id: expected.id, syntheticPublications: 5, schema: "1.2 through 0029" }));
