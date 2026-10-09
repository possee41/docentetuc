import assert from "node:assert/strict";
import test from "node:test";
import { boardItems } from "./board-view.ts";
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
