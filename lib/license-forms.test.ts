import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";
import { licenseForms } from "./license-forms.ts";

const expected = new Map([
  ["parte-licencias", "a557a8dc8d4a7e750ca248199e4ed9540be94192c19655af701ea76f43d9d9b6"],
  ["modelo-art-51f", "97ebb8bd506466b2011511624416930af0f70506980e2a898074f4b708204a46"],
]);

test("los formularios conservan exactamente los documentos aportados y enlaces públicos", async () => {
  assert.equal(licenseForms.length, 2);
  for (const form of licenseForms) {
    assert.match(form.href, /^\/documents\/[A-Za-z0-9_.-]+$/);
    const file = await readFile(new URL(`../public${form.href}`, import.meta.url));
    assert.equal(createHash("sha256").update(file).digest("hex"), expected.get(form.id));
    assert.ok(form.format === "PDF" ? file.subarray(0, 5).toString() === "%PDF-" : file.subarray(0, 2).toString() === "PK");
  }
});
