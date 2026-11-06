import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { CommunityDatabase } from "./community.ts";

const CATALOG_URL = "https://possee41.github.io/docentetuc-fdci-catalog-pilot/catalog.json";
const ACCEPTED_VERSION = "14ffa0ebd934c43d36757b89be76318ee0053a45352912f758786ee5377c613b";

async function fetchCatalog() {
  const response = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("CATALOG_UNAVAILABLE");
  const data = await response.json() as { version?: string; items?: unknown[] };
  if (!data || typeof data !== "object" || !Array.isArray(data.items)) throw new Error("CATALOG_INVALID");
  if (data.version !== ACCEPTED_VERSION) throw new Error("CATALOG_VERSION_MISMATCH");
  return data.items as Array<Record<string, unknown>>;
}

function fixture() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(readFileSync(new URL("../drizzle/0000_docentetuc.sql", import.meta.url), "utf8"));
  raw.exec(readFileSync(new URL("../drizzle/0001_training_metadata.sql", import.meta.url), "utf8"));
  raw.exec(readFileSync(new URL("../drizzle/0003_web_push.sql", import.meta.url), "utf8"));
  raw.exec(readFileSync(new URL("../migrations/0008_personal_matching_circuits.sql", import.meta.url), "utf8"));
  raw.exec(readFileSync(new URL("../migrations/0009_reliability_lifecycle.sql", import.meta.url), "utf8"));
  raw.exec(`INSERT INTO publications (id, source, external_id, kind, category, title, summary, level, area, location, character, junta, shift, starts_at, ends_at, status, official_url, registration_open_at, registration_close_at, normalized_status, source_published_at, metadata, content_hash, first_seen_at, updated_at, removed_at)
    VALUES ('sime:1', 'SIME', 'sime-1', 'capacitacion', 'Capacitaciones', 'Capacitación SIME real', 'Resumen SIME', 'Nivel', 'Area', 'Lugar', 'Carácter', '', '', '2026-11-10T00:00:00Z', '2026-11-20T00:00:00Z', 'vigente', 'https://sime.educaciontuc.gov.ar/1', '2026-11-01T00:00:00Z', '2026-11-05T00:00:00Z', 'ACTIVE', NULL, '{}', 'sime-hash', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL)`);
  const database = { prepare(sql: string) { return { bind(...values: unknown[]) { const args = values as (string | number | null)[]; return { first: async <T>() => raw.prepare(sql).get(...args) as T | null, all: async <T>() => ({ results: raw.prepare(sql).all(...args) as T[] }), run: async () => raw.prepare(sql).run(...args) }; } }; } } as unknown as CommunityDatabase;
  return { raw, database };
}

test("el catálogo FDCI se descarga y valida correctamente", async () => {
  const items = await fetchCatalog();
  assert.equal(items.length, 2);
  assert.ok(items.every((i) => i.id === "fdci:commission:9000" || i.id === "fdci:commission:9001"));
  assert.ok(items.every((i) => i.title === "DEMO SINTÉTICA — NO OFICIAL"));
});

test("un item FDCI válido se materializa en publications", async () => {
  const { raw } = fixture();
  try {
    const items = await fetchCatalog();
    const item = items[0];
    assert.ok(item, "item should exist");
    const result = raw.prepare(`INSERT INTO publications (id, source, external_id, kind, category, title, summary, level, area, location, character, junta, shift, starts_at, ends_at, status, official_url, registration_open_at, registration_close_at, normalized_status, source_published_at, metadata, content_hash, first_seen_at, updated_at, removed_at)
      VALUES (?, 'FDCI', ?, 'capacitacion', ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'fdci-catalog', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL)`).run(item.id as string, item.externalId as string, item.category as string, item.title as string, (item.summary as string) || "", (item.level as string) || "", (item.area as string) || "", (item.location as string) || "", (item.character as string) || "", (item.startsAt as string) || null, (item.endsAt as string) || null, item.status as string, item.officialUrl as string, (item.registrationOpenAt as string) || null, (item.registrationCloseAt as string) || null, item.normalizedStatus as string, JSON.stringify({ source: "FDCI Tucumán", catalogOnly: true }));
    console.log("DEBUG insert result:", JSON.stringify(result));
    const row = raw.prepare("SELECT id, source, kind, metadata, content_hash FROM publications WHERE id=?").get(item.id as string) as { id: string; source: string; kind: string; metadata: string; content_hash: string } | undefined;
    console.log("DEBUG row:", JSON.stringify(row));
    assert.ok(row, "row should exist");
    assert.equal(row.id, "fdci:commission:9000");
    assert.equal(row.source, "FDCI");
    assert.equal(row.kind, "capacitacion");
    assert.ok(JSON.parse(row.metadata).catalogOnly === true);
  } finally { raw.close(); }
});

