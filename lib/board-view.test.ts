import assert from "node:assert/strict";
import test from "node:test";
import { boardItems, isRecentTucumanNotice } from "./board-view.ts";
import { newOfficial, withOfficial } from "./official-publication.ts";
import type { Publication } from "./types.ts";

const base = { id: "p", kind: "junta", category: "Padrones", starts_at: null, ends_at: null, updated_at: "2026-10-08", source_published_at: null } as Publication;
const now = new Date("2026-10-09T12:00:00Z");

test("Padrones y Comunicados permanecen en consultas separadas", () => {
  const padron = { ...base, id: "padron" }, metadata = newOfficial("notice", "Inicial", []);
  metadata.topics = ["OTRO_COMUNICADO"];
  const comunicado = { ...base, id: "comunicado", category: "Comunicados", source_published_at: "2026-10-09", metadata: withOfficial("{}", metadata) };
  assert.deepEqual(boardItems([padron, comunicado], "padrones", now).map((item) => item.id), ["padron"]);
  assert.deepEqual(boardItems([padron, comunicado], "comunicados", now).map((item) => item.id), ["comunicado"]);
});

test("una carpeta o archivo de llamados sin fecha no se anuncia vigente", () => {
  const folder = { ...base, id: "padrones:abiertos-primaria", category: "Llamados abiertos" };
  const old = { ...base, id: "drive:old", category: "Llamados abiertos", starts_at: "2021-09-01T12:00:00Z" };
  const undated = { ...base, id: "drive:undated", category: "Llamados abiertos" };
  const current = { ...base, id: "call:current", category: "Llamados abiertos", starts_at: "2026-10-10T12:00:00Z" };
  assert.deepEqual(boardItems([folder, old, undated, current], "llamados", now).map((item) => item.id), ["call:current"]);
});

test("un acto exige clasificación y fecha explícita; no nace del documento completo", () => {
  const document = { ...base, id: "padrones:com-primaria", category: "Comunicados" };
  const act = { ...base, id: "act:1", category: "Actos de designación", starts_at: "2026-10-13T12:00:00Z" };
  assert.deepEqual(boardItems([document, act], "actos", now).map((item) => item.id), ["act:1"]);
});

test("Comunicados solo muestra avisos individuales de hoy y ayer en Tucumán", () => {
  const now = new Date("2026-11-27T02:00:00Z"); // 26/11 23:00 en Tucumán
  const notice = (id: string, day: string) => { const metadata = newOfficial("notice", "Inicial", []); metadata.topics = ["OTRO_COMUNICADO"]; return { ...base, id, category: "Comunicados", source_published_at: day, metadata: withOfficial("{}", metadata) }; };
  const recent = notice("recent", "2026-11-25");
  const old = notice("old", "2026-11-24");
  assert.deepEqual(boardItems([recent, old], "comunicados", now).map(x => x.id), ["recent"]);
  assert.equal(isRecentTucumanNotice("2026-11-26", now), true);
  assert.equal(isRecentTucumanNotice("2026-11-27", now), false);
});

test("los llamados antiguos con vigencia futura y los trámites por clasificar siguen visibles", () => {
  const callMetadata = newOfficial("opportunity", "Secundaria", []); callMetadata.topics = ["LLAMADO_ABIERTO"]; callMetadata.procedure = "direct";
  const pendingMetadata = newOfficial("notice", "Técnica", []); pendingMetadata.topics = ["CLASIFICACION_PENDIENTE"];
  const opportunity = { ...base, id: "call", category: "Llamados abiertos", source_published_at: "2020-01-01", metadata: withOfficial("{}", callMetadata) };
  const pending = { ...base, id: "pending", category: "Clasificación pendiente", metadata: withOfficial("{}", pendingMetadata) };
  assert.deepEqual(boardItems([opportunity, pending], "llamados", now).map(x => x.id), ["call", "pending"]);
  assert.deepEqual(boardItems([opportunity, pending], "comunicados", now), []);
});

test("una convocatoria con cierre oficial pasado deja de mostrarse como vigente", () => {
  const metadata = newOfficial("opportunity", "Secundaria", []); metadata.topics = ["LLAMADO_ABIERTO"];
  metadata.facts.registrationEnd = { value: "2026-10-08", precision: "date", status: "reported", evidence: [] };
  const expired = { ...base, id: "expired", category: "Llamados abiertos", metadata: withOfficial("{}", metadata) };
  assert.deepEqual(boardItems([expired], "llamados", now), []);
});
