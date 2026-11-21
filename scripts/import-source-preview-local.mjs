// Populate only the isolated 1.2 preview already used for visual review.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { runDirectD1Import } from "./import-direct-d1.mjs";

const source = process.argv[2];
if (!["fdci", "sime", "cenet", "infd"].includes(source)) throw new Error("PREVIEW_SOURCE_INVALID");
const directory = fileURLToPath(new URL("../.wrangler/review-1.2/v3/d1/miniflare-D1DatabaseObject/", import.meta.url));
const files = readdirSync(directory).filter((file) => file.endsWith(".sqlite") && file !== "metadata.sqlite");
if (files.length !== 1) throw new Error("PREVIEW_D1_NOT_FOUND");
const raw = new DatabaseSync(join(directory, files[0]));
raw.exec("PRAGMA foreign_keys=ON");
const db = { prepare(sql) { return { bind(...values) {
  const stmt = raw.prepare(sql);
  return { all: async () => ({ results: stmt.all(...values) }), first: async () => stmt.get(...values) ?? null,
    run: async () => ({ meta: { rows_written: Number(stmt.run(...values).changes) } }),
    runSync: () => ({ meta: { rows_written: Number(stmt.run(...values).changes) } }) };
} }; }, async batch(statements) {
  raw.exec("BEGIN IMMEDIATE");
  try { const result = statements.map((statement) => statement.runSync()); raw.exec("COMMIT"); return result; }
  catch (error) { raw.exec("ROLLBACK"); throw error; }
} };

try {
  const result = await runDirectD1Import({ source, db, scope: source === "fdci" ? "active" : "single" });
  console.log(JSON.stringify({ database: "isolated preview", source, discovered: result.discovered,
    created: result.created, updated: result.updated, unchanged: result.unchanged }));
} finally { raw.close(); }
