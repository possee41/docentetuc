import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { externalSyncSources, legacySyncPaused } from "./external-sync-sources.ts";

test("el corte externo es por fuente y conserva las otras", () => {
  assert.deepEqual([...externalSyncSources("sime, JUNTAS", "legacy")].sort(), ["Padrones y Comunicados", "SIME"]);
  assert.deepEqual([...externalSyncSources(undefined, "external")], ["Capacitación Docente"]);
  assert.equal(externalSyncSources(undefined, "legacy").size, 0);
  assert.deepEqual([...externalSyncSources("FDCI,SIME,JUNTAS,CENET,INFD", "legacy")].sort(),
    ["Capacitación Docente", "CeNET / INET", "INFoD / AulaS-TIC", "Padrones y Comunicados", "SIME"]);
});

test("una configuración inválida no puede reactivar un escritor legacy", () => {
  assert.throws(() => externalSyncSources("SIME,ERROR", "legacy"), /EXTERNAL_SYNC_SOURCES_INVALID/);
});

test("el endpoint autenticado de estado no puede iniciar el barrido legacy", () => {
  assert.equal(legacySyncPaused(undefined), false);
  assert.equal(legacySyncPaused("false"), false);
  assert.equal(legacySyncPaused("true"), true);
  const route = readFileSync(new URL("../app/api/sync/route.ts", import.meta.url), "utf8");
  const post = route.split("export async function POST(request: Request)")[1];
  assert.ok(post.indexOf("if (!scheduled) await currentUser(request)") < post.indexOf("readSyncHealth(getD1())"));
  assert.doesNotMatch(route, /runSync\(|collectSimePublications|trainingPublications|boardPublications/);
});
