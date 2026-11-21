import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { generateFdciCatalog, syntheticFdciFetch, publishLocalCatalog } from "./fdci-static-catalog.mjs";
import { buildFdciCatalog, validateFdciCatalog, createFdciCatalogReader } from "../lib/fdci-static-catalog.ts";
import { integrateFdciCatalog } from "../lib/fdci-catalog-integration.ts";
import { agendaEntries } from "../lib/agenda-view.ts";
import { profileMatch } from "../lib/matching.ts";
import { fdciLocalFixture } from "./fdci-local-fixture.mjs";
import { runFdciStaticCycle } from "./fdci-static-cycle.mjs";
const at = "2026-11-05T12:00:00.000Z", later = "2026-11-05T13:00:00.000Z", next = "2026-11-05T14:00:00.000Z";
const noop = async () => {};
async function dirs(t) {
  const root = resolve(tmpdir()), d = await mkdtemp(join(root, "fdci-integrated-"));
  t.after(async () => { assert.equal(dirname(resolve(d)), root); await rm(d, { recursive: true, force: true }); });
  return { workDirectory: join(d, "private"), publishDirectory: join(d, "public"), pause: noop };
}
const fixture = () => generateFdciCatalog(syntheticFdciFetch, at, noop);

test("opt-in DTOs retain public IDs, filters, links, dates; unknown update time is never replaced by feed check time", async () => {
  const { catalog } = await fixture(); catalog.items[0].level = "Primario"; catalog.items[0].area = "Matemática";
  const valid = await buildFdciCatalog(catalog.items, at);
  const merged = await integrateFdciCatalog([], valid, "ready"), p = merged.publications[0];
  assert.equal(p.id, catalog.items[0].id); assert.equal(p.official_url, catalog.items[0].officialUrl);
  assert.equal(p.registration_open_at, catalog.items[0].registrationOpenAt);
  assert.equal(p.updated_at, ""); assert.equal(merged.info[p.id].checkedAt, null);
  assert.equal(merged.info[p.id].canSave, false); assert.equal(merged.info[p.id].canRemind, false);
  assert.equal(merged.publications.filter(p => p.level === "Primario").length, 1);
  const matched = profileMatch(p, { levels: ["Primario"], areas: ["Matemática"] });
  assert.equal(matched.criteria.find(c => c.key === "level").outcome, "MATCH");
  assert.equal(matched.criteria.find(c => c.key === "area").outcome, "MATCH");
  assert.equal(profileMatch(p, { levels: ["Secundario"] }).criteria.find(c => c.key === "level").outcome, "NO_MATCH");
  assert.equal(merged.aiContext[0].url, p.official_url); assert.equal(JSON.parse(p.metadata).catalogOnly, true);
});

test("D1 records and admin edits win; saved IDs, Agenda and eligible reminders remain compatible on local SQLite", async t => {
  const { catalog } = await fixture(), projected = await integrateFdciCatalog([], catalog, "ready");
  const known = { ...projected.publications[0], id: "legacy-fdci-9000", title: "Edición administrativa", metadata: JSON.stringify({
    entity: "commission", trainingId: "100", commissionId: "9000", dateStatus: "confirmed", registrationHasTime: true,
    registrationOpensAt: "2099-01-01T08:00:00-03:00", registrationClosesAt: "2099-02-01T08:00:00-03:00" }), status: "próximamente", normalized_status: "UPCOMING" };
  const f = fdciLocalFixture(); t.after(() => f.sqlite.close()); f.sqlite.exec("PRAGMA foreign_keys=ON");
  f.sqlite.prepare("INSERT INTO publications(id,source,external_id,kind,category,title,official_url,content_hash) VALUES(?,?,?,?,?,?,?,?)")
    .run(known.id, known.source, known.external_id, known.kind, known.category, known.title, known.official_url, "a".repeat(64));
  f.sqlite.prepare("INSERT INTO saved_publications(user_id,publication_id,in_agenda) VALUES('synthetic-user',?,1)").run(known.id);
  f.sqlite.prepare("INSERT INTO training_reminders(id,user_id,training_id,publication_id,opens_at,precision,remind_at) VALUES('r','synthetic-user','100',?,'2099-01-01','datetime','2099-01-01')").run(known.id);
  const before = f.sqlite.prepare("SELECT total_changes() n").get().n;
  const merged = await integrateFdciCatalog([known], catalog, "ready");
  assert.equal(merged.publications.length, 2); assert.equal(merged.publications[0], known);
  assert(merged.info[known.id].canSave); assert(merged.info[known.id].canRemind);
  const saved = f.sqlite.prepare("SELECT * FROM saved_publications").get();
  assert.equal(agendaEntries(merged.publications, new Map([[known.id, saved]]), []).length, 1);
  assert.equal(f.sqlite.prepare("SELECT total_changes() n").get().n, before);
  assert.throws(() => f.sqlite.prepare("INSERT INTO saved_publications(user_id,publication_id) VALUES('synthetic-user',?)").run(catalog.items[1].id), /FOREIGN KEY/);
  const other = { ...known, id: catalog.items[1].id, source: "Otra fuente", external_id: "other" };
  const conflict = await integrateFdciCatalog([other], catalog, "ready"); assert.deepEqual(conflict.conflicts, [other.id]);
});

