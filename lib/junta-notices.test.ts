import assert from "node:assert/strict";
import test from "node:test";
import { classifyDriveReference, extractJuntaNotices, splitNoticeBlocks } from "./junta-notices.ts";
import { officialMetadata, type CollectedPublication } from "./official-publication.ts";
const root = { id: "padrones:com-tecnica", externalId: "com-tecnica", junta: "Técnica", officialUrl: "https://docs.google.com/document/d/official/edit", kind: "junta", category: "Comunicados" } as CollectedPublication;
test("segmenta antes del límite de 40k y conserva avisos independientes", () => {
  const raw = `Menú\nCOMUNICADO\n09/10/2026\nInstructivo general ${"texto ".repeat(7500)}\nCOMUNICADO\n08/10/2026\nFECHA DE DESIGNACIÓN: 14/10/2026\nLUGAR: Av Colón 451\nHORA: 09:00 HS.\nCOMUNICADO\n07/10/2026\nActo de elección de los miembros del jurado`;
  const rows = extractJuntaNotices(root, raw);
  assert.equal(rows.length, 3);
  assert.equal(officialMetadata(rows[1])?.entity, "event");
  assert.equal(officialMetadata(rows[1])?.facts.designation.value, "2026-10-14T09:00:00-03:00");
  assert.deepEqual(officialMetadata(rows[2])?.topics, ["OTRO_COMUNICADO"]);
  assert.equal(splitNoticeBlocks("Menú sin límites reconocibles").length, 0);
});
test("IDs no dependen del orden ni del horario de designación", () => {
  const raw = "COMUNICADO\n09/10/2026\nFECHA DE DESIGNACIÓN: 14/10/2026\nHORA: 09:00";
  const row = extractJuntaNotices(root, raw)[0];
  const changed = extractJuntaNotices(root, `COMUNICADO\n10/10/2026\nAviso distinto\n${raw.replace("09:00", "10:00")}`, [row]);
  assert.equal(changed[1].id, row.id);
});
test("reprogramación separa fecha anterior y nueva sin inventar hora", () => {
  const row = extractJuntaNotices(root, "COMUNICADO\n07/10/2026\nReprogramación de designaciones\nLas vacantes publicadas para ser designadas el día 12/10/2026, pasarán para el día martes 13/10/2026 en los horarios establecidos por cada Cabecera.")[0];
  const m = officialMetadata(row)!;
  assert.equal(m.correction, true);
  assert.equal(m.facts.previousDesignation.value, "2026-10-12");
  assert.equal(m.facts.designation.value, "2026-10-13");
});
test("instrucciones de llamados no son convocatoria; padrón de llamado no es llamado", () => {
  const row = extractJuntaNotices(root, "COMUNICADO DE PRENSA\n09/10/2026\nPASOS A SEGUIR PARA PARTICIPAR EN LLAMADOS ABIERTOS\n1º INSCRIPCIÓN EN PÁGINA SIME")[0];
  assert.deepEqual(officialMetadata(row)?.topics, ["OTRO_COMUNICADO"]);
  const file = classifyDriveReference({ ...root, title: "PADRON DEFINITIVO LLAMADO ABIERTO", category: "Llamados abiertos" }, "application/pdf");
  assert.deepEqual(officialMetadata(file)?.topics, ["PADRON"]);
  assert.equal(officialMetadata(classifyDriveReference(file, "application/vnd.google-apps.folder"))?.entity, "reference");
});
