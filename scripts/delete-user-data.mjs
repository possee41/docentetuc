// Operator-only tool. A public request/reference is never sufficient authorization.
// First verify ownership independently and record the support ticket outside this repo.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { userDataDeletionStatements } from "../lib/data-deletion.ts";

const args = new Set(process.argv.slice(2));
const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const reference = option("reference")?.toLowerCase();
const remote = args.has("--remote");
const local = args.has("--local");
const execute = args.has("--execute");
const verified = args.has("--verified");
const persistTo = option("persist-to");
if (!reference || !/^[0-9a-f]{20}$/.test(reference) || remote === local || (execute && (!verified || option("confirm") !== reference)) || (local && !persistTo)) {
  console.error("Uso: node --experimental-strip-types scripts/delete-user-data.mjs --reference=<20 hex> (--remote | --local --persist-to=<dir>) [--execute --verified --confirm=<misma referencia>]");
  process.exit(2);
}

const quoted = (value) => `'${String(value).replaceAll("'", "''")}'`;
const bind = (statement) => {
  let index = 0;
  const sql = statement.sql.replaceAll("?", () => quoted(statement.values[index++]));
  if (index !== statement.values.length) throw new Error("Cantidad de parámetros inválida");
  return sql;
};
const wrangler = ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "docentetuc-db", "--config=wrangler.cloudflare.jsonc", remote ? "--remote" : "--local", "--json"];
if (local) wrangler.push(`--persist-to=${persistTo}`);
const query = (sql) => {
  const result = spawnSync(process.execPath, [...wrangler, `--command=${sql}`], { encoding: "utf8", maxBuffer: 5_000_000 });
  if (result.status !== 0) throw new Error("Falló la consulta D1; ningún error mostrará identificadores personales. Revisá Wrangler localmente.");
  const response = JSON.parse(result.stdout);
  if (!Array.isArray(response) || response.some((entry) => !entry.success)) throw new Error("D1 no confirmó la consulta.");
  return response[0]?.results ?? [];
};

const profiles = query("SELECT user_id FROM profiles");
const matches = profiles.filter(({ user_id }) => createHash("sha256").update(String(user_id)).digest("hex").slice(0, 20) === reference);
if (matches.length !== 1) throw new Error(matches.length ? "Referencia ambigua; no se borró nada." : "Referencia no encontrada; no se borró nada.");
const userId = String(matches[0].user_id);
const statements = userDataDeletionStatements(userId);
const countFor = (statement) => Number(query(bind({ ...statement, sql: statement.sql.replace(/^DELETE FROM /, "SELECT COUNT(*) AS count FROM ") }))[0]?.count ?? 0);
const before = Object.fromEntries(statements.map((statement) => [statement.table, countFor(statement)]));
const publicBefore = Number(query("SELECT COUNT(*) AS count FROM publications")[0]?.count ?? 0);
console.log(JSON.stringify({ reference, scope: remote ? "remote" : "local", personalRows: before, publicRows: publicBefore, mode: execute ? "delete" : "dry-run" }, null, 2));
if (!execute) process.exit(0);

for (const statement of statements) query(bind(statement));
const after = Object.fromEntries(statements.map((statement) => [statement.table, countFor(statement)]));
const publicAfter = Number(query("SELECT COUNT(*) AS count FROM publications")[0]?.count ?? 0);
if (Object.values(after).some((count) => count !== 0) || publicAfter !== publicBefore) throw new Error("La verificación posterior falló. Revisá D1 antes de responder a la persona solicitante.");
console.log(JSON.stringify({ reference, deleted: true, personalRowsRemaining: after, publicRowsUnchanged: publicAfter }, null, 2));
