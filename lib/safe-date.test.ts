import assert from "node:assert/strict";
import test from "node:test";
import { safeDate } from "./safe-date.ts";

test("ignora fechas inválidas sin derribar la aplicación", () => {
  assert.equal(safeDate("fecha no informada"), null);
  assert.equal(safeDate("2026-09-26")?.getDate(), 26);
  assert.equal(safeDate("2026-09-26 11:47:35Z")?.toISOString(), "2026-09-26T11:47:35.000Z");
});
