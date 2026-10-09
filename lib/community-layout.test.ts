import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../components/community-phase-3a.tsx", import.meta.url), "utf8");
const rulesCard = readFileSync(new URL("../components/community-rules-card.tsx", import.meta.url), "utf8");

test("las normas completas permanecen en una región desplazable accesible", () => {
  assert.match(source, /<CommunityRulesCard version=\{status\.rulesVersion\} text=\{status\.rulesText\} checked=\{normsChecked\}/);
  assert.match(rulesCard, /role="region" aria-label="Texto completo de las Normas de Comunidad" tabIndex=\{0\}/);
  assert.match(rulesCard, /max-h-48 overflow-y-auto/);
  assert.match(rulesCard, /\{text\}/);
  assert.match(rulesCard, /role="region"[\s\S]*?<\/div>\s*<label[\s\S]*?<button/);
  assert.match(rulesCard, /checked=\{checked\}/);
  assert.match(rulesCard, /disabled=\{!checked \|\| busy\}/);
  assert.match(rulesCard, /min-h-11 w-full/);
});

test("la tarjeta no se superpone a la cabecera y deja espacio bajo la navegación", () => {
  assert.match(source, /<main className="mx-auto mt-4/);
  assert.match(source, /pb-\[calc\(7rem\+env\(safe-area-inset-bottom\)\)\]/);
  assert.match(source, /aria-label="Texto completo de las Normas aceptadas" tabIndex=\{0\}/);
});
