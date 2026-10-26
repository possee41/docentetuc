import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { eligiblePersonalPublication, hasPersonalCriteria, personalizedCatalogPage, publicationForMatch, PERSONAL_CATALOG_SQL, PERSONAL_PAGE_SIZE, PERSONAL_SCAN_SIZE } from "./personalized-catalog.ts";
import { profileMatch } from "./matching.ts";
import { emptyPersonalFilters, parsePersonalFilters, passesPersonalFilters } from "./personalized-filters.ts";
import type { Profile, Publication } from "./types.ts";

const now = new Date("2026-10-26T12:00:00-03:00");
const profile = { user_id: "teacher", levels: ["Secundario"], areas: ["Matemática"], subjects: ["Matemática"],
  boards: ["Secundario"], roles: ["Profesor de Matemática"], department: "", locality: "", shifts: [],
  characters: [], circuits: [], training_interests: ["Matemática"], personal_match_threshold: 85 } as unknown as Profile;
const official = JSON.stringify({ official: { version: 1, entity: "opportunity", topics: ["INSCRIPCION_SIME"], sources: [],
  scope: {}, facts: { publicationStart: { value: "2026-10-20T09:00:00-03:00", precision: "datetime" },
    publicationEnd: { value: "2026-11-05T18:00:00-03:00", precision: "datetime" } }, abierto: true } });
const training = JSON.stringify({ entity: "commission", trainingId: "course", registrationOpensAt: "2026-10-20T09:00:00-03:00",
  registrationClosesAt: "2026-11-05T18:00:00-03:00", dateStatus: "confirmed", registrationHasTime: true });

function row(kind: "vacante" | "capacitacion", metadata: string, extra: Partial<Publication> = {}) {
  return { kind, id: "id", source: kind === "vacante" ? "SIME" : "FDCI", title: kind === "vacante" ? "Escuela X - Profesor de Matemática" : "Matemática docente",
    summary: "Curso", level: "Secundario", area: "Matemática", junta: "Secundario", location: "", shift: "", character: "",
    metadata, status: "inscripción abierta", normalized_status: "ACTIVE", starts_at: "2026-10-20T09:00:00-03:00",
    ends_at: "2026-11-05T18:00:00-03:00", official_url: "https://example.invalid/oficial", updated_at: "2026-10-26", ...extra } as Publication;
}

test("respeta evidencia, umbral, estados y cupo sin falsos positivos", () => {
  assert.equal(eligiblePersonalPublication(row("vacante", official), profile, "vacante", now), true);
  assert.equal(eligiblePersonalPublication(row("vacante", official, { level: "Primario", junta: "Primario" }), profile, "vacante", now), false);
  const partial = row("vacante", official, { character: "Interino" });
  assert.equal(profileMatch(publicationForMatch(partial), { levels: ["Secundario"], areas: ["Matemática"], roles: ["Profesor de Matemática"], characters: ["Suplente"] }).status, "partial");
  assert.equal(eligiblePersonalPublication(partial, { ...profile, characters: ["Suplente"], personal_match_threshold: 70 }, "vacante", now), false);
  assert.equal(eligiblePersonalPublication(row("vacante", official, { circuit: "II" }), { ...profile, circuits: ["I"] }, "vacante", now), false);
  assert.equal(eligiblePersonalPublication(row("vacante", official, { location: "Yerba Buena" }), { ...profile, locality: "San Miguel" }, "vacante", now), false);
  assert.equal(eligiblePersonalPublication(row("vacante", official, { shift: "Tarde" }), { ...profile, shifts: ["Mañana"] }, "vacante", now), false);
  assert.equal(eligiblePersonalPublication(row("vacante", official, { title: "Escuela X - Preceptor", area: "Historia" }), profile, "vacante", now), false);
  assert.equal(eligiblePersonalPublication(row("vacante", "{}"), profile, "vacante", now), false);
  assert.equal(eligiblePersonalPublication(row("capacitacion", training), profile, "capacitacion", now), true);
  assert.equal(eligiblePersonalPublication(row("capacitacion", training, { level: "Primario", junta: "Primario" }), profile, "capacitacion", now), false);
  assert.equal(eligiblePersonalPublication(row("capacitacion", JSON.stringify({ ...JSON.parse(training), registrationOpensAt: "2026-11-01T09:00:00-03:00" })), profile, "capacitacion", now), true);
  assert.equal(eligiblePersonalPublication(row("capacitacion", JSON.stringify({ ...JSON.parse(training), registrationClosesAt: "2026-10-25T18:00:00-03:00" })), profile, "capacitacion", now), false);
  assert.equal(eligiblePersonalPublication(row("capacitacion", JSON.stringify({ ...JSON.parse(training), availablePreCapacity: 0 })), profile, "capacitacion", now), false);
  assert.equal(eligiblePersonalPublication(row("capacitacion", "{}"), profile, "capacitacion", now), false);
  assert.equal(eligiblePersonalPublication(row("capacitacion", training), { ...profile, levels: [], areas: [], subjects: [], training_interests: [] }, "capacitacion", now), false);
  assert.equal(hasPersonalCriteria({ ...profile, levels: [], boards: [], areas: [], subjects: [], roles: [], shifts: [], characters: [], circuits: [], training_interests: [] }, "vacante"), false);
  assert.equal(hasPersonalCriteria({ ...profile, levels: [], boards: [], areas: [], subjects: [], training_interests: [] }, "capacitacion"), false);
  assert.equal(PERSONAL_PAGE_SIZE, 20);
  assert.equal(PERSONAL_SCAN_SIZE, 120);
  assert.match(PERSONAL_CATALOG_SQL, /kind=\? AND id>\?/);
  assert.equal(profileMatch({ kind: "vacante", title: "Profesor de Matemática", level: "Secundario" }, { levels: ["Secundario"], roles: ["Profesor de Matemática"], shifts: ["Mañana"], locality: "Capital" }).status, "unknown");
  assert.throws(() => parsePersonalFilters(new URLSearchParams("character=Inexistente"), "vacante"));
  assert.equal(passesPersonalFilters(row("vacante", official, { circuit: "II", shift: "Mañana" }), profile, "vacante", { ...emptyPersonalFilters, circuit: "II", junta: "secundaria", query: "matemática" }, now), true);
  assert.equal(passesPersonalFilters(row("vacante", official, { circuit: "II" }), profile, "vacante", { ...emptyPersonalFilters, circuit: "I" }, now), false);
});

