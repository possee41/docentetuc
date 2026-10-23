// Read-only public source → Node parser → isolated Workerd D1 → app query.
// Exactly one verified publication is persisted locally; no remote D1 or secrets.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { APP_PUBLICATIONS_QUERY } from "../lib/app-publications-query.ts";
import { collectSimePublications } from "../lib/sime-collector.ts";
import { prepareSimeImport } from "../lib/sime-import.ts";
import { collectJuntaExternal } from "../lib/junta-external.ts";
import { JUNTA_EXTERNAL_SOURCES } from "../lib/junta-external-sources.ts";
import { isCenetMarkupRecognized, parseCenetTrainings, parseInfdCatalog, parseInfdTrainings } from "../lib/external-trainings.ts";
import { prepareJuntaImport, prepareTrainingImport } from "../lib/public-source-import.ts";
import simeReceiver from "../workers/sime-receiver.mjs";
import publicReceiver from "../workers/public-source-receiver.mjs";

const source = process.argv[2];
if (!["sime", "juntas", "cenet", "infd"].includes(source)) throw new Error("SOURCE_REQUIRED");
const require = createRequire(import.meta.url);
const { Miniflare } = require("../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare");
const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('local'); } }", d1Databases: ["DB"] });
let sourceRequests = 0;
const boundedFetch = async (input, init) => {
  if (++sourceRequests > 8) throw new Error("SOURCE_REQUEST_LIMIT");
  const response = await fetch(input, init);
  if (!response.ok) throw new Error(`SOURCE_HTTP_${response.status}`);
  return response;
};
const text = async (url) => {
  const result = await boundedFetch(url, { signal: AbortSignal.timeout(20_000) });
  const body = await result.text();
  if (body.length > 1_000_000) throw new Error("SOURCE_PAGE_TOO_LARGE");
  return body;
};

try {
  const db = await mf.getD1Database("DB");
  await db.exec(`CREATE TABLE publications (
    id TEXT PRIMARY KEY,source TEXT NOT NULL,external_id TEXT NOT NULL,kind TEXT NOT NULL,category TEXT NOT NULL,
    title TEXT NOT NULL,summary TEXT NOT NULL DEFAULT '',level TEXT NOT NULL DEFAULT '',area TEXT NOT NULL DEFAULT '',
    junta TEXT NOT NULL DEFAULT '',location TEXT NOT NULL DEFAULT '',shift TEXT NOT NULL DEFAULT '',character TEXT NOT NULL DEFAULT '',
    starts_at TEXT,ends_at TEXT,status TEXT NOT NULL,official_url TEXT NOT NULL,metadata TEXT NOT NULL,content_hash TEXT NOT NULL,
    source_updated_at TEXT,source_published_at TEXT,registration_open_at TEXT,registration_close_at TEXT,expires_at TEXT,
    source_status TEXT NOT NULL DEFAULT 'UNKNOWN',normalized_status TEXT NOT NULL DEFAULT 'UNKNOWN',removed_at TEXT,
    last_seen_at TEXT NOT NULL DEFAULT '',last_changed_at TEXT NOT NULL DEFAULT '',first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  const now = new Date();
  let row;
  if (source === "sime") {
    const collected = await collectSimePublications(new Map(), boundedFetch, now, [1]);
    if (!collected.complete || !collected.items.length) throw new Error("SIME_NO_VERIFIED_ITEM");
    row = await prepareSimeImport(collected.items[0], now);
  } else if (source === "juntas") {
    let notice;
    await collectJuntaExternal({ fetcher: boundedFetch, sources: [JUNTA_EXTERNAL_SOURCES[0]],
      onItems: async (items) => { notice ||= items.find((item) => item.id.startsWith("notice:")); } });
    if (!notice) throw new Error("JUNTAS_NO_VERIFIED_NOTICE");
    row = await prepareJuntaImport(notice, now);
  } else if (source === "cenet") {
    const html = await text("https://cenet.inet.edu.ar/mod/page/view.php?id=30493");
    if (!isCenetMarkupRecognized(html)) throw new Error("CENET_FORMAT_CHANGED");
    const item = parseCenetTrainings(html, now)[0];
    if (!item) throw new Error("CENET_NO_VERIFIED_ITEM");
    row = await prepareTrainingImport(item, "CeNET / INET", now);
  } else {
    const html = await text("https://red.infd.edu.ar/cursos-nacionales-2/");
    const catalog = parseInfdCatalog(html, now);
    for (const page of catalog.pages.slice(0, 3)) {
      const item = parseInfdTrainings(await text(page), page, catalog, now)[0];
      if (item) { row = await prepareTrainingImport(item, "INFoD / AulaS-TIC", now); break; }
    }
    if (!row) throw new Error("INFD_NO_VERIFIED_ITEM_IN_FIRST_THREE_PAGES");
  }
  const secret = randomBytes(32).toString("hex"), receiver = source === "sime" ? simeReceiver : publicReceiver;
  const pathname = source === "sime" ? "/api/internal/sime-import" : `/api/internal/public-source-import/${source}`;
  const env = { DB: db, SIME_IMPORT_SECRET: secret, JUNTAS_IMPORT_SECRET: secret,
    CENET_IMPORT_SECRET: secret, INFD_IMPORT_SECRET: secret };
  const apply = async () => {
    const response = await receiver.fetch(new Request(`https://local.invalid${pathname}`, { method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "batch", items: [row] }) }), env);
    if (!response.ok) throw new Error(`LOCAL_RECEIVER_${response.status}`);
    return response.json();
  };
  const first = await apply(), repeated = await apply();
  assert.equal(first.created, 1);
  assert.equal(repeated.unchanged, 1);
  assert.equal(repeated.rowsWritten, 0);
  const visible = (await db.prepare(APP_PUBLICATIONS_QUERY).all()).results.find((item) => item.id === row.id);
  assert.ok(visible);
  assert.equal(visible.title, row.title);
  assert.equal(visible.official_url, row.officialUrl);
  assert.equal(visible.registration_open_at, row.registrationOpenAt);
  assert.equal(visible.registration_close_at, row.registrationCloseAt);
  console.log(JSON.stringify({ source, officialTitle: row.title, officialUrl: row.officialUrl,
    registrationOpenAt: row.registrationOpenAt, registrationCloseAt: row.registrationCloseAt,
    normalizedStatus: row.normalizedStatus, sourceRequests, first, repeated,
    visibleInPublicAppQuery: true, database: "D1 efímera Workerd" }));
} finally { await mf.dispose(); }
