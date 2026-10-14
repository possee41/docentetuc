import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { appViews, sectionUrl, shouldRevalidateAccount, viewFromSection } from "./app-navigation.ts";

test("cada sección tiene una URL directa que se puede reconstruir tras F5", () => {
  for (const view of appViews.filter((item) => item !== "comunidad")) {
    assert.equal(viewFromSection(new URL(sectionUrl(view), "https://docentetuc.com.ar").searchParams.get("section")), view);
  }
  assert.equal(sectionUrl("comunidad"), "/comunidad");
  assert.equal(viewFromSection("desconocida"), "inicio");
});

test("Cuenta sin error no revalida /api/app al entrar ni al volver", () => {
  assert.equal(shouldRevalidateAccount(null, "cuentas", false, false), false);
  assert.equal(shouldRevalidateAccount("inicio", "cuentas", false, false), false);
  assert.equal(shouldRevalidateAccount("cuentas", "cuentas", false, false), false);
});

test("Cuenta con error revalida una vez por entrada, sin duplicar una solicitud en curso", () => {
  assert.equal(shouldRevalidateAccount("inicio", "cuentas", true, false), true);
  assert.equal(shouldRevalidateAccount("inicio", "cuentas", true, true), false);
  assert.equal(shouldRevalidateAccount("cuentas", "cuentas", true, false), false);
  assert.equal(shouldRevalidateAccount("cuentas", "inicio", true, false), false);
});

test("Atrás/Adelante repetido no inicia solicitudes simultáneas ni un bucle tras fallar", () => {
  let previous: typeof appViews[number] | null = "inicio";
  let inFlight = false;
  let requests = 0;
  for (const current of ["cuentas", "inicio", "cuentas", "inicio", "cuentas"] as const) {
    if (shouldRevalidateAccount(previous, current, true, inFlight)) { requests++; inFlight = true; }
    previous = current;
  }
  assert.equal(requests, 1);
  inFlight = false;
  assert.equal(shouldRevalidateAccount("cuentas", "cuentas", true, inFlight), false);
  assert.equal(shouldRevalidateAccount("inicio", "cuentas", true, inFlight), true);
});

test("el loader existente limpia el aviso solo tras JSON válido y lo conserva si falla", () => {
  const source = readFileSync(new URL("../app/docente-app.tsx", import.meta.url), "utf8");
  const loader = source.split("const load = useCallback")[1]?.split("const syncSources = useCallback")[0];
  assert.ok(loader);
  assert.match(loader, /const result = await response\.json\(\) as AppData;[\s\S]*setData\(result\);\s*setLoadError\(""\);/u);
  assert.match(loader, /catch \{[^}]*setLoadError\("No pudimos cargar los datos privados en este momento\./u);
  const revalidation = source.split("const previous = previousAccountView.current;")[1]?.split("document.querySelector(\".app-background\")")[0];
  assert.ok(revalidation);
  assert.match(revalidation, /shouldRevalidateAccount\([^)]+\)/u);
  assert.match(revalidation, /load\(false, false\)\.finally/u);
  assert.doesNotMatch(revalidation, /fetch\(|\/api\/auth\/status|\/api\/installations\/credential|\/api\/auth\/link/u);
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
