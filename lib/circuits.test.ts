import assert from "node:assert/strict";
import test from "node:test";
import { circuitMatches, inferCircuit, profileCircuitIds, TUCUMAN_CIRCUITS } from "./circuits.ts";

test("mantiene la distribución oficial de los cinco circuitos territoriales", () => {
  assert.deepEqual(TUCUMAN_CIRCUITS.map(({ id, departments }) => [id, departments]), [
    ["I", ["Burruyacú", "Cruz Alta", "Leales"]],
    ["II", ["Capital", "San Miguel de Tucumán"]],
    ["III", ["Trancas", "Yerba Buena", "Tafí Viejo", "Lules"]],
    ["IV", ["Tafí del Valle", "Famaillá", "Monteros", "Simoca"]],
    ["V", ["Chicligasta", "Río Chico", "Juan Bautista Alberdi", "La Cocha", "Graneros"]],
  ]);
});

test("normaliza circuitos explícitos y conserva varias selecciones", () => {
  assert.equal(inferCircuit({ explicit: "Circuito III" }).normalizedCircuit, "III");
  assert.equal(inferCircuit({ explicit: "IV" }).normalizedCircuit, "IV");
  assert.deepEqual(inferCircuit({ explicit: "Circuitos II y III" }).circuits, ["II", "III"]);
  assert.deepEqual(profileCircuitIds(["Circuito II", "V"]), ["II", "V"]);
});

test("infiere desde departamento o localidad, y deja ubicaciones ambiguas sin resolver", () => {
  assert.equal(inferCircuit({ department: "Monteros" }).normalizedCircuit, "IV");
  assert.equal(inferCircuit({ locality: "Yerba Buena" }).normalizedCircuit, "III");
  assert.equal(inferCircuit({ locality: "Tafí Viejo" }).circuitInferenceSource, "locality");
  assert.equal(inferCircuit({ locality: "Tucumán" }).normalizedCircuit, "UNKNOWN");
  assert.equal(inferCircuit({ locality: "Yerba Buena y Monteros" }).normalizedCircuit, "MULTIPLE");
});

test("respeta una publicación para todos los circuitos y los circuitos seleccionados", () => {
  assert.equal(circuitMatches(inferCircuit({ explicit: "Todos los circuitos de la provincia" }), ["V"]), true);
  assert.equal(circuitMatches(inferCircuit({ explicit: "Circuito II y III" }), ["I", "III"]), true);
  assert.equal(circuitMatches(inferCircuit({ explicit: "Circuito V" }), ["II", "III"]), false);
  assert.equal(circuitMatches(inferCircuit({}), ["II"]), null);
});
