import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../app/docente-app.tsx", import.meta.url), "utf8");
const account = readFileSync(new URL("../components/account-sign-in-section.tsx", import.meta.url), "utf8");
const serviceWorker = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

test("Actualizar termina aunque /api/sync no responda y resume fuentes parciales", () => {
  assert.match(app, /fetch\("\/api\/sync"[^\n]+AbortSignal\.timeout\(60_000\)/);
  assert.match(app, /finally \{ setSyncing\(false\); \}/);
  assert.match(app, /fuentes verificadas; \$\{result\.failures\} pendientes o no disponibles/);
});

test("Cuenta y la carga inicial tienen límites y ofrecen reintento", () => {
  assert.match(app, /fetch\("\/api\/app"[^\n]+AbortSignal\.timeout\(15000\)/);
  assert.match(app, /fetch\("\/api\/installations\/credential"[^\n]+AbortSignal\.timeout\(15000\)/);
  assert.match(account, /fetch\("\/api\/auth\/status"[^\n]+AbortSignal\.timeout\(15_000\)/);
  assert.match(account, /statusError \? <div role="alert"[^\n]+Reintentar/);
  assert.match(serviceWorker, /event\.request\.mode === "navigate" \? \{ signal: AbortSignal\.timeout\(15_000\) \}/);
});
