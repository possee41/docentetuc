import assert from "node:assert/strict";
import test from "node:test";
import { boardItems } from "./board-view.ts";
import { fact, newOfficial, withOfficial } from "./official-publication.ts";
import { readFileSync } from "node:fs";
import type { Publication } from "./types.ts";

const base = { id: "p", kind: "junta", category: "Padrones", starts_at: null, ends_at: null, updated_at: "2026-10-08", source_published_at: null } as Publication;
const now = new Date("2026-10-09T12:00:00Z");

test("Padrones y Comunicados permanecen en consultas separadas", () => {
  const padron = { ...base, id: "padron" }, comunicado = { ...base, id: "comunicado", category: "Comunicados" };
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

test("llamados: evidencia y vigencia, no solo clasificación; ambas vías conservan el mismo criterio", () => {
  const source = { id: "synthetic", source: "Junta", url: "https://example.invalid/aviso", excerpt: "Presentación directa" };
  const m = newOfficial("opportunity", "Primaria", [source]);
  m.topics = ["LLAMADO_ABIERTO"]; m.procedure = "direct";
  const row = () => ({ ...base, metadata: withOfficial("{}", m) });
  assert.equal(boardItems([row()], "llamados", now).length, 0);
  m.facts.registrationStart = fact("08/10/2026", source)!;
  m.facts.registrationEnd = fact("10/10/2026", source)!;
  assert.equal(boardItems([row()], "llamados", now).length, 1);
  m.procedure = "both";
  assert.equal(boardItems([row()], "llamados", now).length, 1);
  assert.equal(boardItems([row()], "llamados", new Date("2026-10-11T12:00:00Z")).length, 0);
  m.facts.registrationStart.status = "provisional";
  assert.equal(boardItems([row()], "llamados", now).length, 0);
  m.facts.registrationStart.status = "reported";
  assert.equal(boardItems([{ ...row(), removed_at: "2026-10-09" }], "llamados", now).length, 0);
  m.canonicalId = "other";
  assert.equal(boardItems([row()], "llamados", now).length, 0);
});

test("actos: próximos con evidencia, no provisionales, vencidos ni fechas en conflicto", () => {
  const source = { id: "synthetic", source: "Junta", url: "https://example.invalid/acto", excerpt: "Acto informado" };
  const m = newOfficial("event", "Primaria", [source]); m.topics = ["ACTO_DESIGNACION"];
  m.facts.designation = fact("09/10/2026 10:00", source)!;
  const row = () => ({ ...base, metadata: withOfficial("{}", m) });
  assert.equal(boardItems([row()], "actos", now).length, 1);
  assert.equal(boardItems([row()], "actos", new Date("2026-10-09T14:00:00Z")).length, 0);
  m.facts.designation.status = "conflict";
  assert.equal(boardItems([row()], "actos", now).length, 0);
  m.facts.designation.status = "provisional";
  assert.equal(boardItems([row()], "actos", now).length, 0);
});

test("Inicio filtra accesos con el mismo criterio y el menú conserva Actos y Llamados", () => {
  const home = readFileSync(new URL("../app/docente-app.tsx", import.meta.url), "utf8");
  const sidebar = readFileSync(new URL("../components/app-sidebar.tsx", import.meta.url), "utf8");
  assert.match(home, /visibleHomeShortcuts = homeShortcuts\.filter[\s\S]*?boardItems\(publications, view, now\)\.length > 0/u);
  assert.match(home, /visibleHomeShortcuts\.map/u);
  assert.match(sidebar, /\["actos", "Actos de designación"/u);
  assert.match(sidebar, /\["llamados", "Llamados abiertos"/u);
});
