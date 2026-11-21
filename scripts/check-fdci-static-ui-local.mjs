// Real local app + intercepted synthetic APIs. Start npm run dev first.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { generateFdciCatalog, syntheticFdciFetch } from "./fdci-static-catalog.mjs";
import { integrateFdciCatalog, fdciPilotAllowed } from "../lib/fdci-catalog-integration.ts";
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); }
catch { playwright = require(join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright")); }
const origin = "http://localhost:5173", url = "https://possee41.github.io/docentetuc-fdci-catalog-pilot/catalog.json";
const output = ".wrangler/fdci-static-ui"; mkdirSync(output, { recursive: true });
const { catalog } = await generateFdciCatalog(syntheticFdciFetch, "2026-11-05T12:00:00.000Z", async () => {});
const known = { ...(await integrateFdciCatalog([], catalog, "ready")).publications[0], title: "REGISTRO D1 SINTÉTICO — prioridad", metadata: "{}" };
assert(!fdciPilotAllowed("docentetuc.com.ar", "?fdciCatalogTest=1"));
assert(!fdciPilotAllowed("localhost", "")); assert(fdciPilotAllowed("canary.docentetuc.com.ar", "?fdciCatalogTest=1"));
let browser;
try {
  browser = await playwright.chromium.launch({ channel: "msedge", headless: true, args: ["--disable-background-networking"] });
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  let mode = "good", catalogCalls = 0, backend = [];
  const mutations = [], errors = [];
  await context.route("**/*", route => {
    const r = route.request(), u = new URL(r.url());
    if (r.url() === url) {
      catalogCalls++;
      if (mode === "network") return route.abort();
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify(mode === "corrupt" ? { ...catalog, sha256: "corrupt" } : catalog) });
    }
    if (u.origin !== origin) return route.abort();
    if (!u.pathname.startsWith("/api/")) return route.continue();
    if (r.method() !== "GET" && u.pathname !== "/api/installations/credential") mutations.push(u.pathname);
    const empty = { profile: null, publications: backend, saved: [], notifications: [], reminders: [], designations: [], manualEvents: [], sync: [] };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(u.pathname === "/api/installations/credential"
      ? { status: "ready", deviceId: "11111111-1111-4111-8111-111111111111" } : empty) });
  });
  const page = await context.newPage(); page.on("pageerror", e => errors.push(e.message));
  await page.goto(origin + "/?section=capacitaciones", { waitUntil: "networkidle" });
  assert.equal(catalogCalls, 0); assert.equal(await page.getByTestId("fdci-catalog-pilot").count(), 0);
  await page.goto(origin + "/?section=capacitaciones&fdciCatalogTest=1", { waitUntil: "networkidle" });
  const title = page.getByText("DEMO SINTÉTICA — NO OFICIAL", { exact: true });
  await title.nth(1).waitFor(); assert.equal(await title.count(), 2);
  await page.getByRole("button", { name: "FDCI", exact: true }).click();
  assert.equal(await title.count(), 2);
  assert.equal(await page.getByRole("button", { name: "Guardar", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Recordarme", exact: true }).count(), 0);
  await page.screenshot({ path: output + "/mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Ver", exact: true }).first().click();
  const detail = page.getByRole("dialog"); await detail.waitFor();
  assert.equal(await detail.getByRole("button", { name: /Guardar|Agregar a mi agenda|Preguntar a IA|Recordarme/ }).count(), 0);
  const officialLinks = await detail.locator('a[href*="capacitaciondocente.educaciontuc.gov.ar"]').all();
  assert(officialLinks.length > 0);
  for (const link of officialLinks) assert.equal(new URL(await link.getAttribute("href")).hostname, "capacitaciondocente.educaciontuc.gov.ar");
  await page.keyboard.press("Escape");
  for (mode of ["corrupt", "network"]) {
    await page.getByRole("button", { name: "Reintentar lectura del catálogo" }).click();
    await page.getByTestId("fdci-catalog-pilot").getByText(/Catálogo desactualizado/).waitFor();
    assert.equal(await title.count(), 2);
  }
  mode = "good"; await page.getByRole("button", { name: "Reintentar lectura del catálogo" }).click();
  await page.waitForLoadState("networkidle"); assert.equal(await title.count(), 2);
  backend = [known]; await page.reload({ waitUntil: "networkidle" });
  await page.getByText(known.title, { exact: true }).waitFor();
  assert.equal(await title.count(), 1); assert.equal(await page.getByText(known.title, { exact: true }).count(), 1);
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.screenshot({ path: output + "/desktop-d1-priority.png", fullPage: true });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.emulateMedia({ colorScheme: "dark" }); await page.screenshot({ path: output + "/desktop-dark.png", fullPage: true });
  assert.deepEqual(mutations, []); assert.deepEqual(errors, []);
  const result = { ok: true, defaultOff: true, productionHostBlocked: true, twoSyntheticRecords: true,
    d1Priority: true, duplicateCount: 0, privateButtonsHidden: true, corruptAndNetworkRetainLastGood: true,
    fdciFilter: true, officialLinksPreserved: true,
    screenshots: ["mobile.png", "desktop-d1-priority.png", "desktop-dark.png"], pageErrors: errors,
    privateMutationRequests: mutations.length, externalRequestsAllowed: 0, catalogCalls };
  writeFileSync(output + "/result.json", JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser?.close(); }
