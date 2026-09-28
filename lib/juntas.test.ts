import assert from "node:assert/strict";
import test from "node:test";
import { matchesCharacter, matchesJunta, normalizeCharacter, normalizeJunta, OFFICIAL_CHARACTERS, OFFICIAL_JUNTAS } from "./juntas.ts";

test("incluye los cuatro agrupamientos oficiales de Junta", () => {
  assert.deepEqual(OFFICIAL_JUNTAS.map(({ label }) => label), ["Inicial y Primaria", "Secundaria", "Técnica, Agrotécnica y No Formal", "Superior, Especial y Artística"]);
  assert.equal(normalizeJunta("Educación Técnica, Agrotécnica y No Formal"), "tecnica");
  assert.equal(normalizeJunta("Nivel superior especial y artística"), "superior-especial-artistica");
  assert.equal(matchesJunta({ junta: "Educación Secundaria", level: "" }, "secundaria"), true);
});

test("búsqueda de carácter ignora mayúsculas y acentos y admite titular", () => {
  assert.deepEqual(OFFICIAL_CHARACTERS, ["Interino", "Suplente", "Titular"]);
  assert.equal(normalizeCharacter("TITULAR"), "Titular");
  assert.equal(matchesCharacter("Designación interina", "Interino"), true);
  assert.equal(matchesCharacter("Suplencia", "Suplente"), true);
  assert.equal(matchesCharacter("Titular", "Suplente"), false);
});
