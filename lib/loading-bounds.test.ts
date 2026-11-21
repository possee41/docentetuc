import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../app/docente-app.tsx", import.meta.url), "utf8");
const account = readFileSync(new URL("../components/account-sign-in-section.tsx", import.meta.url), "utf8");
const serviceWorker = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

test("Recargar no dispara el sincronizador legacy desde el navegador", () => {
  assert.doesNotMatch(app, /fetch\("\/api\/sync"/);
  assert.doesNotMatch(app, /syncIfPublicEmpty|autoSyncStarted/);
  assert.match(app, /const refreshed = await loadPublic\(\)/);
  assert.match(app, /await loadRef\.current\(false\)/);
  assert.match(app, /if \(refreshed\) toast\.success\("Información pública recargada"\)/);
  assert.match(app, /finally \{ setSyncing\(false\); \}/);
});

test("Cuenta y la carga inicial tienen límites y ofrecen reintento", () => {
  assert.match(app, /fetch\("\/api\/app"[^\n]+AbortSignal\.timeout\(15000\)/);
  assert.match(app, /fetch\("\/api\/installations\/credential"[^\n]+AbortSignal\.timeout\(15000\)/);
  assert.match(account, /fetch\("\/api\/auth\/status"[^\n]+AbortSignal\.timeout\(15_000\)/);
  assert.match(account, /statusError \? <div role="alert"[^\n]+Reintentar/);
  assert.match(serviceWorker, /event\.request\.mode === "navigate" \? \{ signal: AbortSignal\.timeout\(15_000\) \}/);
});
