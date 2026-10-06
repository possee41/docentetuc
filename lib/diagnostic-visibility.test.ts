import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const appSource = await readFile(new URL("../app/docente-app.tsx", import.meta.url), "utf8");

test("la interfaz normal no expone el diagnóstico avanzado ni el estado del sistema", () => {
  assert.doesNotMatch(appSource, /Diagnóstico avanzado|Estado del sistema/);
});
