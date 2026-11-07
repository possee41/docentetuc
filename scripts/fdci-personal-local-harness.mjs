// Test-only dependency injection. Never imported by app/runtime code or deployed.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { buildFdciCatalog } from "../lib/fdci-static-catalog.ts";
import { buildFdciActiveVersion, FDCI_RAW_ACTIVE_URL } from "../lib/fdci-static-publication.ts";
const require = createRequire(import.meta.url), { build } = require("../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild");
const bundle = await build({ entryPoints: ["app/api/app/route.ts"], bundle: true, write: false, platform: "browser", format: "esm", target: "es2022",
  plugins: [{ name: "local-auth-and-d1", setup(b) {
    b.onResolve({ filter: /^@\/db$|^@\/lib\/current-user$|^@\/lib\/auth-session$|^cloudflare:workers$/ }, args => ({ path: args.path, namespace: "test-only" }));
    b.onLoad({ filter: /.*/, namespace: "test-only" }, args => ({ contents: args.path === "@/db" ? "export const getD1=()=>globalThis.__fdciCase.db;"
      : args.path === "@/lib/current-user" ? "export const currentUser=r=>globalThis.__fdciCase.user(r); export const authError=e=>e?.message==='UNAUTHENTICATED';"
      : args.path === "@/lib/auth-session" ? "export const getAuthenticatedAccount=r=>globalThis.__fdciCase.account(r);"
      : "export const env=new Proxy({},{get:(_,k)=>globalThis.__fdciCase.env[k]});" }));
    b.onResolve({ filter: /^@\// }, args => ({ path: resolve(args.path.slice(2) + ".ts") }));
  } }] });
let serial = 0;
export async function createFdciPersonalHarness(databasePath = ":memory:") {
  const raw = new DatabaseSync(databasePath); raw.exec("PRAGMA foreign_keys=ON");
  for (const file of ["drizzle/0000_docentetuc.sql", "drizzle/0001_training_metadata.sql", "drizzle/0002_reminders_ai.sql", "drizzle/0003_web_push.sql",
    "migrations/0002_designations.sql", "migrations/0003_information_agenda.sql", "migrations/0004_agenda_reminders.sql", "migrations/0005_training_match_threshold.sql",
    "migrations/0006_manual_events.sql", "migrations/0007_manual_event_recurrence.sql", "migrations/0008_personal_matching_circuits.sql", "migrations/0009_reliability_lifecycle.sql", "migrations/0012_public_profiles.sql"])
    raw.exec(readFileSync(new URL("../" + file, import.meta.url), "utf8"));
  const realNow = Date.now, h = { raw, clock: realNow(), env: { FDCI_PERSONAL_ACTIONS_ENABLED: "true", FDCI_CANARY_TEST_ENVIRONMENT: "docentetuc-web-canary-1-2", FDCI_CANARY_TEST_USER_IDS: JSON.stringify(["test-a"]) }, requests: [], sql: [], failOnce: null, failFetch: false, beforeBatch: null };
  Date.now = () => h.clock;
  const execute = (sql, values, mode) => {
    h.sql.push({ operation: mode, sql });
    if (h.failOnce && sql.includes(h.failOnce)) { h.failOnce = null; throw Error("LOCAL_SYNTHETIC_SQL_FAILURE"); }
    const statement = raw.prepare(sql);
    return mode === "run" ? { meta: { changes: Number(statement.run(...values).changes) } }
      : mode === "first" ? statement.get(...values) ?? null : { results: statement.all(...values) };
  };
  h.db = { prepare(sql) { const bound = values => ({ bind: (...v) => bound(v), execute: () => execute(sql, values, "run"),
    run: async () => execute(sql, values, "run"), first: async () => execute(sql, values, "first"), all: async () => execute(sql, values, "all") }); return bound([]); },
  async batch(statements) { h.beforeBatch?.(); h.beforeBatch = null; raw.exec("BEGIN"); try { const results = statements.map(s => s.execute()); raw.exec("COMMIT"); return results; } catch (e) { raw.exec("ROLLBACK"); throw e; } } };
  h.user = async request => { const id = { "Bearer unit-session-a": "test-a", "Bearer unit-session-b": "test-b" }[request.headers.get("authorization")];
    if (!id) throw Error("UNAUTHENTICATED"); return { userId: id, fullName: "Docente de prueba", displayName: "Prueba", email: "" }; };
  h.account = async request => { if (h.noAccount) return null; try { return { accountId: (await h.user(request)).userId }; } catch { return null; } };
  h.course = { id: "fdci:commission:501", externalId: "501", title: "Capacitación verificada en fixture local", summary: "Solo SQLite local", category: "Capacitaciones", level: "Primario", area: "Matemática", location: "Tucumán", character: "Virtual", status: "próximamente", normalizedStatus: "UPCOMING",
    officialUrl: "https://capacitaciondocente.educaciontuc.gov.ar/comisiones/501", registrationOpenAt: new Date(h.clock + 3 * 86400000).toISOString(), registrationCloseAt: new Date(h.clock + 5 * 86400000).toISOString(), startsAt: null, endsAt: null, sourceUpdatedAt: null };
  h.setCatalog = async (items = [h.course], generation = 1, evidence = true) => {
    const at = new Date(h.clock).toISOString();
    h.catalog = await buildFdciCatalog(items, at, undefined, evidence ? Object.fromEntries(items.map(i => [i.id, { trainingId: "301", registrationHasTime: true, dateStatus: "confirmed", availablePreCapacity: 10 }])) : undefined);
    h.pointer = await buildFdciActiveVersion({ generation, stateChecksum: "a".repeat(64), stateRevision: "b".repeat(40), codeSha: "c".repeat(40), catalogSha256: h.catalog.sha256, catalogUpdatedAt: h.catalog.updatedAt, lastAttempt: { at, status: "complete", error: null } });
    h.reference = { generation, catalogSha256: h.catalog.sha256 };
  };
  await h.setCatalog();
  h.fetch = async (url, options) => { h.requests.push({ url: String(url), credentials: options?.credentials });
    if (h.failFetch) throw Error("LOCAL_NETWORK_FAILURE");
    if (String(url) === FDCI_RAW_ACTIVE_URL) return Response.json(h.pointer);
    if (String(url) === new URL(h.pointer.versionPath, FDCI_RAW_ACTIVE_URL).href) return Response.json(h.catalog);
    throw Error("UNEXPECTED_NETWORK_TARGET"); };
  globalThis.__fdciCase = h;
  const realFetch = globalThis.fetch; globalThis.fetch = h.fetch;
  try { h.handlers = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text + `\n// isolated-instance:${serial++}`).toString("base64")); }
  finally { globalThis.fetch = realFetch; }
  h.request = async (method, body, user = "a", origin = "http://localhost:5186") => {
    const start = performance.now();
    const request = new Request(origin + "/api/app", { method, headers: { Origin: origin, "Content-Type": "application/json", ...(user ? { Authorization: `Bearer unit-session-${user}` } : {}) }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}) });
    const response = await h.handlers[method](request), data = await response.json();
    return { status: response.status, body: data, localWallMs: performance.now() - start };
  };
  h.post = (body, user = "a") => h.request("POST", body, user);
  h.action = (action, extra = {}) => h.post({ action, publicationId: h.course.id, fdciCatalog: h.reference, ...extra });
  h.count = table => Number(raw.prepare(`SELECT count(*) AS n FROM ${table}`).get().n);
  h.close = () => { Date.now = realNow; delete globalThis.__fdciCase; raw.close(); };
  return h;
}
