import assert from "node:assert/strict";
import test from "node:test";
import { parseBoardPlacements } from "./board-sources.ts";
test("portal preserva repeticiones, etiquetas y resourcekey sin reinterpretarlas", () => {
  const url = "https://drive.google.com/drive/folders/shared?resourcekey=0-key";
  const html = ["Educación Inicial y Primaria", "Educación Secundaria", "Técnica Agrotécnica", "Nivel Superior Especial"].map(h => `<h4>${h}</h4><a href="${url}">padrones</a>`).join("");
  const rows = parseBoardPlacements(html);
  assert.equal(rows.length, 4);
  assert.ok(rows.every(x => x.url === url && x.label === "padrones"));
  assert.equal(new Set(rows.map(x => x.junta)).size, 4);
  assert.throws(() => parseBoardPlacements("<h4>Educación Inicial</h4>"), /FORMAT_CHANGED/);
});
