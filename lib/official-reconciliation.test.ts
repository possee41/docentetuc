import assert from "node:assert/strict";
import test from "node:test";
import { extractJuntaNotices } from "./junta-notices.ts";
import { applySimeDetail, normalizeSimeVacancy } from "./sime-publications.ts";
import { officialMetadata, withOfficial, type CollectedPublication } from "./official-publication.ts";
import { officialChange, officialSavedLookup, reconcileOfficialPublications, relationStrength, resolveOfficialAlias } from "./official-reconciliation.ts";
const raw = { id: 1, codigo: "PDVC-20261009-142784", caracter: "SUPLENTE", fechaPublicacionInicio: "09/10/2026 18:00", fechaPublicacionFin: "14/10/2026 18:00", cargos: "[9000306/00] ESC.172 - MAESTRO DE JARDIN - 116 [TURNO TARDE]", abierto: true };
const root = { id: "padrones:com-primaria", source: "Padrones y Comunicados", externalId: "com-primaria", junta: "Inicial y Primaria", officialUrl: "https://docs.google.com/document/d/official/edit", kind: "junta", category: "Comunicados" } as CollectedPublication;
const vacancy = (date = "15/10/2026") => {
  const a = normalizeSimeVacancy(raw, root.junta, 1);
  applySimeDetail(a, { fechaDesignacion: date }, "2026-10-09");
  return normalizeSimeVacancy(raw, root.junta, 1, a.metadata);
};
test("mismo llamado en SIME y Junta da una oportunidad canónica con ambas evidencias", () => {
  const notice = extractJuntaNotices(root, `LLAMADO ABIERTO\n09/10/2026\n${raw.codigo}\nINSCRIPCIÓN SIME: 09/10/2026 al 14/10/2026`)[0];
  const rows = reconcileOfficialPublications([vacancy(), notice]);
  const sime = rows.find(x => x.id === "sime:1")!;
  assert.deepEqual(officialMetadata(sime)?.topics, ["INSCRIPCION_SIME", "LLAMADO_ABIERTO"]);
  assert.equal(officialMetadata(rows.find(x => x.id === notice.id)!)?.canonicalId, sime.id);
  assert.equal(resolveOfficialAlias(rows.find(x => x.id === notice.id)!, rows).id, "sime:1");
  assert.ok(officialMetadata(sime)!.sources.length >= 3);
});
test("códigos distintos impiden fusionar cargos iguales; datos faltantes no suman", () => {
  const a = officialMetadata(vacancy())!, b = structuredClone(a); b.codes = ["PDVC-20261009-123456"];
  assert.equal(relationStrength(a, b), "none");
  a.codes = []; b.codes = [];
  assert.notEqual(relationStrength(a, b), "strong");
});
test("reprogramación conserva ID del acto y no propaga la hora anterior", () => {
  const notice = extractJuntaNotices(root, "COMUNICADO\n07/10/2026\nReprogramación de designaciones\nLas vacantes para ser designadas el día 12/10/2026, pasarán para el día martes 13/10/2026.")[0];
  const rows = reconcileOfficialPublications([vacancy("12/10/2026 09:00 a.m."), notice]);
  const act = rows.find(x => x.id === "acto:sime:1")!;
  assert.equal(officialMetadata(act)?.facts.designation.value, "2026-10-13");
  assert.equal(act.startsAt, null);
});
test("conflicto de fechas no usa última descarga como prioridad", () => {
  const notice = extractJuntaNotices(root, `COMUNICADO\n09/10/2026\n${raw.codigo}\nFECHA DE DESIGNACIÓN: 16/10/2026`)[0];
  const act = reconcileOfficialPublications([vacancy(), notice]).find(x => x.id === "acto:sime:1")!;
  assert.equal(officialMetadata(act)?.facts.designation.status, "conflict");
  assert.equal(act.startsAt, null);
});
test("checkpoint de detalle no notifica, pero cambio de fecha sí", () => {
  const a = vacancy(), m = officialMetadata(a)!;
  m.detailAttemptedAt = "2026-10-10";
  assert.equal(officialChange(a.metadata, withOfficial(a.metadata, m)), false);
  m.facts.designation.value = "2026-10-16";
  assert.equal(officialChange(a.metadata, withOfficial(a.metadata, m)), true);
});
test("horario informado por SIME no queda confirmado si la Junta pide esperar", () => {
  const notice = extractJuntaNotices(root, `COMUNICADO\n09/10/2026\n${raw.codigo}\nHorarios de designación a confirmar en Comunicados.`)[0];
  const act = reconcileOfficialPublications([vacancy("15/10/2026 09:00 a.m."), notice]).find(x => x.id === "acto:sime:1")!;
  assert.equal(officialMetadata(act)?.facts.designation.status, "provisional");
  assert.equal(act.startsAt, null);
});
test("confirmación oficial de horario reemplaza el provisional, sin mover la fecha", () => {
  const a = vacancy("15/10/2026 09:00 a.m."), m = officialMetadata(a)!;
  m.facts.designation.status = "provisional"; a.metadata = withOfficial(a.metadata, m);
  const notice = extractJuntaNotices(root, `COMUNICADO\n09/10/2026\n${raw.codigo}\nHORARIO DE DESIGNACIÓN: 13:00`)[0];
  const act = reconcileOfficialPublications([a, notice]).find(x => x.id === "acto:sime:1")!;
  assert.equal(act.startsAt, "2026-10-15T13:00:00-03:00");
});
test("seguimiento y agenda de un alias conservan el ID almacenado", () => {
  const notice = extractJuntaNotices(root, `LLAMADO ABIERTO\n09/10/2026\n${raw.codigo}\nPresentarse directamente.`)[0];
  const rows = reconcileOfficialPublications([vacancy(), notice]);
  const lookup = officialSavedLookup([{ publication_id: notice.id, followed: true, in_agenda: true }], rows);
  assert.equal(lookup.get("sime:1")?.publication_id, notice.id);
  assert.equal(lookup.get("sime:1")?.followed, true);
});
