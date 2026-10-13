import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { appViews, sectionUrl, viewFromSection } from "./app-navigation.ts";

test("cada sección tiene una URL directa que se puede reconstruir tras F5", () => {
  for (const view of appViews.filter((item) => item !== "comunidad")) {
    assert.equal(viewFromSection(new URL(sectionUrl(view), "https://docentetuc.com.ar").searchParams.get("section")), view);
  }
  assert.equal(sectionUrl("comunidad"), "/comunidad");
  assert.equal(viewFromSection("desconocida"), "inicio");
});

for (const component of ["admin-panel", "community-admin-panel"]) {
  test(`${component}: Volver a Cuenta usa navegación nativa a la sección correcta`, () => {
    const source = readFileSync(new URL(`../components/${component}.tsx`, import.meta.url), "utf8");
    // Crossing back to DocenteApp must not depend on the failing client Link
    // transition (the same boundary already uses native links in Comunidad).
    const link = source.match(/<a\s+([^>]+)>← Volver a Cuenta<\/a>/u);
    assert.ok(link, "el retorno debe ser un enlace nativo, también sin el router cliente");
    const href = link[1].match(/href="([^"]+)"/u)?.[1];
    assert.equal(href, sectionUrl("cuentas"));
    assert.equal(viewFromSection(new URL(href!, "https://example.invalid").searchParams.get("section")), "cuentas");
    assert.doesNotMatch(link[1], /onClick|onPointerDown|onTouchStart/u);
  });
}
