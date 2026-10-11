import assert from "node:assert/strict";
import test from "node:test";
import { parseOfficialDate, procedureFromText, opportunityTopics, fact, newOfficial, withOfficial, confirmedEventTime, officialLifecycle, hasOfficialTopic } from "./official-publication.ts";
const source = { id: "sime:1", source: "SIME", url: "https://sime.educaciontuc.gov.ar/Vacantes/Detalle/1", excerpt: "" };
test("fechas válidas, sin inventar hora y conversión AM/PM", () => {
  assert.deepEqual(parseOfficialDate("15/10/2026"), { value: "2026-10-15", precision: "date" });
  assert.equal(parseOfficialDate("15/10/2026 12:00 p.m.")?.value, "2026-10-15T12:00:00-03:00");
  assert.equal(parseOfficialDate("15/10/2026 12:00 a.m.")?.value, "2026-10-15T00:00:00-03:00");
  for (const raw of ["31/02/2026", "15/13/2026", "15/10/2026 29:00", "15/10/26"]) assert.equal(parseOfficialDate(raw), null);
});
test("abierto no prueba inscripción online, ambas secciones exigen evidencia", () => {
  assert.deepEqual(opportunityTopics(procedureFromText("Presentarse directamente en Junta")), ["LLAMADO_ABIERTO"]);
  assert.deepEqual(opportunityTopics(procedureFromText("INSCRIPCIÓN SIME del 2 al 6. Presentación presencial de documentación.")), ["INSCRIPCION_SIME"]);
  assert.deepEqual(opportunityTopics(procedureFromText("INSCRIPCIÓN SIME del 2 al 6. Presentación directa ante Junta.")), ["INSCRIPCION_SIME", "LLAMADO_ABIERTO"]);
  assert.deepEqual(opportunityTopics(procedureFromText("")), ["CLASIFICACION_PENDIENTE"]);
  assert.equal(procedureFromText("Sin inscripción en SIME. Presentarse directamente."), "direct");
  assert.equal(hasOfficialTopic({ kind: "vacante", source: "SIME", category: "Llamado abierto" }, "INSCRIPCION_SIME"), false);
  assert.equal(hasOfficialTopic({ kind: "vacante", source: "SIME", category: "Vacante" }, "CLASIFICACION_PENDIENTE"), true);
});
test("el acto válido con horario provisional no autoriza recordatorio horario", () => {
  const m = newOfficial("event", "Técnica", [source]);
  m.facts.designation = fact("16/10/2026 09:00 a.m.", source, "HORARIO DE DESIGNACIÓN A CONFIRMAR EN COMUNICADOS")!;
  const item = { metadata: withOfficial("{}", m) };
  assert.equal(confirmedEventTime(item), null);
  assert.equal(officialLifecycle(item, new Date("2026-10-09T12:00:00Z")), "UPCOMING");
  m.facts.designation = fact("16/10/2026 09:00 a.m.", source)!;
  assert.equal(confirmedEventTime({ metadata: withOfficial("{}", m) }), "2026-10-16T09:00:00-03:00");
});
