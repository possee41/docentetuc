// Isolated Workerd/D1 row accounting; setup writes are excluded from results.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { materializeNextPersistedNoticePage } from "./external-notifications.mjs";

const require = createRequire(import.meta.url);
const { Miniflare } = require("../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare");
const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('local'); } }", d1Databases: ["DB"] });
try {
  const db = await mf.getD1Database("DB");
  await db.prepare(`CREATE TABLE publications (id TEXT PRIMARY KEY,source TEXT NOT NULL,content_hash TEXT NOT NULL,
    removed_at TEXT,normalized_status TEXT,kind TEXT,category TEXT,title TEXT,summary TEXT,level TEXT,area TEXT,
    junta TEXT,location TEXT,shift TEXT,character TEXT,circuit TEXT,source_circuit_raw TEXT,metadata TEXT,
    ends_at TEXT,starts_at TEXT,source_updated_at TEXT)`).run();
  await db.prepare(`CREATE TABLE profiles (user_id TEXT PRIMARY KEY,notify_new_trainings INTEGER,training_notify_scope TEXT,
    level TEXT,area TEXT,subjects TEXT,junta TEXT,roles TEXT,department TEXT,locality TEXT,shifts TEXT,
    characters TEXT,circuits TEXT,personal_match_threshold INTEGER,wants_interim INTEGER,wants_substitute INTEGER,
    training_interests TEXT)`).run();
  await db.prepare(`CREATE TABLE notifications (id INTEGER PRIMARY KEY,user_id TEXT,publication_id TEXT,type TEXT,
    dedupe_key TEXT,scheduled_at TEXT,UNIQUE(user_id,dedupe_key))`).run();
  const blocks = readFileSync(new URL("../migrations/0025_external_publication_events.sql", import.meta.url), "utf8")
    .split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n").trim().split(/\n\s*\n/);
  for (const block of blocks) await db.prepare(block).run();

  const results = [];
  for (const count of [25, 100, 500]) {
    const existing = count === 25 ? 0 : count === 100 ? 25 : 100;
    const ids = Array.from({ length: count - existing }, (_, index) => `user-${String(existing + index).padStart(3, "0")}`);
    for (let offset = 0; offset < ids.length; offset += 50) {
      const page = ids.slice(offset, offset + 50);
      await db.prepare(`INSERT INTO profiles(user_id,notify_new_trainings,training_notify_scope) VALUES ${page.map(() => "(?,1,'all')").join(",")}`)
        .bind(...page).run();
    }
    const publicationId = `fdci:commission:synthetic-${count}`;
    await db.prepare(`INSERT INTO publications(id,source,content_hash,normalized_status,kind,category,title,metadata,circuit)
      VALUES(?,'Capacitación Docente',?,'ACTIVE','capacitacion','Capacitación','Curso sintético',?,'UNKNOWN')`)
      .bind(publicationId, String(count).padStart(64, "a"), JSON.stringify({ entity: "commission", availablePreCapacity: 5,
        registrationOpensAt: "2026-10-23T12:00:00Z" })).run();
    const metrics = { requests: 0, rowsRead: 0, rowsWritten: 0 };
    const measured = { prepare: (sql) => ({ bind: (...params) => {
      const statement = db.prepare(sql).bind(...params);
      const record = (result) => { metrics.requests++; metrics.rowsRead += Number(result.meta?.rows_read || 0);
        metrics.rowsWritten += Number(result.meta?.rows_written || 0); return result; };
      return { all: async () => record(await statement.all()), run: async () => record(await statement.run()),
        first: async () => (await record(await statement.all())).results[0] || null };
    } }) };
    let pages = 0;
    while (true) {
      const result = await materializeNextPersistedNoticePage(measured, { now: new Date("2026-10-22T12:00:00Z") });
      assert.ok(result.eventId !== null);
      pages++;
      if (!result.nextCursor) break;
    }
    const notices = await db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE publication_id=?").bind(publicationId).first();
    assert.equal(notices.n, count);
    results.push({ profiles: count, pages, ...metrics, notices: Number(notices.n) });
  }
  const sources = ["Capacitación Docente", "SIME", "Padrones y Comunicados", "CeNET / INET", "INFoD / AulaS-TIC"];
  const importMetrics = { requests: 0, rowsRead: 0, rowsWritten: 0 };
  const upsert = db.prepare(`INSERT INTO publications(id,source,content_hash,normalized_status,kind,category,title,metadata,circuit)
    VALUES(?,?,?,'ACTIVE',?,?,?,?,'UNKNOWN')
    ON CONFLICT(id) DO UPDATE SET content_hash=excluded.content_hash
    WHERE publications.content_hash<>excluded.content_hash`);
  const apply = async (index, version = 1) => {
    const source = sources[index], kind = index === 1 ? "vacante" : index === 2 ? "junta" : "capacitacion";
    const metadata = kind === "capacitacion" ? JSON.stringify({ entity: "commission", availablePreCapacity: 5,
      registrationOpensAt: "2026-10-23T12:00:00Z" }) : "{}";
    const result = await upsert.bind(`synthetic:cycle:${index}`, source, `${index}${version}`.padStart(64, "a"), kind,
      kind === "junta" ? "Comunicados" : kind === "vacante" ? "Vacante" : "Capacitación",
      `Publicación sintética ${index}`, metadata).run();
    importMetrics.requests++;
    importMetrics.rowsRead += Number(result.meta?.rows_read || 0);
    importMetrics.rowsWritten += Number(result.meta?.rows_written || 0);
  };
  const started = performance.now();
  for (let index = 0; index < sources.length; index++) await apply(index);
  const firstWrites = importMetrics.rowsWritten;
  for (let index = 0; index < sources.length; index++) await apply(index);
  assert.equal(importMetrics.rowsWritten, firstWrites, "repetir un ciclo sin cambios no escribe");
  await apply(0, 2);
  const eventMetrics = { requests: 0, rowsRead: 0, rowsWritten: 0 };
  const measured = { prepare: (sql) => ({ bind: (...params) => {
    const statement = db.prepare(sql).bind(...params);
    const record = (result) => { eventMetrics.requests++; eventMetrics.rowsRead += Number(result.meta?.rows_read || 0);
      eventMetrics.rowsWritten += Number(result.meta?.rows_written || 0); return result; };
    return { all: async () => record(await statement.all()), run: async () => record(await statement.run()),
      first: async () => (await record(await statement.all())).results[0] || null };
  } }) };
  let steps = 0;
  while (true) {
    const step = await materializeNextPersistedNoticePage(measured, { now: new Date("2026-10-22T12:00:00Z") });
    if (step.eventId === null) break;
    steps++;
    if (steps > 120) throw new Error("MIXED_CYCLE_NOT_BOUNDED");
  }
  const total = await db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE publication_id LIKE 'synthetic:cycle:%'").first();
  const pending = await db.prepare("SELECT COUNT(*) AS n FROM external_publication_events WHERE status='pending'").first();
  assert.equal(pending.n, 0);
  const mixed = { sources: sources.length, profiles: 500, cycles: 3, firstWrites,
    repeatWrites: 0, updateWrites: importMetrics.rowsWritten - firstWrites, importMetrics,
    eventMetrics, eventSteps: steps, notifications: Number(total.n), wallMs: Math.round(performance.now() - started) };
  console.log(JSON.stringify({ database: "D1 efímera Workerd", unit: "un evento y perfiles sintéticos", results,
    mixedSyntheticCycle: mixed }));
} finally { await mf.dispose(); }
