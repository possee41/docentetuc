// Local tests/profiling only. No credentials, URLs or Cloudflare API access.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

export const fdciFixtureMigrations = ["drizzle/0000_docentetuc.sql", "drizzle/0001_training_metadata.sql",
  "drizzle/0002_reminders_ai.sql", "drizzle/0003_web_push.sql", "migrations/0008_personal_matching_circuits.sql",
  "migrations/0009_reliability_lifecycle.sql", "migrations/0029_import_gateway_identity.sql",
  "migrations/0031_import_gate_lease.sql", "migrations/0032_fdci_import_checkpoint.sql"];
export const fdciFixtureSql = () => fdciFixtureMigrations.map(file => readFileSync(file, "utf8"));

export function fdciLocalFixture() {
  const sqlite = new DatabaseSync(":memory:");
  for (const sql of fdciFixtureSql()) sqlite.exec(sql);
  const prepare = sql => {
    let args = [];
    const statement = sqlite.prepare(sql);
    return {
      bind(...values) { args = values; return this; },
      async first() { return statement.get(...args) ?? null; },
      async all() {
        const results = statement.all(...args);
        return { results, meta: { rows_read: results.length, rows_written: 0 } };
      },
      async run() {
        // D1 batch returns SELECT rows as well as mutation metadata.
        if (statement.columns().length) {
          const results = statement.all(...args);
          return { results, meta: { changes: 0, rows_written: 0, rows_read: results.length } };
        }
        const result = statement.run(...args); return { meta: { changes: Number(result.changes), rows_written: Number(result.changes), rows_read: 0 } };
      },
    };
  };
  const db = { prepare, async batch(statements) {
    sqlite.exec("BEGIN");
    try { const result = []; for (const s of statements) result.push(await s.run()); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  return { sqlite, db };
}
