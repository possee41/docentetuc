// Read-only public source → Node parser → isolated Workerd D1 → app query.
// Exactly one verified publication is persisted locally; no remote D1 or secrets.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { APP_PUBLICATIONS_QUERY } from "../lib/app-publications-query.ts";
import { collectFdci } from "./import-fdci.mjs";
import { collectSimePublications } from "../lib/sime-collector.ts";
import { prepareSimeImport } from "../lib/sime-import.ts";
import { collectJuntaExternal } from "../lib/junta-external.ts";
import { JUNTA_EXTERNAL_SOURCES } from "../lib/junta-external-sources.ts";
import { isCenetMarkupRecognized, parseCenetTrainings, parseInfdCatalog, parseInfdTrainings } from "../lib/external-trainings.ts";
import { prepareJuntaImport, prepareTrainingImport } from "../lib/public-source-import.ts";
import simeReceiver from "../workers/sime-receiver.mjs";
import publicReceiver from "../workers/public-source-receiver.mjs";
import fdciReceiver from "../workers/fdci-receiver.mjs";
import { materializeNextPersistedNoticePage } from "./external-notifications.mjs";

const source = process.argv[2];
const cycles = process.argv.includes("--cycles");
if (!["fdci", "sime", "juntas", "cenet", "infd"].includes(source)) throw new Error("SOURCE_REQUIRED");
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
  await db.prepare(`CREATE TABLE publications (
    id TEXT PRIMARY KEY,source TEXT NOT NULL,external_id TEXT NOT NULL,kind TEXT NOT NULL,category TEXT NOT NULL,
    title TEXT NOT NULL,summary TEXT NOT NULL DEFAULT '',level TEXT NOT NULL DEFAULT '',area TEXT NOT NULL DEFAULT '',
    junta TEXT NOT NULL DEFAULT '',location TEXT NOT NULL DEFAULT '',shift TEXT NOT NULL DEFAULT '',character TEXT NOT NULL DEFAULT '',
    circuit TEXT NOT NULL DEFAULT 'UNKNOWN',source_circuit_raw TEXT NOT NULL DEFAULT '',
    circuit_inference_source TEXT NOT NULL DEFAULT 'unknown',circuit_confidence INTEGER NOT NULL DEFAULT 0,
    starts_at TEXT,ends_at TEXT,status TEXT NOT NULL,official_url TEXT NOT NULL,metadata TEXT NOT NULL,content_hash TEXT NOT NULL,
    source_updated_at TEXT,source_published_at TEXT,registration_open_at TEXT,registration_close_at TEXT,expires_at TEXT,
    source_status TEXT NOT NULL DEFAULT 'UNKNOWN',normalized_status TEXT NOT NULL DEFAULT 'UNKNOWN',removed_at TEXT,
    last_seen_at TEXT NOT NULL DEFAULT '',last_changed_at TEXT NOT NULL DEFAULT '',first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
  if (cycles) {
    await db.prepare(`CREATE TABLE sync_state (source TEXT PRIMARY KEY,last_successful_sync_at TEXT,sync_status TEXT)`).run();
    await db.prepare("INSERT INTO sync_state(source,last_successful_sync_at,sync_status) VALUES(?,?,'OK')")
      .bind(source, "2026-10-01T00:00:00Z").run();
    await db.prepare(`CREATE TABLE profiles (user_id TEXT PRIMARY KEY,notify_new_trainings INTEGER,
      training_notify_scope TEXT,level TEXT,area TEXT,subjects TEXT,junta TEXT,roles TEXT,department TEXT,
      locality TEXT,shifts TEXT,characters TEXT,circuits TEXT,personal_match_threshold INTEGER,
      wants_interim INTEGER,wants_substitute INTEGER,training_interests TEXT)`).run();
    await db.prepare(`CREATE TABLE notifications (id INTEGER PRIMARY KEY,user_id TEXT,publication_id TEXT,
      type TEXT,dedupe_key TEXT,scheduled_at TEXT,UNIQUE(user_id,dedupe_key))`).run();
    const statements = readFileSync(new URL("../migrations/0025_external_publication_events.sql", import.meta.url), "utf8")
      .split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n").trim().split(/\n\s*\n/);
    for (const statement of statements) await db.prepare(statement).run();
    await db.prepare("INSERT INTO profiles(user_id,notify_new_trainings,training_notify_scope) VALUES('test-teacher',1,'all')").run();
  }
  const now = new Date();
  let row;
  if (source === "fdci") {
    const api = "https://apicapacitaciones.educaciontuc.edu.ar/api";
    const active = await (await boundedFetch(`${api}/gestionCapas/getCapaActivas`)).json();
    const courses = await (await boundedFetch(`${api}/gestionCapas/getRestoCapas`)).json();
    if (!Array.isArray(active) || !Array.isArray(courses)) throw new Error("FDCI_FORMAT_CHANGED");
    const item = active.find((commission) => courses.some((course) =>
      String(course.capacitacion_id) === String(commission.capacitacion_id) && course.token && course.slug));
    const course = courses.find((candidate) => String(candidate.capacitacion_id) === String(item?.capacitacion_id));
    if (!item || !course) throw new Error("FDCI_NO_VERIFIED_ACTIVE_COMMISSION");
    const selection = { token: course.token, slug: course.slug, commissionId: String(item.id) };
    const cachedFetch = (input, init) => String(input).endsWith("/getCapaActivas") ? Response.json(active) :
      String(input).endsWith("/getRestoCapas") ? Response.json(courses) : boundedFetch(input, init);
    const collected = await collectFdci(cachedFetch, selection);
    if (collected.failures || collected.items.length !== 1) throw new Error("FDCI_COMMISSION_INCOMPLETE");
    row = collected.items[0];
  } else if (source === "sime") {
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
  const secret = randomBytes(32).toString("hex"), receiver = source === "fdci" ? fdciReceiver : source === "sime" ? simeReceiver : publicReceiver;
  const pathname = source === "fdci" ? "/api/internal/fdci-import" : source === "sime" ? "/api/internal/sime-import" : `/api/internal/public-source-import/${source}`;
  const env = { DB: db, SIME_IMPORT_SECRET: secret, JUNTAS_IMPORT_SECRET: secret,
    CENET_IMPORT_SECRET: secret, INFD_IMPORT_SECRET: secret, FDCI_IMPORT_SECRET: secret, FDCI_EXTERNAL_ENABLED: "true" };
  const apply = async (item = row, database = db) => {
    const response = await receiver.fetch(new Request(`https://local.invalid${pathname}`, { method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "batch", items: [item] }) }), { ...env, DB: database });
    if (!response.ok) throw new Error(`LOCAL_RECEIVER_${response.status}`);
    return response.json();
  };
  if (cycles) {
    await assert.rejects(apply(row, { prepare: (...args) => db.prepare(...args),
      batch: async () => { throw new Error("D1_FAILURE_INJECTED"); } }),
      /LOCAL_RECEIVER_503/);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM publications").first()).n, 0);
  }
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
  let cycleResult;
  if (cycles) {
    const changed = { ...row, title: `${row.title} (cambio simulado)`,
      contentHash: createHash("sha256").update(`${row.contentHash}:simulated-change`).digest("hex") };
    const updated = await apply(changed), replay = await apply(changed);
    assert.equal(updated.updated, 1);
    assert.equal(replay.unchanged, 1);
    assert.equal(replay.rowsWritten, 0);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM publications").first()).n, 1);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM external_publication_events").first()).n, 2);
    const metrics = { requests: 0, rowsRead: 0, rowsWritten: 0 };
    const measured = { prepare: (sql) => ({ bind: (...params) => {
      const statement = db.prepare(sql).bind(...params);
      const record = (result) => { metrics.requests++; metrics.rowsRead += Number(result.meta?.rows_read || 0);
        metrics.rowsWritten += Number(result.meta?.rows_written || 0); return result; };
      return { all: async () => record(await statement.all()), run: async () => record(await statement.run()),
        first: async () => (await record(await statement.all())).results[0] || null };
    } }) };
    const eventSteps = [];
    while (true) {
      const step = await materializeNextPersistedNoticePage(measured);
      if (step.eventId === null) break;
      eventSteps.push(step);
      if (eventSteps.length > 3) throw new Error("EVENT_CYCLE_NOT_BOUNDED");
    }
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM external_publication_events WHERE status='pending'").first()).n, 0);
    const notifications = Number((await db.prepare("SELECT COUNT(*) AS n FROM notifications").first()).n);
    assert.ok(notifications <= 1);
    const health = await db.prepare("SELECT last_successful_sync_at FROM sync_state WHERE source=?").bind(source).first();
    assert.equal(health.last_successful_sync_at, "2026-10-01T00:00:00Z",
      "una muestra puntual no acredita un barrido completo de la fuente");
    cycleResult = { injectedD1FailurePreservedRows: true, update: updated, replay,
      eventSteps, eventMetrics: metrics, notifications, syntheticUpdate: true,
      lastSuccessUnchangedByPartialSample: true };
  }
  console.log(JSON.stringify({ source, officialTitle: row.title, officialUrl: row.officialUrl,
    registrationOpenAt: row.registrationOpenAt, registrationCloseAt: row.registrationCloseAt,
    normalizedStatus: row.normalizedStatus, sourceRequests, first, repeated,
    visibleInPublicAppQuery: true, database: "D1 efímera Workerd", cycles: cycleResult }));
} finally { await mf.dispose(); }
