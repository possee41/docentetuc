import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { runJuntasCheckpoint } from "./import-juntas-checkpoint.mjs";
import { boardItems } from "../lib/board-view.ts";
import { listDrivePage } from "../lib/junta-external.ts";

const root = ["pad-test", "Padrones", "Inicial y Primaria",
  "https://drive.google.com/drive/folders/123456789012345678901234567890?resourcekey=0-synthetic"];
const callRoot = ["abiertos-test", "Llamados abiertos", "Secundaria",
  "https://drive.google.com/drive/folders/234567890123456789012345678901"];
const docRoot = ["com-test", "Comunicados", "Inicial y Primaria",
  "https://docs.google.com/document/d/345678901234567890123456789012/edit"];
const key = "synthetic_drive_key_1234567890";
const now = new Date("2026-10-25T12:00:00Z");

function isolatedD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE publications (
    id TEXT PRIMARY KEY, source TEXT NOT NULL, external_id TEXT NOT NULL, kind TEXT NOT NULL,
    category TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', level TEXT NOT NULL DEFAULT '',
    area TEXT NOT NULL DEFAULT '', junta TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '',
    shift TEXT NOT NULL DEFAULT '', character TEXT NOT NULL DEFAULT '', starts_at TEXT, ends_at TEXT,
    status TEXT NOT NULL, official_url TEXT NOT NULL, metadata TEXT NOT NULL, content_hash TEXT NOT NULL,
    source_updated_at TEXT, source_published_at TEXT, registration_open_at TEXT, registration_close_at TEXT,
    expires_at TEXT, source_status TEXT NOT NULL DEFAULT 'UNKNOWN', normalized_status TEXT NOT NULL DEFAULT 'UNKNOWN',
    removed_at TEXT, last_seen_at TEXT NOT NULL DEFAULT '', last_changed_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE sync_state(source TEXT PRIMARY KEY,synced_at TEXT NOT NULL DEFAULT '',item_count INTEGER NOT NULL DEFAULT 0,
      sync_status TEXT NOT NULL DEFAULT 'UNKNOWN',last_attempt_at TEXT,last_successful_sync_at TEXT,error_code TEXT);`);
  sqlite.exec(readFileSync(new URL("../migrations/0026_juntas_incremental.sql", import.meta.url), "utf8"));
  const metrics = { queries: 0, rowsRead: 0, rowsWritten: 0 };
  let writesUntilFailure = 0;
  const prepare = (sql) => ({ bind: (...values) => ({
    all: async () => { metrics.queries++; const results = sqlite.prepare(sql).all(...values);
      metrics.rowsRead += results.length; return { results, meta: { rows_read: results.length } }; },
    first: async () => { metrics.queries++; const row = sqlite.prepare(sql).get(...values) || null;
      metrics.rowsRead += Number(Boolean(row)); return row; },
    run: async () => { if (writesUntilFailure && sql.includes("INSERT INTO publications") && --writesUntilFailure === 0) throw new Error("D1_SYNTHETIC_FAILURE");
      metrics.queries++; const result = sqlite.prepare(sql).run(...values);
      metrics.rowsWritten += Number(result.changes); return { meta: { changes: Number(result.changes), rows_written: Number(result.changes) } }; },
  }) });
  const db = { prepare, metrics: () => ({ ...metrics }), batch: async (statements) => {
    sqlite.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec("COMMIT"); return results; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  return { sqlite, db, failOnPublicationWrite: (n) => { writesUntilFailure = n; } };
}

function driveFixture(filesByFolder, { failFolder = "", failDocument = "", pages = [] } = {}) {
  const calls = { drive: 0, document: 0 };
  const fetcher = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "docs.google.com") {
      calls.document++;
      if (failDocument && url.pathname.includes(failDocument)) throw new DOMException("timed out", "TimeoutError");
      return new Response(`COMUNICADO\n24/10/2026\nACTO DE DESIGNACIÓN\nFECHA DE DESIGNACIÓN: 27/10/2026 09:00\nLUGAR: Escuela Central`);
    }
    calls.drive++;
    assert.equal(new Headers(init?.headers).get("x-goog-api-key"), key);
    const folder = url.searchParams.get("q")?.match(/'([^']+)'/)?.[1];
    if (folder === failFolder) return Response.json({ error: "unavailable" }, { status: 503 });
    const entries = (filesByFolder.get(folder) || []).filter((item) =>
      !url.searchParams.get("q")?.includes("mimeType !=") || item.mimeType !== "application/vnd.google-apps.folder");
    const token = Number(url.searchParams.get("pageToken") || 0);
    pages.push({ folder, token });
    return Response.json({ files: entries.slice(token, token + 25),
      ...(token + 25 < entries.length ? { nextPageToken: String(token + 25) } : {}) });
  };
  return { calls, fetcher };
}
const file = (index, modifiedTime = "2026-10-24T10:00:00Z") => ({ id: `file_${String(index).padStart(8, "0")}`,
  name: `Padrón ${index}`, mimeType: "application/pdf", modifiedTime });
async function untilComplete(db, options, maximum = 300) {
  let last;
  const totals = { runs: 0, sourceRequests: 0, filesExamined: 0, created: 0, updated: 0, skippedUnchanged: 0,
    d1Queries: 0, d1RowsRead: 0, d1RowsWritten: 0, publicationRowsWritten: 0 };
  for (let n = 0; n < maximum; n++) {
    last = await runJuntasCheckpoint({ db, driveKey: key, now, ...options });
    totals.runs++; totals.sourceRequests += last.sourceRequests; totals.filesExamined += last.filesExamined;
    totals.created += last.created;
    totals.updated += last.updated; totals.skippedUnchanged += last.skippedUnchanged;
    totals.d1Queries += last.d1.queries; totals.d1RowsRead += last.d1.rowsRead;
    totals.d1RowsWritten += last.d1.rowsWritten; totals.publicationRowsWritten += last.rowsWritten;
    if (last.health.length === options.sources.length && last.health.every((item) => item.status === "OK"))
      return { ...last, totals };
  }
  throw new Error(`JUNTAS_SYNTHETIC_CYCLE_INCOMPLETE ${JSON.stringify(last?.categoryHealth)}`);
}

test("4.067 documents survive bounded first crawl, repeated maintenance and one changed file", async (t) => {
  const h = isolatedD1();
  const folder = "123456789012345678901234567890";
  const files = Array.from({ length: 4067 }, (_, index) => file(index));
  const fixture = driveFixture(new Map([[folder, files]]));
  const options = { sources: [root], sourceFetch: fixture.fetcher, maxRequests: 8,
    maxPublicationWrites: 20, maxSteps: 40 };
  const first = await untilComplete(h.db, options);
  assert.equal(h.sqlite.prepare("SELECT count(*) AS n FROM publications").get().n, 4067);
  assert.ok(first.totals.filesExamined >= 4067);
  assert.equal(h.sqlite.prepare("SELECT sync_status FROM sync_state WHERE source='Padrones'").get().sync_status, "OK");
  const firstRequests = fixture.calls.drive;
  assert.ok(firstRequests >= Math.ceil(4067 / 25));
  const idle = await runJuntasCheckpoint({ db: h.db, driveKey: key, now, ...options });
  assert.equal(idle.d1.rowsWritten, 0);
  assert.equal(idle.sourceRequests, 0);
  const later = new Date(now.getTime() + 25 * 60 * 60 * 1000);
  const unchanged = await untilComplete(h.db, { ...options, now: later });
  assert.equal(unchanged.totals.publicationRowsWritten, 0);
  assert.equal(unchanged.totals.skippedUnchanged, 4067);
  assert.equal(h.sqlite.prepare("SELECT count(*) AS n FROM publications").get().n, 4067);
  const before = h.sqlite.prepare("SELECT content_hash FROM publications WHERE id='drive:pad-test:file_00000001'").get().content_hash;
  files[1] = file(1, "2026-10-26T10:00:00Z");
  files.push(file(4067));
  const changed = await untilComplete(h.db, { ...options, now: new Date(later.getTime() + 25 * 60 * 60 * 1000) });
  assert.equal(h.sqlite.prepare("SELECT count(*) AS n FROM publications").get().n, 4068);
  assert.notEqual(h.sqlite.prepare("SELECT content_hash FROM publications WHERE id='drive:pad-test:file_00000001'").get().content_hash, before);
  assert.equal(h.sqlite.prepare("SELECT count(*) AS n FROM publications WHERE removed_at IS NOT NULL").get().n, 0);
  t.diagnostic(JSON.stringify({ first: first.totals, unchanged: unchanged.totals, changed: changed.totals }));
  h.sqlite.close();
});

test("abiertos-primaria resumes a five-request, ten-attempt probe without false current calls", async () => {
  const h = isolatedD1();
  const folder = "234567890123456789012345678901";
  const files = Array.from({ length: 30 }, (_, index) => ({ ...file(index), name: `Convocatoria ${index}` }));
  const fixture = driveFixture(new Map([[folder, files]]));
  const options = { db: h.db, driveKey: key, now, sourceFetch: fixture.fetcher, sources: [callRoot],
    maxRequests: 5, maxPublicationWrites: 10 };
  const first = await runJuntasCheckpoint(options);
  const saved = JSON.parse(h.sqlite.prepare("SELECT state_json FROM juntas_import_checkpoint WHERE root_id='abiertos-test'").get().state_json);
  assert.equal(first.created, 10);
  assert.ok(first.sourceRequests <= 5);
  assert.equal(saved.page.index, 10);
  assert.equal(h.sqlite.prepare("SELECT status FROM juntas_import_checkpoint WHERE root_id='abiertos-test'").get().status, "PARTIAL");
  const second = await runJuntasCheckpoint(options);
  assert.equal(second.created, 10);
  assert.ok(second.sourceRequests <= 5);
  const rows = h.sqlite.prepare(`SELECT id,kind,category,metadata,starts_at,ends_at,updated_at,
    source_published_at,removed_at,normalized_status FROM publications`).all();
  assert.equal(rows.length, 20);
  assert.equal(new Set(rows.map((row) => row.id)).size, 20);
  assert.equal(boardItems(rows, "llamados", now).length, 0);
  h.sqlite.close();
});

test("a focal folder moves ahead without losing the saved queue", async (t) => {
  const h = isolatedD1();
  const firstFolder = "folder_first_1234567890", targetFolder = "folder_target_1234567890";
  const children = Array.from({ length: 25 }, (_, index) => ({ id: `child_${String(index).padStart(10, "0")}`,
    name: `Subcarpeta ${index}`, mimeType: "application/vnd.google-apps.folder" }));
  const fixture = driveFixture(new Map([
    ["234567890123456789012345678901", [firstFolder, targetFolder].map((id) =>
      ({ id, name: id, mimeType: "application/vnd.google-apps.folder" }))],
    [firstFolder, [file(1)]], [targetFolder, [...children, file(2)]],
  ]));
  const options = { db: h.db, driveKey: key, now, sourceFetch: fixture.fetcher,
    sources: [callRoot], maxRequests: 1, maxPublicationWrites: 10, maxSteps: 1 };
  await runJuntasCheckpoint(options);
  const before = JSON.parse(h.sqlite.prepare("SELECT state_json FROM juntas_import_checkpoint WHERE root_id='abiertos-test'").get().state_json);
  assert.deepEqual(before.queue.map((entry) => entry.id), [firstFolder, targetFolder]);
  const filtered = await listDrivePage(targetFolder, key, undefined, "", fixture.fetcher, true);
  assert.deepEqual(filtered.files.map((item) => item.id), ["file_00000002"]);
  const focused = await runJuntasCheckpoint({ ...options, focusFolderId: targetFolder, focusFilesOnly: true });
  assert.equal(focused.created, 1);
  assert.ok(focused.d1.rowsWritten - focused.rowsWritten <= 8, "bounded lease/checkpoint control writes");
  t.diagnostic(JSON.stringify({ focalD1: focused.d1,
    publicationRowsWritten: focused.rowsWritten,
    controlRowsWritten: focused.d1.rowsWritten - focused.rowsWritten }));
  const after = JSON.parse(h.sqlite.prepare("SELECT state_json FROM juntas_import_checkpoint WHERE root_id='abiertos-test'").get().state_json);
  assert.deepEqual(after.queue.map((entry) => entry.id), [targetFolder, firstFolder], "filtered page must not mark folder complete");
  assert.ok(!after.visited.includes(targetFolder));
  await runJuntasCheckpoint(options); // Unfiltered first page contains only folders.
  await runJuntasCheckpoint(options); // The later page contains the already imported file.
  await runJuntasCheckpoint(options); // Continue with the other pending folder.
  assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS n FROM publications").get().n, 2);
  h.sqlite.close();
});

test("interruption, D1 failure and inaccessible Comunicado keep progress; other roots continue", async () => {
  const h = isolatedD1();
  const folder = "123456789012345678901234567890";
  const callFolder = "234567890123456789012345678901";
  const files = new Map([[folder, [file(1), file(2), file(3)]], [callFolder, [file(4)]]]);
  const fixture = driveFixture(files, { failDocument: "345678901234567890123456789012" });
  const options = { db: h.db, driveKey: key, now, sourceFetch: fixture.fetcher,
    sources: [docRoot, root, callRoot], maxRequests: 5, maxPublicationWrites: 2, maxSteps: 20 };
  h.failOnPublicationWrite(2);
  await assert.rejects(runJuntasCheckpoint(options), /JUNTAS_RECEIVER_HTTP_503/);
  assert.equal(h.sqlite.prepare("SELECT count(*) AS n FROM publications WHERE id LIKE 'drive:pad-test:%'").get().n, 1,
    "one item was committed before the next D1 write failed");
  const saved = h.sqlite.prepare("SELECT state_json FROM juntas_import_checkpoint WHERE root_id='pad-test'").get();
  assert.ok(saved, "page remains checkpointed after a failed publication write");
  for (let n = 0; n < 8; n++) await runJuntasCheckpoint(options);
  assert.equal(h.sqlite.prepare("SELECT count(*) AS n FROM publications WHERE id LIKE 'drive:pad-test:%'").get().n, 3);
  assert.equal(h.sqlite.prepare("SELECT count(*) AS n FROM publications WHERE id LIKE 'drive:abiertos-test:%'").get().n, 1);
  assert.equal(h.sqlite.prepare("SELECT status FROM juntas_import_checkpoint WHERE root_id='com-test'").get().status, "PARTIAL");
  assert.equal(h.sqlite.prepare("SELECT sync_status FROM sync_state WHERE source='Comunicados'").get().sync_status, "PARTIAL");
  assert.equal(h.sqlite.prepare("SELECT count(*) AS n FROM publications WHERE removed_at IS NOT NULL").get().n, 0);
  const repeated = await runJuntasCheckpoint(options);
  assert.equal(repeated.created, 0);
  h.sqlite.close();
});

test("a queue beyond 64 folders resumes without losing descendants", async () => {
  const h = isolatedD1();
  const rootFolder = "123456789012345678901234567890";
  const folders = Array.from({ length: 70 }, (_, index) => ({ id: `folder_${String(index).padStart(8, "0")}`,
    name: `Carpeta ${index}`, mimeType: "application/vnd.google-apps.folder", resourceKey: `0-child-${index}` }));
  const fixture = driveFixture(new Map([[rootFolder, folders],
    ...folders.map((folder, index) => [folder.id, [file(index)]])]));
  const sourceFetch = async (input, init) => {
    const folderId = new URL(String(input)).searchParams.get("q")?.match(/'([^']+)'/)?.[1];
    if (folderId?.startsWith("folder_")) {
      const index = Number(folderId.split("_").at(-1));
      const header = new Headers(init?.headers).get("X-Goog-Drive-Resource-Keys");
      assert.ok(header?.includes(`${rootFolder}/0-synthetic`));
      assert.ok(header?.includes(`${folderId}/0-child-${index}`));
    }
    return fixture.fetcher(input, init);
  };
  const options = { sources: [root], sourceFetch, maxRequests: 8,
    maxPublicationWrites: 5, maxSteps: 40 };
  await untilComplete(h.db, options, 100);
  assert.equal(h.sqlite.prepare("SELECT count(*) AS n FROM publications").get().n, 70);
  assert.equal(h.sqlite.prepare("SELECT count(*) AS n FROM juntas_import_applied").get().n, 70);
  h.sqlite.close();
});

test("an unexpired lease prevents another runner from processing the same root", async () => {
  const h = isolatedD1();
  const fixture = driveFixture(new Map([["123456789012345678901234567890", [file(1)]]]));
  await runJuntasCheckpoint({ db: h.db, driveKey: key, sources: [root], sourceFetch: fixture.fetcher, now,
    maxRequests: 1, maxPublicationWrites: 1, maxSteps: 1 });
  h.sqlite.prepare("UPDATE juntas_import_checkpoint SET lease_owner='other',lease_until='2026-10-25T12:10:00Z' WHERE root_id='pad-test'").run();
  const before = fixture.calls.drive;
  const busy = await runJuntasCheckpoint({ db: h.db, driveKey: key, sources: [root], sourceFetch: fixture.fetcher, now,
    maxRequests: 1, maxPublicationWrites: 1, maxSteps: 1 });
  assert.equal(busy.sourceRequests, 0);
  assert.equal(fixture.calls.drive, before);
  h.sqlite.close();
});

test("Comunicados root resumes parsed notices and skips unchanged document content", async () => {
  const h = isolatedD1();
  const fixture = driveFixture(new Map());
  const options = { sources: [docRoot], sourceFetch: fixture.fetcher,
    maxRequests: 2, maxPublicationWrites: 1, maxSteps: 4 };
  const first = await untilComplete(h.db, options, 20);
  assert.ok(first.totals.created >= 2, "root reference and a classified notice were imported");
  const count = h.sqlite.prepare("SELECT count(*) AS n FROM publications").get().n;
  const again = await untilComplete(h.db, { ...options, now: new Date(now.getTime() + 25 * 60 * 60 * 1000) }, 20);
  assert.equal(again.totals.publicationRowsWritten, 0);
  assert.equal(h.sqlite.prepare("SELECT count(*) AS n FROM publications").get().n, count);
  h.sqlite.close();
});

test("an expired Drive page token restarts its folder without deleting confirmed documents", async () => {
  const h = isolatedD1();
  const files = Array.from({ length: 30 }, (_, index) => file(index));
  let expired = false;
  const sourceFetch = async (input) => {
    const url = new URL(String(input)), token = url.searchParams.get("pageToken");
    if (token && !expired) {
      expired = true;
      return Response.json({ error: { errors: [{ reason: "invalidPageToken" }] } }, { status: 400 });
    }
    const offset = Number(token || 0);
    return Response.json({ files: files.slice(offset, offset + 25),
      ...(offset + 25 < files.length ? { nextPageToken: String(offset + 25) } : {}) });
  };
  const result = await untilComplete(h.db, { sources: [root], sourceFetch,
    maxRequests: 3, maxPublicationWrites: 25, maxSteps: 10 }, 10);
  assert.equal(result.totals.created, 30);
  assert.equal(h.sqlite.prepare("SELECT count(*) AS n FROM publications").get().n, 30);
  assert.equal(h.sqlite.prepare("SELECT count(*) AS n FROM publications WHERE removed_at IS NOT NULL").get().n, 0);
  assert.equal(expired, true);
  h.sqlite.close();
});
