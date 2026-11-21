import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../components/community-phase-3a.tsx", import.meta.url), "utf8");
const rulesCard = readFileSync(new URL("../components/community-rules-card.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("../components/app-sidebar.tsx", import.meta.url), "utf8");
const admin = readFileSync(new URL("../components/community-admin-panel.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

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

test("la barra inferior de Comunidad queda limitada a móvil", () => {
  assert.match(source, /pb-\[calc\(7rem\+env\(safe-area-inset-bottom\)\)\] text-\[#0c2d5b\] md:pb-8/);
  assert.match(source, /aria-label="Navegación principal" className="[^"]*md:hidden"/);
  assert.match(sidebar, /\["inicio", "comunidad", "agenda", "perfil", "cuentas"\]\.includes\(id\) \? "max-md:hidden"/);
});

test("la navegación inferior de Comunidad utiliza enlaces nativos operativos", () => {
  assert.doesNotMatch(source, /from "next\/link"/);
  assert.match(source, /aria-label="Navegación principal"[\s\S]*?\.map\(\(\{ label, href, icon: Icon \}\) => <a key=\{label\} href=\{href\}/);
});

test("Comunidad recupera el tema al entrar directamente y mantiene contraste en vistas y controles", () => {
  assert.match(source, /localStorage\.getItem\("docentetuc-theme"\)/);
  assert.match(source, /document\.documentElement\.dataset\.theme =/);
  assert.match(source, /className="community-theme min-h-dvh/);
  assert.match(admin, /className=\{`community-theme /);
  assert.match(styles, /\[data-theme="dark"\] \.community-theme \[class\*="bg-white\/"\]/);
  assert.match(styles, /\[data-theme="dark"\] \.community-theme :is\(textarea, select, input:not\(\[type="checkbox"\]\)\)/);
  assert.match(styles, /\[data-theme="dark"\] \.community-theme nav\[aria-label="Navegación principal"\]/);
});
