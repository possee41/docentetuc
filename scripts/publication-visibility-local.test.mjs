// Real GET handlers bundled with an in-memory SQLite binding. No remote I/O or credentials.
import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { PUBLICATION_VISIBILITY_SQL, isPublicPublication } from "../lib/publication-visibility.ts";
import { FDCI_CANARY_SYNTHETIC_IDS } from "../lib/fdci-canary-synthetic.ts";
import { PERSONAL_PUBLICATIONS_QUERY } from "../lib/personal-publications.ts";
import { PERSONAL_CATALOG_SQL } from "../lib/personalized-catalog.ts";
import { adminPublications } from "../lib/admin-data.ts";
import { retrieveAIRecords } from "../lib/ai-retrieval.ts";
import { PADRON_PAGE_QUERY } from "../lib/padron-documents.ts";
import { boardItems } from "../lib/board-view.ts";
import { buildFdciCatalog } from "../lib/fdci-static-catalog.ts";
import { integrateFdciCatalog } from "../lib/fdci-catalog-integration.ts";
const require = createRequire(import.meta.url);
const { build } = require("../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild");
const handlers = {};
for (const [path, entry] of [["/api/public-app", "app/api/public-app/route.ts"], ["/api/search", "app/api/search/route.ts"],
  ["/api/boards", "app/api/boards/route.ts"], ["/api/boards/padrones", "app/api/boards/padrones/route.ts"]]) {
  const bundled = await build({ entryPoints: [entry], bundle: true, write: false, format: "esm", platform: "browser", target: "es2022",
    plugins: [{ name: "sqlite-only-bindings", setup(b) {
      b.onResolve({ filter: /^@\/db$|^cloudflare:workers$/ }, args => ({ path: args.path, namespace: "local" }));
      b.onLoad({ filter: /.*/, namespace: "local" }, args => ({ contents: args.path === "@/db"
        ? "export const getD1=()=>globalThis.__publicationVisibilityDb;"
        : "export const env={PUBLIC_APP_CACHE_ENABLED:'false'};" }));
      b.onResolve({ filter: /^@\// }, args => ({ path: resolve(args.path.slice(2) + ".ts") }));
    } }] });
  handlers[path] = (await import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64"))).GET;
}
const officialIds = ["fdci:commission:6432", "fdci:commission:6434"];
function fixture() {
  const raw = new DatabaseSync(":memory:"), queries = [];
  raw.exec(`CREATE TABLE publications(id TEXT PRIMARY KEY,source TEXT,external_id TEXT,kind TEXT,category TEXT,
    title TEXT,summary TEXT DEFAULT '',metadata TEXT,starts_at TEXT,ends_at TEXT,updated_at TEXT DEFAULT '2026-11-01',
    first_seen_at TEXT DEFAULT '2026-11-01',source_published_at TEXT,last_changed_at TEXT,removed_at TEXT,
    normalized_status TEXT DEFAULT 'CLOSED',registration_close_at TEXT,official_url TEXT DEFAULT '',status TEXT DEFAULT 'cerrada',
    level TEXT DEFAULT '',area TEXT DEFAULT '',junta TEXT DEFAULT '',location TEXT DEFAULT '',character TEXT DEFAULT '',
    source_circuit_raw TEXT DEFAULT '',shift TEXT DEFAULT '');
    CREATE TABLE sync_state(source TEXT,synced_at TEXT,last_attempt_at TEXT,last_successful_sync_at TEXT,sync_status TEXT);
    CREATE TABLE saved_publications(user_id TEXT,publication_id TEXT,in_agenda INTEGER,saved_at TEXT);
    CREATE TABLE training_reminders(user_id TEXT,publication_id TEXT,notified INTEGER);
    CREATE TABLE designation_tracking(user_id TEXT,publication_id TEXT);
    CREATE TABLE notifications(user_id TEXT,publication_id TEXT);`);
  const add = (id, metadata = "{}", title = id, kind = "capacitacion", category = "Capacitaciones", source = "Capacitación Docente") =>
    raw.prepare("INSERT INTO publications(id,external_id,source,kind,category,title,metadata) VALUES(?,?,?,?,?,?,?)")
      .run(id, id.split(":").at(-1), source, kind, category, title, metadata);
  officialIds.forEach(id => add(id));
  FDCI_CANARY_SYNTHETIC_IDS.forEach(id => add(id, "{}", "PRUEBA SINTÉTICA FDCI CURSOR B"));
  add("preview:training", '{"preview":true}', "PRUEBA LOCAL — capacitación");
  add("external:private", '{"catalogOnly":true}', "Curso privado catalogOnly");
  const database = { prepare(sql) {
    if (!/^SELECT\b/.test(sql.trimStart())) throw Error("NON_READ_ONLY_HANDLER_SQL");
    const statement = params => ({ bind: (...values) => statement(values),
      all: async () => { queries.push(sql); return { results: raw.prepare(sql).all(...params) }; },
      first: async () => { queries.push(sql); return raw.prepare(sql).get(...params) ?? null; } });
    return statement([]);
  } };
  globalThis.__publicationVisibilityDb = database;
  const get = async url => { const request = new Request("https://isolated.test" + url); const response = await handlers[new URL(request.url).pathname](request);
    assert.equal(response.status, 200); return response.json(); };
  return { raw, add, database, queries, get, close() { delete globalThis.__publicationVisibilityDb; raw.close(); } };
}

test("actual public API responses hide preview/catalogOnly and the five fixtures, preserving both official courses", async () => {
  const f = fixture();
  try {
    assert.deepEqual((await f.get("/api/public-app")).publications.map(p => p.id).sort(), officialIds);
    assert.deepEqual((await f.get("/api/search?kind=capacitacion")).items.map(p => p.id).sort(), officialIds);
    assert.deepEqual((await f.get("/api/search?q=PRUEBA")).items, []);
    for (const id of ["preview:training", "external:private", ...FDCI_CANARY_SYNTHETIC_IDS])
      assert.deepEqual((await f.get("/api/search?id=" + encodeURIComponent(id))).items, []);
    for (const id of officialIds) assert.equal((await f.get("/api/search?id=" + encodeURIComponent(id))).items[0]?.id, id);
    assert(!f.queries.some(sql => /profiles|saved_publications|training_reminders/.test(sql)));
  } finally { f.close(); }
});

test("SQL and presentation agree on true/1/canonical strings, malformed metadata and legitimate title words", async () => {
  const f = fixture();
  try {
    const values = [true, 1, "true", "1", false, 0, "false", "0", null, 2, [], {}];
    for (const flag of ["preview", "catalogOnly"]) for (const [i, value] of values.entries()) f.add(`${flag}:${i}`, JSON.stringify({ [flag]: value }), "PRUEBA DEMO SINTÉTICA legítima");
    for (const [i, metadata] of [null, "", "invalid{", "{}", "null", "[]", "0"].entries()) f.add(`unknown:${i}`, metadata);
    const all = f.raw.prepare("SELECT * FROM publications").all();
    const sqlVisible = f.raw.prepare("SELECT * FROM publications WHERE " + PUBLICATION_VISIBILITY_SQL).all().map(p => p.id).sort();
    assert.deepEqual(sqlVisible, all.filter(isPublicPublication).map(p => p.id).sort());
    for (const flag of ["preview", "catalogOnly"]) for (let i = 0; i < values.length; i++) assert.equal(sqlVisible.includes(`${flag}:${i}`), i >= 4);
    for (let i = 0; i < 7; i++) assert(sqlVisible.includes(`unknown:${i}`));
    const body = await f.get("/api/search?q=DEMO"); assert.equal(body.items.length, 16);
    assert.equal(new Set(body.items.map(p => p.id)).size, body.items.length);
    assert.deepEqual((await f.get("/api/public-app")).publications.map(p => p.id).sort(), sqlVisible);
  } finally { f.close(); }
});

test("actual Boards and Padrones endpoints apply the same policy before pagination", async () => {
  const f = fixture();
  try {
    for (const [view, category] of [["padrones", "Padrones"], ["comunicados", "Comunicados"], ["llamados", "Llamados abiertos"]]) {
      f.add(`${view}:ok`, "{}", "Documento oficial", "junta", category, "Padrones y Comunicados");
      f.add(`${view}:preview`, '{"preview":"true"}', "Documento de ensayo", "junta", category, "Padrones y Comunicados");
      f.add(`${view}:private`, '{"catalogOnly":1}', "Documento privado", "junta", category, "Padrones y Comunicados");
      const body = await f.get(`/api/boards?view=${view}${view === "llamados" ? "&mode=references" : ""}`);
      assert.deepEqual(body.items.map(p => p.id), [`${view}:ok`]);
    }
    f.add("padrones:invalid", "invalid{", "Padrón legítimo", "junta", "Padrones", "Padrones y Comunicados");
    assert.deepEqual((await f.get("/api/boards/padrones")).items.map(p => p.id).sort(), ["padrones:invalid", "padrones:ok"]);
    const rows = f.raw.prepare(PADRON_PAGE_QUERY).all("");
    assert.deepEqual(rows.map(p => p.id).sort(), ["padrones:invalid", "padrones:ok"]);
    assert.deepEqual(boardItems(f.raw.prepare("SELECT * FROM publications").all(), "padrones").map(p => p.id).sort(), ["padrones:invalid", "padrones:ok"]);
  } finally { f.close(); }
});

test("private and administrative reads retain authorized catalogOnly/preview records without mutation", async () => {
  const f = fixture();
  try {
    f.raw.exec("INSERT INTO saved_publications VALUES('owner','external:private',1,'2026-11-01'); INSERT INTO training_reminders VALUES('owner','external:private',0); INSERT INTO notifications VALUES('other','preview:training');");
    const before = f.raw.prepare("SELECT * FROM publications").all();
    const personal = f.raw.prepare(PERSONAL_PUBLICATIONS_QUERY).all("owner", "owner", "owner", "owner");
    assert.deepEqual(personal.map(p => p.id), ["external:private"]);
    const admin = await adminPublications(f.database, new URLSearchParams());
    assert(admin.some(p => p.title === "Curso privado catalogOnly")); assert(admin.some(p => p.title === "PRUEBA LOCAL — capacitación"));
    assert.deepEqual(f.raw.prepare("SELECT * FROM publications").all(), before);
    assert.equal(f.raw.prepare("SELECT notified FROM training_reminders").get().notified, 0);
  } finally { f.close(); }
});

test("personal discovery and public IA do not recover marked records by their independent queries", async () => {
  const f = fixture();
  try {
    assert.deepEqual(f.raw.prepare(PERSONAL_CATALOG_SQL).all("capacitacion", "").map(p => p.id), officialIds);
    const items = await retrieveAIRecords(f.database, "capacitaciones", { focusedId: "preview:training" });
    assert.deepEqual(items.map(p => p.id).sort(), officialIds);
  } finally { f.close(); }
});

test("versioned experimental composition filters D1 private rows but preserves external read-only projections", async () => {
  const f = fixture(), at = "2026-11-07T10:00:00.000Z";
  try {
    const current = f.raw.prepare("SELECT * FROM publications").all();
    const empty = await integrateFdciCatalog(current, await buildFdciCatalog([], at), "ready", Date.parse(at), 3);
    assert.deepEqual(empty.publications.map(p => p.id).sort(), officialIds);
    const input = { id: "fdci:commission:501", externalId: "501", title: "Curso para prueba local", summary: "", category: "Capacitaciones", level: "Primario", area: "", location: "", character: "",
      status: "cerrada", normalizedStatus: "CLOSED", officialUrl: "https://capacitaciondocente.educaciontuc.gov.ar/comisiones/501", registrationOpenAt: null, registrationCloseAt: null, startsAt: null, endsAt: null, sourceUpdatedAt: null };
    const merged = await integrateFdciCatalog(current, await buildFdciCatalog([input], at), "ready", Date.parse(at), 3);
    assert.equal(merged.publications.length, 3); assert.equal(merged.info[input.id].canSave, false);
    assert.equal(merged.info[input.id].canSchedule, false); assert.equal(merged.info[input.id].canRemind, false);
    assert.equal(JSON.parse(merged.publications.find(p => p.id === input.id).metadata).catalogOnly, true);
  } finally { f.close(); }
});
