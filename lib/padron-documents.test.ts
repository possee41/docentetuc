import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { Publication } from "./types.ts";
import { groupPadrones, padronDocuments, padronSelection, padronTitleFacts, padronYear, PADRON_PAGE_QUERY } from "./padron-documents.ts";
import { classifyDriveReference } from "./junta-notices.ts";
import { officialMetadata, type CollectedPublication } from "./official-publication.ts";

const row = (id: string, title: string) => ({ id, title, kind: "junta", category: "Padrones", source: "Padrones y Comunicados",
  junta: "Inicial y Primaria", official_url: `https://drive.google.com/file/d/${id}/view`, metadata: "{}", updated_at: "2026-10-11" } as Publication);

test("año de padrón verificado, convocatoria distinta y año no determinado", () => {
  assert.deepEqual(padronTitleFacts("Padrón Definitivo 2026 · convocatoria 2025").year, 2026);
  assert.equal(padronTitleFacts("Convocatoria 2026 · Padrón Provisorio 2025").year, 2025);
  assert.equal(padronTitleFacts("Padrón Definitivo · actualizado en Drive 2026").year, null);
  assert.equal(padronTitleFacts("Padrón Especial · Resolución 2026").year, null);
  assert.equal(padronTitleFacts("Padrón Complementario ciclo lectivo 2026").type, "Complementario");
  const classified = classifyDriveReference({ id: "drive:1", title: "Padrón Definitivo 2026 · cargo: Maestra de grado",
    junta: "Inicial y Primaria", officialUrl: "https://drive.google.com/file/d/1/view", category: "Padrones", metadata: "{}" } as CollectedPublication, "application/pdf");
  assert.equal(officialMetadata(classified)?.facts.padronYear.value, "2026");
  assert.equal(officialMetadata(classified)?.facts.padronType.value, "Definitivo");
  assert.equal(officialMetadata(classified)?.facts.padronSubject.value, "cargo: Maestra de grado");
});

test("solo año vigente; historial y fallback al último verificado en año nuevo", () => {
  const current = row("a", "Padrón Provisorio 2026"), old = row("b", "Padrón Definitivo 2025"), unknown = row("c", "Padrón Especial");
  const in2026 = padronSelection([current, old, unknown], new Date("2026-10-11T12:00:00Z"));
  assert.deepEqual(in2026.current.map(item => item.id), ["a"]);
  assert.deepEqual(in2026.history.map(item => item.id), ["b"]);
  assert.deepEqual(in2026.undetermined.map(item => item.id), ["c"]);
  const in2027 = padronSelection([current, old, unknown], new Date("2027-01-02T12:00:00Z"));
  assert.equal(in2027.year, 2026);
  assert.deepEqual(in2027.current.map(item => item.id), ["a"]);
  assert.equal(padronSelection([...in2027.current, row("d", "Padrón 2027")], new Date("2027-01-02T12:00:00Z")).year, 2027);
});

test("provisorio y definitivo separados; carpeta y PDF de la misma versión agrupados con ambos enlaces", () => {
  const folder = row("folder", "Carpeta Padrón Definitivo 2026");
  const pdf = row("pdf", "Padrón Definitivo 2026.pdf");
  const provisional = row("provisional", "Padrón Provisorio 2026.pdf");
  const groups = groupPadrones(padronDocuments([folder, pdf, provisional]));
  assert.equal(groups.length, 2);
  assert.equal(padronTitleFacts(groups[0][0].title).type, "Definitivo");
  assert.deepEqual(groups.find(group => group.length === 2)?.map(item => item.id).sort(), ["folder", "pdf"]);
  assert.equal(new Set(groups.flat().map(item => item.official_url)).size, 3);
  assert.equal(padronYear(row("unknown", "Padrón de convocatoria 2026")), null);
});

test("consulta paginada no pierde padrones fuera del límite general de 1500", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE publications (id TEXT PRIMARY KEY, source TEXT, kind TEXT, category TEXT, title TEXT, metadata TEXT)");
  const insert = db.prepare("INSERT INTO publications VALUES (?, 'Padrones y Comunicados', 'junta', 'Padrones', ?, '{}')");
  for (let index = 0; index < 1601; index++) insert.run(`drive:${String(index).padStart(4, "0")}`, `Padrón 2026 ${index}`);
  let cursor = "", count = 0;
  for (;;) {
    const page = db.prepare(PADRON_PAGE_QUERY).all(cursor) as { id: string }[];
    const batch = page.slice(0, 200);
    count += batch.length;
    if (page.length <= 200) break;
    cursor = batch.at(-1)!.id;
  }
  assert.equal(count, 1601);
  db.close();
});
