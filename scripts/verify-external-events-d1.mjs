// Ephemeral Workerd/D1 only. No account, token, remote binding or source request.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Miniflare } = require("../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare");
const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('local'); } }", d1Databases: ["DB"] });
try {
  const db = await mf.getD1Database("DB");
  await db.exec("CREATE TABLE publications(id TEXT PRIMARY KEY,source TEXT NOT NULL,content_hash TEXT NOT NULL,removed_at TEXT)");
  const migration = readFileSync(new URL("../migrations/0025_external_publication_events.sql", import.meta.url), "utf8")
    .split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n");
  await db.exec(migration);
  await db.prepare("INSERT INTO publications(id,source,content_hash) VALUES(?,?,?)")
    .bind("sime:1", "SIME", "a".repeat(64)).run();
  await db.prepare("UPDATE publications SET content_hash=? WHERE id=?").bind("a".repeat(64), "sime:1").run();
  await db.prepare("UPDATE publications SET content_hash=? WHERE id=?").bind("b".repeat(64), "sime:1").run();
  const rows = await db.prepare("SELECT change,content_hash FROM external_publication_events ORDER BY id").all();
  assert.deepEqual(rows.results.map((row) => row.change), ["created", "updated"]);
  console.log(JSON.stringify({ database: "D1 efímera Workerd", migration: "0025", events: rows.results.length,
    atomicTrigger: true, duplicateOnUnchanged: false }));
} finally { await mf.dispose(); }