test("empty/stale composition never deletes existing publications, and v1/v2 observations distinguish check/change/source dates", async () => {
  const { catalog } = await fixture(); const known = { ...(await integrateFdciCatalog([], catalog, "ready")).publications[0], metadata: "{}" };
  const empty = await integrateFdciCatalog([known], await buildFdciCatalog([], later), "ready"); assert.deepEqual(empty.publications, [known]);
  const observations = Object.fromEntries(catalog.items.map(i => [i.id, { checkedAt: later, lastChangedAt: at }]));
  const v2 = await buildFdciCatalog(catalog.items, later, observations); assert.equal(v2.schemaVersion, 2);
  assert.deepEqual(await validateFdciCatalog(v2), v2);
  const composed = await integrateFdciCatalog([], v2, "stale");
  assert.equal(composed.info[known.id].checkedAt, later); assert.equal(composed.info[known.id].lastDetectedChangeAt, at);
  assert.equal(composed.info[known.id].sourceUpdatedAt, null); assert(composed.info[known.id].stale);
  assert.equal((await integrateFdciCatalog([], catalog, "ready", Date.parse(at) + 86_400_001)).catalogStatus, "stale");
  await assert.rejects(buildFdciCatalog(catalog.items, at, observations), /INVALID/);
});

function source(count = 6) {
  const rows = Array.from({ length: count }, (_, i) => ({ id: 9000 + i, capacitacion_id: 100 + i,
    fecha_apertura_preinscripcion: "2026-01-01 08:00:00", fecha_cierre_preinscripcion: "2099-12-01 08:00:00" }));
  return async (u, init) => {
    assert.equal(new URL(u).hostname, "apicapacitaciones.educaciontuc.edu.ar"); assert.equal(init.credentials, "omit");
    if (u.endsWith("getCapaActivas")) return Response.json([...rows].reverse());
    if (u.endsWith("getRestoCapas")) return Response.json(rows.map(r => ({ capacitacion_id: r.capacitacion_id, nombre: "Demo " + r.id, token: String(r.capacitacion_id), slug: "demo" })));
    return Response.json({ comisiones: rows.filter(r => String(r.capacitacion_id) === JSON.parse(init.body).token) });
  };
}
test("six-request slices persist across invocations, interruption preserves checkpoint/public catalog, then complete without omissions", async t => {
  const d = await dirs(t), { catalog } = await fixture(); await publishLocalCatalog(catalog, d.publishDirectory);
  const old = await readFile(join(d.publishDirectory, "catalog.json"), "utf8");
  const first = await runFdciStaticCycle({ ...d, fetcher: source(), checkedAt: at });
  assert.equal(first.status, "partial"); assert.equal(first.requests, 6); assert.equal(first.pending, 2);
  const cp = await readFile(join(d.workDirectory, "checkpoint.json"), "utf8");
  await assert.rejects(runFdciStaticCycle({ ...d, checkedAt: later, fetcher: async () => { throw Error("FDCI_CANCELLED"); } }));
  assert.equal(await readFile(join(d.workDirectory, "checkpoint.json"), "utf8"), cp);
  assert.equal(await readFile(join(d.publishDirectory, "catalog.json"), "utf8"), old);
  const done = await runFdciStaticCycle({ ...d, fetcher: source(), checkedAt: later });
  assert.equal(done.status, "complete"); assert.equal(done.items, 6); assert.equal(done.requests, 4);
  const result = await validateFdciCatalog(JSON.parse(await readFile(join(d.publishDirectory, "catalog.json"), "utf8")));
  assert.equal(new Set(result.items.map(i => i.id)).size, 6); assert.equal(result.observations[result.items[0].id].checkedAt, at);
  assert.equal(result.observations[result.items[5].id].checkedAt, later);
});

