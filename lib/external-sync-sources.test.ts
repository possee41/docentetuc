import assert from "node:assert/strict";
import test from "node:test";
import { externalSyncSources } from "./external-sync-sources.ts";

test("el corte externo es por fuente y conserva las otras", () => {
  assert.deepEqual([...externalSyncSources("sime, JUNTAS", "legacy")].sort(), ["Padrones y Comunicados", "SIME"]);
  assert.deepEqual([...externalSyncSources(undefined, "external")], ["Capacitación Docente"]);
  assert.equal(externalSyncSources(undefined, "legacy").size, 0);
});

test("una configuración inválida no puede reactivar un escritor legacy", () => {
  assert.throws(() => externalSyncSources("SIME,ERROR", "legacy"), /EXTERNAL_SYNC_SOURCES_INVALID/);
});
