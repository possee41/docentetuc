// Existing local app, synthetic responses only. No remote APIs or catalog requests.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { buildFdciCatalog } from "../lib/fdci-static-catalog.ts";
import { buildFdciActiveVersion, FDCI_RAW_ACTIVE_URL } from "../lib/fdci-static-publication.ts";
import { integrateFdciCatalog } from "../lib/fdci-catalog-integration.ts";
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); }
catch { playwright = require(join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright")); }
const origin = "http://localhost:5186", output = ".wrangler/fdci-versioned-web-local";
mkdirSync(output, { recursive: true });
const at = new Date().toISOString();
const course = id => ({ id: `fdci:commission:${id}`, externalId: id, title: `CURSO SIMULADO LOCAL ${id}`,
  summary: "Fixture interceptada; nunca publicada", category: "Capacitaciones", level: "Primario", area: "Matemática",
  location: "Tucumán", character: "Gratuito", status: "Inscripción abierta", normalizedStatus: "ACTIVE",
  officialUrl: `https://capacitaciondocente.educaciontuc.gov.ar/comisiones/${id}`, registrationOpenAt: at,
  registrationCloseAt: null, startsAt: null, endsAt: null, sourceUpdatedAt: null });
const catalog = await buildFdciCatalog([course("101"), course("102")], at);
const empty = await buildFdciCatalog([], at);
async function pointer(c, generation) {
  return buildFdciActiveVersion({ generation, stateChecksum: "a".repeat(64), stateRevision: "b".repeat(40), codeSha: "c".repeat(40),
    catalogSha256: c.sha256, catalogUpdatedAt: c.updatedAt, lastAttempt: { at, status: "complete", error: null } });
}
const active = await pointer(catalog, 1), emptyActive = await pointer(empty, 2);
const known = { ...(await integrateFdciCatalog([], catalog, "ready")).publications[0], title: "D1 LOCAL CONSERVADO", metadata: "{}" };
let browser;
try {
  browser = await playwright.chromium.launch({ channel: "msedge", headless: true, args: ["--disable-background-networking"] });
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  let mode = "good", calls = 0, backend = [];
  const mutations = [], unexpected = [], errors = [];
  await context.route("**/*", route => {
    const r = route.request(), u = new URL(r.url());
    if (r.url() === FDCI_RAW_ACTIVE_URL || r.url().startsWith(new URL("versions/", FDCI_RAW_ACTIVE_URL).href)) {
      calls++; if (mode === "network") return route.abort();
      const current = mode === "empty" ? empty : catalog;
      const value = r.url() === FDCI_RAW_ACTIVE_URL ? mode === "empty" ? emptyActive : active :
        mode === "corrupt" ? { ...current, sha256: "bad" } : current;
      return route.fulfill({ status: 200, contentType: "text/plain", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(value) });
    }
    if (u.origin !== origin) { unexpected.push(u.origin); return route.abort(); }
    if (!u.pathname.startsWith("/api/")) return route.continue();
    if (r.method() !== "GET" && u.pathname !== "/api/installations/credential") mutations.push(u.pathname);
    const data = { profile: null, publications: backend, saved: [], notifications: [], reminders: [], designations: [], manualEvents: [], sync: [] };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(u.pathname === "/api/installations/credential"
      ? { status: "ready", deviceId: "11111111-1111-4111-8111-111111111111" } : data) });
  });
  const page = await context.newPage(); page.on("pageerror", e => errors.push(e.message));
  await page.goto(origin + "/?section=capacitaciones", { waitUntil: "networkidle" });
  assert.equal(calls, 0); assert.equal(await page.getByTestId("fdci-catalog-pilot").count(), 0);
  await page.goto(origin + "/?section=capacitaciones&fdciCatalogTest=1", { waitUntil: "networkidle" });
  const title = page.getByText("CURSO SIMULADO LOCAL 102", { exact: true }); await title.waitFor();
  await page.getByRole("button", { name: "FDCI", exact: true }).click(); assert.equal(await title.count(), 1);
  assert.equal(await page.getByRole("button", { name: /^(Guardar|Recordarme)$/ }).count(), 0);
  await page.getByRole("button", { name: "Ver", exact: true }).first().click();
  const dialog = page.getByRole("dialog"); await dialog.waitFor();
  assert.equal(await dialog.getByRole("button", { name: /Guardar|Agregar a mi agenda|Preguntar a IA|Recordarme/ }).count(), 0);
  assert(await dialog.locator('a[href*="capacitaciondocente.educaciontuc.gov.ar"]').count());
  await page.keyboard.press("Escape");
  for (mode of ["corrupt", "network"]) {
    await page.getByRole("button", { name: "Reintentar lectura del catálogo" }).click();
    await page.getByTestId("fdci-catalog-pilot").getByText(/Catálogo desactualizado/).waitFor(); await title.waitFor();
  }
  mode = "good"; backend = [known]; await page.reload({ waitUntil: "networkidle" });
  await page.getByText(known.title, { exact: true }).waitFor(); await title.waitFor();
  assert.equal(await page.getByText("CURSO SIMULADO LOCAL 101", { exact: true }).count(), 0);
  await page.screenshot({ path: output + "/mobile.png", fullPage: true });
  mode = "empty"; await page.getByRole("button", { name: "Reintentar lectura del catálogo" }).click();
  await title.waitFor({ state: "detached" }); await page.getByText(known.title, { exact: true }).waitFor();
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.screenshot({ path: output + "/desktop-empty-d1.png", fullPage: true });
  assert.deepEqual(mutations, []); assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
  const result = { ok: true, mockedCatalogRequests: calls, defaultOff: true, d1Priority: true, emptyPreservesD1: true,
    privateActionsHidden: true, lastGoodOnFailure: true, mutations, unexpected, pageErrors: errors };
  writeFileSync(output + "/result.json", JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser?.close(); }