test("changed source membership restarts private scan without publishing partial data; public checkpoints forbidden", async t => {
  const d = await dirs(t), { catalog } = await fixture(); await publishLocalCatalog(catalog, d.publishDirectory);
  await runFdciStaticCycle({ ...d, fetcher: source(), checkedAt: at });
  const restart = await runFdciStaticCycle({ ...d, fetcher: source(7), checkedAt: later });
  assert.equal(restart.status, "restarted"); assert.equal(restart.requests, 1);
  assert.equal(JSON.parse(await readFile(join(d.publishDirectory, "catalog.json"), "utf8")).sha256, catalog.sha256);
  await assert.rejects(runFdciStaticCycle({ ...d, workDirectory: join(d.publishDirectory, "private"), fetcher: source(), checkedAt: next }), /MUST_NOT_BE_PUBLIC/);
});

test("repeated full scans preserve detected-change dates while advancing each record's checked date", async t => {
  const d = await dirs(t);
  await runFdciStaticCycle({ ...d, fetcher: source(2), checkedAt: at });
  const before = JSON.parse(await readFile(join(d.publishDirectory, "catalog.json"), "utf8"));
  await runFdciStaticCycle({ ...d, fetcher: source(2), checkedAt: later });
  const after = JSON.parse(await readFile(join(d.publishDirectory, "catalog.json"), "utf8"));
  assert.equal(after.version, before.version);
  assert.equal(after.observations[after.items[0].id].checkedAt, later);
  assert.equal(after.observations[after.items[0].id].lastChangedAt, at);
});

test("concurrent collectors cannot overwrite the private cursor", async t => {
  const d = await dirs(t); let entered, release;
  const locked = new Promise(r => { entered = r; }), wait = new Promise(r => { release = r; });
  const first = runFdciStaticCycle({ ...d, checkedAt: at, fetcher: async (...args) => { entered(); await wait; return source(2)(...args); } });
  await locked;
  try { await assert.rejects(runFdciStaticCycle({ ...d, fetcher: source(2), checkedAt: later }), /EEXIST/); }
  finally { release(); await first; }
  const state = JSON.parse(await readFile(join(d.workDirectory, "checkpoint.json"), "utf8"));
  assert.equal(state.data.lastCheckAt, at);
});

test("reader recovers a last-known-good version after corruption/unavailability and labels outdated data", async () => {
  const { catalog } = await fixture(); let response = catalog, failed = false, clock = Date.parse(at);
  const read = createFdciCatalogReader("https://possee41.github.io/docentetuc-fdci-catalog-pilot/catalog.json", async () => {
    if (failed) throw Error("synthetic network failure"); return Response.json(response);
  }, () => clock);
  assert.equal((await read()).status, "ready"); response = { ...catalog, sha256: "corrupt" };
  assert.equal((await read()).status, "stale"); failed = true; assert.equal((await read()).items.length, 2);
  failed = false; response = catalog; assert.equal((await read()).status, "ready"); clock += 86_400_001;
  assert.equal((await read()).status, "stale");
});
