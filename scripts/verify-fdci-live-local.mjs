// One public FDCI commission -> Node importer -> lightweight receiver -> ephemeral local D1.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { collectFdci, runFdciImport } from "./import-fdci.mjs";
import receiver from "../workers/fdci-receiver.mjs";

const require = createRequire(import.meta.url);
const { Miniflare } = require("../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare");
const [token, slug, commissionId] = process.argv.slice(2);
if (!token || !slug || !commissionId) throw new Error("Uso: node scripts/verify-fdci-live-local.mjs TOKEN SLUG COMMISSION_ID");

const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('local'); } }", d1Databases: ["DB"] });
try {
  const db = await mf.getD1Database("DB");
  await db.exec(`CREATE TABLE publications (
    id TEXT PRIMARY KEY, source TEXT NOT NULL, external_id TEXT NOT NULL, kind TEXT NOT NULL,
    category TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', level TEXT NOT NULL DEFAULT '',
    area TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', character TEXT NOT NULL DEFAULT '',
    circuit TEXT NOT NULL DEFAULT 'UNKNOWN', source_circuit_raw TEXT NOT NULL DEFAULT '',
    circuit_inference_source TEXT NOT NULL DEFAULT 'unknown', circuit_confidence INTEGER NOT NULL DEFAULT 0,
    starts_at TEXT, ends_at TEXT, status TEXT NOT NULL, official_url TEXT NOT NULL, metadata TEXT NOT NULL,
    content_hash TEXT NOT NULL, source_updated_at TEXT, registration_open_at TEXT,
    registration_close_at TEXT, expires_at TEXT, source_status TEXT NOT NULL, normalized_status TEXT NOT NULL,
    removed_at TEXT, last_seen_at TEXT NOT NULL DEFAULT '', last_changed_at TEXT NOT NULL DEFAULT '',
    first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  ); CREATE TABLE sync_state (source TEXT PRIMARY KEY, synced_at TEXT NOT NULL);`.replace(/\s+/g, " "));
  const selection = { token, slug, commissionId };
  const snapshot = await collectFdci(fetch, selection);
  assert.equal(snapshot.failures, 0);
  assert.equal(snapshot.items.length, 1);
  const secret = randomBytes(32).toString("hex");
  const endpoint = "https://receiver.local/api/internal/fdci-import";
  const fetcher = (input, init) => String(input) === endpoint
    ? receiver.fetch(new Request(endpoint, init), { DB: db, FDCI_IMPORT_SECRET: secret, FDCI_EXTERNAL_ENABLED: "true" })
    : fetch(input, init);
  const options = { endpoint, token: secret, selection, collect: async () => snapshot, fetcher };
  const first = await runFdciImport(options);
  const repeat = await runFdciImport(options);
  const row = await db.prepare("SELECT id, title, registration_open_at, registration_close_at, status, normalized_status, metadata, official_url FROM publications WHERE id=?")
    .bind(`fdci:commission:${commissionId}`).first();
  assert.equal(first.created, 1);
  assert.equal(repeat.unchanged, 1);
  assert.equal(row?.registration_open_at, snapshot.items[0].registrationOpenAt);
  assert.equal(row?.registration_close_at, snapshot.items[0].registrationCloseAt);
  assert.equal((await db.prepare("SELECT COUNT(*) AS total FROM publications").first())?.total, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS total FROM sync_state").first())?.total, 0);
  console.log(JSON.stringify({ database: "D1 local efímera", source: "FDCI oficial pública", id: row.id,
    title: row.title, registrationOpenAt: row.registration_open_at, registrationCloseAt: row.registration_close_at,
    status: row.status, normalizedStatus: row.normalized_status,
    availablePreCapacity: JSON.parse(row.metadata).availablePreCapacity, officialUrl: row.official_url,
    first, repeat }, null, 2));
} finally { await mf.dispose(); }
