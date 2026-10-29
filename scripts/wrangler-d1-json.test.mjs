import assert from "node:assert/strict";
import test from "node:test";
import { parseWranglerD1Json } from "./wrangler-d1-json.mjs";

test("acepta salida JSON pura", () => {
  const stdout = JSON.stringify([{ success: true, meta: { changes: 1 } }]);
  assert.deepEqual(parseWranglerD1Json(stdout), [{ success: true, meta: { changes: 1 } }]);
});

test("extrae JSON rodeado de texto no JSON", () => {
  const payload = [{ success: true, meta: { changes: 2 } }];
  const stdout = `warn: something\n${JSON.stringify(payload)}\nDone.`;
  assert.deepEqual(parseWranglerD1Json(stdout), payload);
});

test("rechaza salida sin JSON", () => {
  assert.throws(() => parseWranglerD1Json("not json at all"), /WRANGLER_JSON_INVALID/);
});

test("rechaza JSON con success false", () => {
  const stdout = JSON.stringify([{ success: false, error: "boom" }]);
  assert.throws(() => parseWranglerD1Json(stdout), /WRANGLER_D1_RESULT_INVALID/);
});

test("rechaza JSON vacío", () => {
  assert.throws(() => parseWranglerD1Json("[]"), /WRANGLER_D1_RESULT_INVALID/);
});