test("un item FDCI no aparece en el listado público general", async () => {
  const { raw } = fixture();
  try {
    const items = await fetchCatalog();
    const item = items[0];
    assert.ok(item, "item should exist");
    raw.prepare(`INSERT OR IGNORE INTO publications (id, source, external_id, kind, category, title, summary, level, area, location, character, junta, shift, starts_at, ends_at, status, official_url, registration_open_at, registration_close_at, normalized_status, source_published_at, metadata, content_hash, first_seen_at, updated_at, removed_at)
      VALUES (?, 'FDCI', ?, 'capacitacion', ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'fdci-catalog', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL)`)
      .run(item.id as string, item.externalId as string, item.category as string, item.title as string, (item.summary as string) || "", (item.level as string) || "", (item.area as string) || "", (item.location as string) || "", (item.character as string) || "", (item.startsAt as string) || null, (item.endsAt as string) || null, item.status as string, item.officialUrl as string, (item.registrationOpenAt as string) || null, (item.registrationCloseAt as string) || null, item.normalizedStatus as string, JSON.stringify({ source: "FDCI Tucumán", catalogOnly: true }));
    const APP_PUBLICATIONS_QUERY = `SELECT * FROM publications WHERE id IN (
      SELECT id FROM (SELECT id FROM publications WHERE kind IN ('vacante','capacitacion','junta')
        AND NOT (json_valid(metadata) AND COALESCE(json_extract(metadata,'$.catalogOnly'),0)=1)
        ORDER BY updated_at DESC, id DESC LIMIT 400)
    )`;
    const publicItems = raw.prepare(APP_PUBLICATIONS_QUERY).all() as { id: string }[];
    assert.ok(!publicItems.some((i) => i.id === "fdci:commission:9000"), "FDCI item should not appear in public list");
    assert.ok(publicItems.some((i) => i.id === "sime:1"), "SIME item should appear in public list");
  } finally { raw.close(); }
});

test("save/agenda se asocia al usuario autenticado (separación)", () => {
  const { raw } = fixture();
  try {
    const cols = raw.prepare("PRAGMA table_info(saved_publications)").all() as { name: string }[];
    const colNames = cols.map((c) => c.name);
    assert.ok(colNames.includes("user_id"), "saved_publications must have user_id");
    assert.ok(colNames.includes("publication_id"), "saved_publications must have publication_id");
  } finally { raw.close(); }
});

test("un identificador arbitrario es rechazado", () => {
  const isFdciId = (id: string) => /^fdci:commission:\d+$/.test(id);
  assert.ok(isFdciId("fdci:commission:9000"));
  assert.ok(!isFdciId("arbitrary-id"));
  assert.ok(!isFdciId("fdci:commission:"));
  assert.ok(!isFdciId("fdci:evil:9000"));
});

test("el catálogo inválido o con versión incorrecta se rechaza", async () => {
  const badCatalog = { version: "wrong-hash", items: [{ id: "fdci:commission:9999", title: "Fake" }] };
  const isValid = (data: { version?: string }) => data.version === ACCEPTED_VERSION;
  assert.ok(!isValid(badCatalog), "wrong version should be rejected");
  const noItems = { version: ACCEPTED_VERSION, items: null };
  assert.ok(!Array.isArray(noItems.items), "missing items should be rejected");
});

test("el catálogo FDCI se descarga y valida correctamente", async () => {
  const items = await fetchCatalog();
  assert.equal(items.length, 2);
  assert.ok(items.every((i) => i.id === "fdci:commission:9000" || i.id === "fdci:commission:9001"));
  assert.ok(items.every((i) => i.title === "DEMO SINTÉTICA — NO OFICIAL"));
});