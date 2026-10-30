// Full local application; synthetic read-only API fixtures. Never calls a remote service or writes D1.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); }
catch { playwright = require(join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright")); }
const origin = "http://localhost:5173", output = resolve(".wrangler/agenda-background-review");
mkdirSync(output, { recursive: true });
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const other = `${today.slice(0, 8)}${String(Number(today.slice(-2)) < 15 ? Number(today.slice(-2)) + 1 : Number(today.slice(-2)) - 1).padStart(2, "0")}`;
const empty = { profile: null, publications: [], personalPublications: [], saved: [], notifications: [], reminders: [], designations: [], manualEvents: [], sync: [] };
const events = [today, other].map((day, i) => ({ id: `background-local-${i}`, user_id: "synthetic-local", title: "PRUEBA LOCAL — Actividad de Agenda",
  notes: "Datos sintéticos para revisar el fondo; no corresponden a docentes reales.", category: "Escuela", starts_at: `${day}T15:00:00Z`,
  all_day: 0, recurrence: "none", reminder_minutes: null, reminder_at: null, reminder_notified: 0 }));
const browser = await playwright.chromium.launch({ channel: "msedge", headless: true, args: ["--disable-background-networking"] });
const results = [];
try {
  for (const [device, viewport] of [["mobile", { width: 390, height: 844 }], ["desktop", { width: 1440, height: 1000 }]]) {
    for (const theme of ["light", "dark"]) for (const populated of [true, false]) {
      const context = await browser.newContext({ viewport, serviceWorkers: "block", timezoneId: "America/Argentina/Buenos_Aires" });
      await context.addInitScript(({ theme }) => {
        localStorage.setItem("docentetuc-theme", theme);
        localStorage.setItem("docentetuc-device-id", "11111111-1111-4111-8111-111111111111");
      }, { theme });
      await context.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== origin) return route.abort();
        if (!url.pathname.startsWith("/api/")) return route.continue();
        let body;
        if (url.pathname === "/api/installations/credential") body = { status: "ready", deviceId: "11111111-1111-4111-8111-111111111111" };
        else {
          assert.equal(request.method(), "GET", "NO_MUTATIONS_IN_VISUAL_TEST");
          if (url.pathname === "/api/app") body = { ...empty, manualEvents: populated ? events : [] };
          else if (url.pathname === "/api/public-app") body = empty;
          else if (url.pathname === "/api/auth/status") body = { authenticated: true, image: null };
          else if (url.pathname === "/api/auth/link") body = { linked: false };
          else if (["/api/news", "/api/notices"].includes(url.pathname)) body = { items: [] };
          else if (url.pathname === "/api/ai") body = { configured: false };
          else throw Error(`UNEXPECTED_LOCAL_API_${url.pathname}`);
        }
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      });
      const page = await context.newPage(), errors = [];
      page.on("pageerror", e => errors.push(e.message));
      await page.goto(`${origin}/?section=agenda`);
      const calendar = page.locator(".agenda-ui-calendar--classroom");
      await calendar.waitFor();
      const image = await page.evaluate(async () => {
        const image = new Image(); image.src = "/assets/docentetuc/agenda-classroom.webp";
        await image.decode(); return { width: image.naturalWidth, height: image.naturalHeight };
      });
      assert.deepEqual(image, { width: 1448, height: 1086 });
      const target = page.locator(".agenda-ui-day").filter({ has: page.locator("strong", { hasText: new RegExp(`^${Number(other.slice(-2))}$`) }) });
      await target.click();
      assert.equal(await target.getAttribute("aria-pressed"), "true");
      assert.equal(await page.locator('.agenda-ui-day[aria-current="date"]').count(), 1);
      assert.equal(await page.locator(".agenda-ui-count").count(), populated ? 2 : 0);
      assert.equal(await page.locator(".agenda-ui-card").count(), populated ? 1 : 0);
      if (!populated) await page.getByRole("heading", { name: "Este día está libre" }).waitFor();
      await calendar.evaluate(element => element.scrollIntoView({ block: "start" }));
      await page.waitForTimeout(300); // Let the existing selection/theme transitions settle.
      const layout = await calendar.evaluate(element => ({
        width: element.getBoundingClientRect().width, viewport: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth,
        background: getComputedStyle(element).backgroundImage, size: getComputedStyle(element).backgroundSize,
        theme: document.documentElement.dataset.theme,
        selectedBackground: getComputedStyle(element.querySelector(".is-selected")).backgroundColor,
        todayBorder: getComputedStyle(element.querySelector(".is-today")).borderTopColor,
        coveredDays: [...element.querySelectorAll(".agenda-ui-day")].filter(day => {
          const bounds = day.getBoundingClientRect();
          return document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)?.closest(".agenda-ui-day") !== day;
        }).length,
      }));
      assert.equal(layout.overflow, false); assert.ok(layout.width <= viewport.width); assert.equal(layout.theme, theme);
      assert.equal(layout.coveredDays, 0, "CALENDAR_DAYS_MUST_NOT_BE_COVERED");
      assert.match(layout.background, /agenda-classroom\.webp/); assert.equal(layout.selectedBackground, "rgb(8, 120, 190)");
      assert.equal(layout.todayBorder, "rgb(39, 168, 242)");
      const name = `${device}-${theme}-${populated ? "events" : "empty"}`;
      await page.screenshot({ path: join(output, `${name}-app.png`), animations: "disabled" });
      await calendar.screenshot({ path: join(output, `${name}-calendar.png`), animations: "disabled" });
      // Scoped decoration must disappear from Week and Agenda; navigation still works.
      await page.locator(".agenda-ui-tabs").getByRole("button", { name: "Semana", exact: true }).click();
      assert.equal(await page.locator(".agenda-ui-calendar--classroom").count(), 0);
      assert.equal(await page.locator(".agenda-ui-calendar").evaluate(e => getComputedStyle(e).backgroundImage), "none");
      await page.locator(".agenda-ui-tabs").getByRole("button", { name: "Agenda", exact: true }).click();
      assert.equal(await page.locator(".agenda-ui-calendar").count(), 0);
      await page.locator(".agenda-ui-tabs").getByRole("button", { name: "Mes", exact: true }).click(); await calendar.waitFor();
      assert.deepEqual(errors, []);
      results.push({ name, image, ...layout, pageErrors: errors });
      await context.close();
    }
  }
  writeFileSync(join(output, "result.json"), JSON.stringify({ ok: true, syntheticReadOnlyApis: true, remoteAccess: false, results }, null, 2));
  console.log(JSON.stringify({ ok: true, cases: results.length, horizontalOverflow: false, screenshots: output, remoteAccess: false }));
} finally { await browser.close(); }
