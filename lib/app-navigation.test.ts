import assert from "node:assert/strict";
import { test } from "node:test";
import { appViews, sectionUrl, viewFromSection } from "./app-navigation.ts";

test("cada sección tiene una URL directa que se puede reconstruir tras F5", () => {
  for (const view of appViews.filter((item) => item !== "comunidad")) {
    assert.equal(viewFromSection(new URL(sectionUrl(view), "https://docentetuc.com.ar").searchParams.get("section")), view);
  }
  assert.equal(sectionUrl("comunidad"), "/comunidad");
  assert.equal(viewFromSection("desconocida"), "inicio");
});