test("recorre 7.200 publicaciones y encuentra coincidencias después del registro 400 y al final", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE publications(id TEXT PRIMARY KEY,kind TEXT,source TEXT,title TEXT,summary TEXT,level TEXT,area TEXT,junta TEXT,location TEXT,shift TEXT,character TEXT,metadata TEXT,status TEXT,normalized_status TEXT,starts_at TEXT,ends_at TEXT,official_url TEXT,updated_at TEXT);
    CREATE INDEX idx_publications_kind_id ON publications(kind,id);`);
  const insert = sqlite.prepare("INSERT INTO publications VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const matches = new Set([500, 3500, 4000, 7199]);
  sqlite.exec("BEGIN");
  for (let index = 0; index < 7200; index++) {
    const kind = index < 3600 ? "vacante" : "capacitacion";
    const future = JSON.stringify({ ...JSON.parse(training), registrationOpensAt: "2026-11-01T09:00:00-03:00" });
    const item = row(kind, matches.has(index) ? kind === "vacante" ? official : index === 7199 ? future : training : "{}", {
      id: `p:${String(index).padStart(4, "0")}`, area: matches.has(index) ? "Matemática" : "Historia",
      title: index === 7199 ? "Foco Matemática docente" : kind === "vacante" ? "Escuela X - Profesor de Matemática" : "Matemática docente",
      character: index === 7199 ? "Virtual" : "" });
    insert.run(item.id, item.kind, item.source, item.title, item.summary, item.level, item.area, item.junta, item.location,
      item.shift, item.character, item.metadata, item.status, item.normalized_status ?? "", item.starts_at, item.ends_at, item.official_url, item.updated_at);
  }
  sqlite.exec("COMMIT");
  const db = { prepare: (sql: string) => ({ bind: (...values: string[]) => ({ all: async <T>() => ({ results: sqlite.prepare(sql).all(...values) as T[] }) }) }) };
  const found: string[] = [];
  let pages = 0, scanned = 0;
  for (const kind of ["vacante", "capacitacion"] as const) {
    let cursor = "";
    do {
      const page = await personalizedCatalogPage(db, profile, kind, cursor, now);
      assert.ok(page.scanned <= PERSONAL_SCAN_SIZE);
      assert.ok(page.items.length <= PERSONAL_PAGE_SIZE);
      found.push(...page.items.map(item => item.id));
      scanned += page.scanned;
      pages++;
      cursor = page.nextCursor || "";
    } while (cursor);
  }
  assert.deepEqual(found.sort(), [...matches].map(index => `p:${String(index).padStart(4, "0")}`).sort());
  assert.equal(new Set(found).size, 4);
  assert.equal(scanned, 7200);
  assert.equal(pages, 60);
  let designationCursor = "";
  const designations: string[] = [];
  do {
    const page = await personalizedCatalogPage(db, profile, "vacante", designationCursor, now,
      item => passesPersonalFilters(item, profile, "vacante", { ...emptyPersonalFilters, junta: "secundaria", query: "matemática" }, now));
    designations.push(...page.items.map(item => item.id));
    designationCursor = page.nextCursor || "";
  } while (designationCursor);
  assert.deepEqual(designations, ["p:0500", "p:3500"]);
  let filteredCursor = "";
  const filtered: string[] = [];
  do {
    const page = await personalizedCatalogPage(db, profile, "capacitacion", filteredCursor, now,
      item => passesPersonalFilters(item, profile, "capacitacion", { ...emptyPersonalFilters, source: "platform:fdci", date: "month", character: "virtual", query: "foco" }, now));
    filtered.push(...page.items.map(item => item.id));
    filteredCursor = page.nextCursor || "";
  } while (filteredCursor);
  assert.deepEqual(filtered, ["p:7199"]);
  sqlite.close();
});
