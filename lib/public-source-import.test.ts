import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import receiver from "../workers/public-source-receiver.mjs";
import { runPublicSourceImport } from "../scripts/import-public-sources.mjs";
import { APP_PUBLICATIONS_QUERY } from "./app-publications-query.ts";
import { officialMetadata } from "./official-publication.ts";

const secret = "synthetic_public_import_secret_123456";
const endpoint = "https://example.test/api/internal/public-source-import/juntas";
const now = new Date("2026-10-22T15:00:00Z");
const docUrl = "https://docs.google.com/document/d/123456789012345678901234567890/edit";
const folderUrl = "https://drive.google.com/drive/folders/123456789012345678901234567890?resourcekey=0-synthetic";
const noticeText = `COMUNICADO\n22/10/2026\nACTO DE DESIGNACIÓN\nFECHA DE DESIGNACIÓN: 26/10/2026 09:00\nLUGAR: Escuela Central\nLLAMADO ABIERTO\n22/10/2026\nPDVC-20261022-44\nINSCRIPCIÓN SIME: 22/10/2026 al 25/10/2026`;

function localD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE publications (
    id TEXT PRIMARY KEY, source TEXT NOT NULL, external_id TEXT NOT NULL, kind TEXT NOT NULL,
    category TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', level TEXT NOT NULL DEFAULT '',
    area TEXT NOT NULL DEFAULT '', junta TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '',
    shift TEXT NOT NULL DEFAULT '', character TEXT NOT NULL DEFAULT '', circuit TEXT NOT NULL DEFAULT 'UNKNOWN',
    source_circuit_raw TEXT NOT NULL DEFAULT '', circuit_inference_source TEXT NOT NULL DEFAULT 'unknown',
    circuit_confidence INTEGER NOT NULL DEFAULT 0, starts_at TEXT, ends_at TEXT, status TEXT NOT NULL,
    official_url TEXT NOT NULL, metadata TEXT NOT NULL, content_hash TEXT NOT NULL, source_updated_at TEXT,
    source_published_at TEXT, registration_open_at TEXT, registration_close_at TEXT, expires_at TEXT,
    source_status TEXT NOT NULL DEFAULT 'UNKNOWN', normalized_status TEXT NOT NULL DEFAULT 'UNKNOWN',
    removed_at TEXT, last_seen_at TEXT NOT NULL DEFAULT '', last_changed_at TEXT NOT NULL DEFAULT '',
    first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE sync_state(source TEXT PRIMARY KEY,synced_at TEXT NOT NULL,item_count INTEGER NOT NULL DEFAULT 0,
      error TEXT,last_attempt_at TEXT,last_successful_sync_at TEXT,last_content_change_at TEXT,
      records_created INTEGER NOT NULL DEFAULT 0,records_updated INTEGER NOT NULL DEFAULT 0,records_removed INTEGER NOT NULL DEFAULT 0,
      records_expired INTEGER NOT NULL DEFAULT 0,sync_status TEXT NOT NULL DEFAULT 'UNKNOWN',error_code TEXT,error_message TEXT,
      parser_version TEXT NOT NULL DEFAULT '1');`);
  const prepare = (sql: string) => ({ bind: (...values: unknown[]) => ({
    all: async () => { const results = sqlite.prepare(sql).all(...values as []) as Record<string, unknown>[]; return { results, meta: { rows_read: results.length } }; },
    run: async () => { const result = sqlite.prepare(sql).run(...values as []); return { meta: { rows_written: Number(result.changes), rows_read: 0 } }; },
  }) });
  const db = { prepare, batch: async (statements: { run: () => Promise<unknown> }[]) => {
    sqlite.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec("COMMIT"); return results; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } } as unknown as D1Database;
  return { sqlite, db };
}
function harness(sourceFetch: typeof fetch) {
  const { sqlite, db } = localD1();
  const env = { DB: db, JUNTAS_IMPORT_SECRET: secret, CENET_IMPORT_SECRET: secret, INFD_IMPORT_SECRET: secret };
  const receiverFetch = (async (input: RequestInfo | URL, init?: RequestInit) => receiver.fetch(new Request(input, init), env)) as typeof fetch;
  const run = (source: "juntas" | "cenet" | "infd", options = {}) => runPublicSourceImport({ source,
    endpoint: endpoint.replace("juntas", source), token: secret, sourceFetch, receiverFetch, now,
    driveKey: undefined, juntaSources: undefined, ...options });
  return { sqlite, env, receiverFetch, run };
}

test("Juntas: comunicado, acto y llamado via Node → D1 aislada → consulta pública; repetición idempotente", async () => {
  let drivePages = 0;
  const sourceFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/export?format=txt")) return new Response(noticeText);
    if (url.startsWith("https://www.googleapis.com/drive/v3/files")) {
      assert.equal(new URL(url).searchParams.get("pageSize"), "25");
      assert.equal(new Headers(init?.headers).get("X-Goog-Drive-Resource-Keys"), "123456789012345678901234567890/0-synthetic");
      drivePages++;
      return Response.json(new URL(url).searchParams.has("pageToken")
        ? { files: [{ id: "file_page_2", name: "Padrón 2026", mimeType: "application/pdf", modifiedTime: "2026-10-22T10:00:00Z" }] }
        : { files: [{ id: "file_page_1", name: "Circular", mimeType: "application/pdf", modifiedTime: "2026-10-22T09:00:00Z" }], nextPageToken: "next" });
    }
    throw new Error("UNEXPECTED_SOURCE_URL");
  }) as typeof fetch;
  const h = harness(sourceFetch), sources = [
    ["com-test", "Comunicados", "Inicial y Primaria", docUrl],
    ["pad-test", "Padrones", "Inicial y Primaria", folderUrl],
  ] as const;
  h.sqlite.prepare(`INSERT INTO publications(id,source,external_id,kind,category,title,status,official_url,metadata,content_hash)
    VALUES('historic:1','SIME','1','vacante','Vacante','Histórica','cerrada','https://sime.educaciontuc.gov.ar/','{}','old')`).run();
  const first = await h.run("juntas", { driveKey: "synthetic_drive_api_key_123456", juntaSources: sources });
  const second = await h.run("juntas", { driveKey: "synthetic_drive_api_key_123456", juntaSources: sources });
  assert.ok(first.created >= 6);
  assert.equal(second.rowsWritten, 0);
  assert.equal(second.unchanged, first.discovered);
  assert.equal(drivePages, 4, "dos páginas reales por ejecución");
  const visible = h.sqlite.prepare(APP_PUBLICATIONS_QUERY).all() as { category: string; metadata: string; starts_at: string; location: string }[];
  const act = visible.find((row) => row.category === "Actos de designación");
  const call = visible.find((row) => row.category === "Llamados abiertos");
  assert.ok(act); assert.ok(call);
  assert.equal(act.starts_at, "2026-10-26T09:00:00-03:00");
  assert.equal(act.location, "Escuela Central");
  assert.equal(officialMetadata({ metadata: act.metadata })?.entity, "event");
  assert.equal(officialMetadata({ metadata: call.metadata })?.entity, "opportunity");
  assert.ok(visible.some((row) => officialMetadata({ metadata: row.metadata })?.entity === "padron"));
  assert.equal(h.sqlite.prepare("SELECT count(*) AS n FROM publications WHERE id='historic:1'").get()?.n, 1);
  assert.equal(h.sqlite.prepare("SELECT sync_status FROM sync_state WHERE source='Comunicados'").get()?.sync_status, "OK");
});

test("Juntas: página interrumpida conserva lo aplicado y el último éxito, sin inferir ausencias", async () => {
  let failed = false;
  const sourceFetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/export?format=txt")) return new Response(noticeText);
    if (failed) return new Response("", { status: 503 });
    return Response.json({ files: [] });
  }) as typeof fetch;
  const h = harness(sourceFetch), sources = [["com-test", "Comunicados", "Inicial y Primaria", docUrl],
    ["pad-test", "Padrones", "Inicial y Primaria", folderUrl]] as const;
  await h.run("juntas", { driveKey: "synthetic_drive_api_key_123456", juntaSources: sources });
  const success = h.sqlite.prepare("SELECT last_successful_sync_at FROM sync_state WHERE source='Padrones'").get()?.last_successful_sync_at;
  failed = true;
  await assert.rejects(h.run("juntas", { driveKey: "synthetic_drive_api_key_123456", juntaSources: sources }));
  assert.equal(h.sqlite.prepare("SELECT last_successful_sync_at FROM sync_state WHERE source='Padrones'").get()?.last_successful_sync_at, success);
  assert.notEqual(h.sqlite.prepare("SELECT sync_status FROM sync_state WHERE source='Padrones'").get()?.sync_status, "OK");
  assert.ok(Number(h.sqlite.prepare("SELECT count(*) AS n FROM publications").get()?.n) > 0);
});

test("receptor público rechaza no autorizados y fuentes falsas sin escribir", async () => {
  const h = harness((async () => new Response("")) as typeof fetch);
  const unauth = await receiver.fetch(new Request(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "start" }) }), h.env);
  assert.equal(unauth.status, 401);
  const wrong = await receiver.fetch(new Request(endpoint, { method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "batch", items: [{ id: "sime:1" }] }) }), h.env);
  assert.equal(wrong.status, 400);
  assert.equal(h.sqlite.prepare("SELECT count(*) AS n FROM publications").get()?.n, 0);
});

test("CeNET: calendario y curso oficial conservan fechas; repetición no escribe", async () => {
  const html = readFileSync(new URL("./fixtures/cenet-cohort-sample.html", import.meta.url), "utf8");
  const h = harness((async () => new Response(html)) as typeof fetch);
  const first = await h.run("cenet"), repeat = await h.run("cenet");
  assert.ok(first.created > 0);
  assert.equal(repeat.rowsWritten, 0);
  const rows = h.sqlite.prepare(APP_PUBLICATIONS_QUERY).all() as { id: string; official_url: string; registration_open_at: string; registration_close_at: string }[];
  const course = rows.find((row) => row.id.startsWith("cenet:"));
  assert.ok(course);
  assert.equal(course.official_url, "https://cenet.inet.edu.ar/mod/page/view.php?id=30493");
  assert.ok(course.registration_open_at && course.registration_close_at);
  assert.equal(h.sqlite.prepare("SELECT sync_status FROM sync_state WHERE source='CeNET / INET'").get()?.sync_status, "OK");
});

test("INFoD: cursos importados, página fallida deja éxito anterior y cursos intactos", async () => {
  let fail = false;
  const courseUrl = "https://red.infd.edu.ar/curso-docente/";
  const sourceFetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/cursos-nacionales-2/")) return new Response(`<h1>Cursos nacionales 2026</h1><p>Fecha de inscripción: 20 de octubre al 30 de octubre</p><a href="${courseUrl}">Curso</a>`);
    if (url === courseUrl) return fail ? new Response("", { status: 503 }) : new Response(`<h1>Cursos nacionales 2026</h1><p>Fecha de inscripción: 20 de octubre al 30 de octubre</p><p style="font-size:30px"><strong>Alfabetización temprana</strong></p><p>Destinatarios: Docentes. Modalidad: Virtual.</p>`);
    throw new Error("UNEXPECTED_SOURCE_URL");
  }) as typeof fetch;
  const h = harness(sourceFetch);
  const first = await h.run("infd"), repeat = await h.run("infd");
  assert.equal(first.created, 1);
  assert.equal(repeat.rowsWritten, 0);
  const row = (h.sqlite.prepare(APP_PUBLICATIONS_QUERY).all() as { id: string; registration_close_at: string }[]).find((item) => item.id.startsWith("infd:"));
  assert.ok(row);
  assert.equal(row.registration_close_at, "2026-10-30T23:59:59-03:00");
  const success = h.sqlite.prepare("SELECT last_successful_sync_at FROM sync_state WHERE source='INFoD / AulaS-TIC'").get()?.last_successful_sync_at;
  fail = true;
  await assert.rejects(h.run("infd"));
  assert.equal(h.sqlite.prepare("SELECT last_successful_sync_at FROM sync_state WHERE source='INFoD / AulaS-TIC'").get()?.last_successful_sync_at, success);
  assert.equal(h.sqlite.prepare("SELECT count(*) AS n FROM publications WHERE id=?").get(row.id)?.n, 1);
});
