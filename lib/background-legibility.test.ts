import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("el logo de fondo permanece pequeño y tenue en móvil y escritorio", () => {
  assert.match(css, /\.app-watermark\s*\{[^}]*min\(34vw, 300px\)[^}]*opacity:\s*\.05;/);
  assert.match(css, /\.app-watermark\s*\{[^}]*background-size:\s*min\(55vw, 210px\)/);
  assert.match(css, /\[data-theme="dark"\] \.app-watermark\s*\{[^}]*opacity:\s*\.05;/);
  assert.match(css, /\.app-detail-surface\s*\{[^}]*min\(40vw, 300px\)/);
});

test("las superficies de lectura son mayormente sólidas en ambos temas", () => {
  for (const property of ["surface-primary", "surface-secondary", "surface-glass", "input-background"]) {
    const values = [...css.matchAll(new RegExp(`--${property}:\\s*rgb\\([^;]*?/\\s*(\\.\\d+)\\)`, "g"))];
    assert.equal(values.length, 2, `se esperan valores claro y oscuro de ${property}`);
    for (const value of values) assert.ok(Number(value[1]) >= 0.9, `${property} debe cubrir el logo`);
  }
});
