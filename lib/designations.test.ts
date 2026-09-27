import assert from "node:assert/strict";
import test from "node:test";
import { designationFacts } from "./designations.ts";

test("recupera cargo y establecimiento sin inventar campos ausentes", () => {
  const facts = designationFacts({ title: "ESCUELA X - CAPITAL - PROFESOR DE PSICOLOGÍA", area: "Psicología", location: "", shift: "Mañana", junta: "Secundaria", official_url: "https://sime.educaciontuc.gov.ar/x" });
  assert.equal(facts.school, "ESCUELA X - CAPITAL");
  assert.equal(facts.role, "PROFESOR DE PSICOLOGÍA");
  assert.equal(facts.locality, "CAPITAL");
});

test("separa establecimiento y cargo en los títulos SIME de dos partes", () => {
  const facts = designationFacts({ title: "ESCUELA X - 2HS MATEMÁTICA", area: "Matemática", location: "", shift: "Tarde", junta: "Secundaria", official_url: "https://sime.educaciontuc.gov.ar/x" });
  assert.equal(facts.school, "ESCUELA X");
  assert.equal(facts.role, "2HS MATEMÁTICA");
  assert.equal(facts.locality, "");
});

