import assert from "node:assert/strict";
import test from "node:test";
import { classifyNotice, isGeneralNotice } from "./notice-classification.ts";
import { profileMatch } from "./matching.ts";

test("distingue comunicados generales, personalizados y no relacionados", () => {
  const general = { kind: "junta", category: "Comunicados", junta: "General", title: "Actualización institucional", summary: "Información para todos los docentes" };
  assert.equal(isGeneralNotice(general), true);
  assert.equal(classifyNotice(general, profileMatch(general, {})), "GENERAL");

  const personalized = { kind: "junta", category: "Comunicados", junta: "Secundaria", title: "Comunicado para docentes de Secundaria", summary: "Ciencias Sociales" };
  const match = profileMatch({ ...personalized, circuit: "II" }, { boards: ["Secundaria"], circuits: ["II"] });
  assert.equal(classifyNotice(personalized, match), "PERSONALIZADO");

  const weak = { kind: "junta", category: "Comunicados", junta: "Secundaria", title: "Comunicado de Educación Técnica", summary: "" };
  const weakMatch = profileMatch(weak, { levels: ["Secundaria"], areas: ["Ciencias Sociales"], circuits: ["II"] });
  assert.equal(weakMatch.score, 100);
  assert.equal(weakMatch.confidence, 50);
  assert.equal(classifyNotice(weak, weakMatch), "NO_RELACIONADO");
});
