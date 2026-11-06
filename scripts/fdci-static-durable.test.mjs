import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { catalogHash, buildFdciCatalog, createFdciCatalogReader } from "../lib/fdci-static-catalog.ts";
import { integrateFdciCatalog } from "../lib/fdci-catalog-integration.ts";
import { initialFdciState, validateDurableFdciState, migrateOfficialFdciArtifact, collectDurableFdciCycle,
  createFdciGitStateStore, fdciDurableView, FDCI_STATE_BRANCH, FDCI_STATE_REPOSITORY } from "./fdci-static-durable.mjs";
const sha = "a".repeat(40), at = "2026-11-06T12:00:00.000Z", later = "2026-11-06T13:00:00.000Z", next = "2026-11-06T14:00:00.000Z";
const gitSha = text => createHash("sha1").update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest("hex");
async function directory(t) {
  const parent = resolve(tmpdir()), root = await mkdtemp(join(parent, "fdci-durable-"));
  t.after(async () => { assert.equal(dirname(root), parent); await rm(root, { recursive: true, force: true }); });
  return root;
}
function source(count = 3, duplicate = false) {
  const rows = Array.from({ length: count }, (_, i) => ({ id: 9000 + i, capacitacion_id: 100 + i,
    fecha_apertura_preinscripcion: "2026-01-01 08:00:00", fecha_cierre_preinscripcion: "2099-12-01 08:00:00" }));
  return async (url, options) => Response.json(url.endsWith("getCapaActivas") ? duplicate ? [...rows, rows[0]] : rows
    : url.endsWith("getRestoCapas") ? rows.map(r => ({ capacitacion_id: r.capacitacion_id, nombre: "SINTÉTICO " + r.id, token: String(r.capacitacion_id), slug: "demo" }))
      : { comisiones: rows.filter(r => String(r.capacitacion_id) === JSON.parse(options.body).token) });
}
async function collect(state, root, count = 3, checkedAt = at, fetcher = source(count)) {
  return collectDurableFdciCycle({ state, root, fetcher, checkedAt, pause: async () => {} });
}
function server(initial) {
  let bytes = JSON.stringify(initial) + "\n", revision = gitSha(bytes);
  const control = { puts: 0, missing: false, corrupt: false, large: false, loseAck: null, urls: [] };
  const fetcher = async (url, options) => {
    const u = new URL(url); control.urls.push(u.href);
    assert.equal(u.origin, "https://api.github.com");
    assert.ok(u.pathname.startsWith(`/repos/${FDCI_STATE_REPOSITORY}/`));
    assert.equal(options.redirect, "error");
    if (options.method === "GET") {
      if (control.missing) return Response.json({}, { status: 404 });
      if (u.pathname.includes("/git/blobs/")) {
        assert.ok(u.pathname.endsWith(revision)); return Response.json({ encoding: "base64", content: Buffer.from(bytes).toString("base64") });
      }
      assert.equal(u.searchParams.get("ref"), FDCI_STATE_BRANCH);
      return Response.json({ type: "file", path: "fdci-state.json", sha: revision, size: Buffer.byteLength(bytes),
        encoding: control.large ? "none" : "base64", content: control.large ? "" : Buffer.from(control.corrupt ? "corrupt" : bytes).toString("base64") });
    }
    assert.equal(options.method, "PUT"); assert.ok(u.pathname.endsWith("/contents/fdci-state.json"));
    control.puts++; const body = JSON.parse(options.body); assert.equal(body.branch, FDCI_STATE_BRANCH);
    if (body.sha !== revision) return Response.json({}, { status: 409 });
    if (control.loseAck === "before") throw Error("synthetic transport failure");
    bytes = Buffer.from(body.content, "base64").toString("utf8"); revision = gitSha(bytes);
    if (control.loseAck === "fetch") throw Error("synthetic ACK lost after commit");
    if (control.loseAck === "body") return { ok: true, json: async () => { throw Error("synthetic ACK body lost"); } };
    return Response.json({ content: { sha: revision } });
  };
  return { control, fetcher, store: () => createFdciGitStateStore({ token: "synthetic-test-only", fetcher }) };
}

test("expired/deleted artifacts cannot lose the durable cursor: fresh clients restore and finish only confirmed work", async t => {
  const d = await directory(t), remote = server(await initialFdciState(sha));
  const first = await remote.store().load(), partial = await collect(first.state, join(d, "one"));
  assert.equal(partial.result.status, "partial"); assert.equal(partial.result.requests, 4); assert.equal(partial.result.pending, 1);
  assert.equal(partial.state.data.checkpoint.data.items.length, 2); assert.equal(partial.state.data.catalog, null);
  await remote.store().save(first, partial.state);
  const artifact = join(d, "expired-artifact.json");
  await writeFile(artifact, JSON.stringify({ expires_at: "2020-01-01T00:00:00Z", checkpoint: partial.state.data.checkpoint }));
  await rm(artifact); // Git state remains authoritative after artifact deletion/expiry.
  const restored = await remote.store().load();
  assert.deepEqual(restored.state.data.checkpoint, partial.state.data.checkpoint);
  const completed = await collect(restored.state, join(d, "two"), 3, later);
  assert.equal(completed.result.status, "complete"); assert.equal(completed.result.requests, 3);
  assert.equal(completed.state.data.catalog.items.length, 3); assert.equal(new Set(completed.state.data.catalog.items.map(i => i.id)).size, 3);
  await remote.store().save(restored, completed.state);
  assert.equal((await remote.store().load()).state.data.catalog.sha256, completed.state.data.catalog.sha256);
  assert.ok(remote.control.urls.every(u => !u.includes("/actions/artifacts")));
});

test("interruption or incomplete scan keeps the last complete catalog and exposes its real age", async t => {
  const d = await directory(t), seed = await initialFdciState(sha);
  const good = await collect(seed, join(d, "good"), 2);
  assert.equal(fdciDurableView(good.state, Date.parse(at) + 86_400_001).status, "stale");
  const partial = await collect(good.state, join(d, "partial"), 3, later);
  assert.equal(partial.result.status, "partial"); assert.deepEqual(partial.state.data.catalog, good.state.data.catalog);
  assert.equal(partial.view.status, "stale"); assert.equal(partial.view.ageMs, 3_600_000); assert.deepEqual(partial.view.activeItems, []);
  const failed = await collect(partial.state, join(d, "failed"), 3, next, async () => { throw Error("FDCI_CANCELLED"); });
  assert.equal(failed.state.data.lastAttempt.status, "source-error");
  assert.deepEqual(failed.state.data.checkpoint, partial.state.data.checkpoint); assert.deepEqual(failed.state.data.catalog, good.state.data.catalog);
  assert.equal(failed.view.updatedAt, at); assert.equal(failed.view.ageMs, 7_200_000);
});

test("verified empty source replaces a complete snapshot with empty, while HTTP errors never become empty success", async t => {
  const d = await directory(t), good = await collect(await initialFdciState(sha), join(d, "good"), 2);
  const failed = await collect(good.state, join(d, "error"), 0, later, async () => Response.json({}, { status: 403 }));
  assert.equal(failed.state.data.lastAttempt.status, "source-error"); assert.equal(failed.state.data.catalog.items.length, 2);
  const empty = await collect(good.state, join(d, "empty"), 0, later);
  assert.equal(empty.result.requests, 2); assert.equal(empty.state.data.lastAttempt.status, "complete");
  assert.deepEqual(empty.state.data.catalog.items, []); assert.deepEqual(empty.view.activeItems, []); assert.equal(empty.view.status, "ready");
  const previousDtos = (await integrateFdciCatalog([], good.state.data.catalog, "ready", Date.parse(at))).publications;
  const composed = await integrateFdciCatalog(previousDtos, empty.state.data.catalog, "ready", Date.parse(later));
  assert.deepEqual(composed.publications, []); assert.deepEqual(composed.activePublications, []);
  const backend = { ...previousDtos[0], metadata: "{}", title: "Edición administrativa" };
  const retained = await integrateFdciCatalog([backend, ...previousDtos], empty.state.data.catalog, "ready", Date.parse(later));
  assert.deepEqual(retained.publications, [backend]); assert.deepEqual(retained.activePublications, []); // Private history stays; no stale active listing.
  const ended = await buildFdciCatalog(good.state.data.catalog.items.map(i => ({ ...i, registrationCloseAt: "2026-11-05T12:00:00.000Z" })), later);
  assert.deepEqual((await integrateFdciCatalog([], ended, "ready", Date.parse(later))).activePublications, []);
});

test("unchanged catalogs deduplicate and preserve detected-change dates; duplicate source fails without promotion", async t => {
  const d = await directory(t), good = await collect(await initialFdciState(sha), join(d, "good"), 2);
  const repeat = await collect(good.state, join(d, "repeat"), 2, later);
  assert.equal(repeat.state.data.catalog.version, good.state.data.catalog.version);
  assert.equal(repeat.state.data.catalog.items.length, 2);
  for (const o of Object.values(repeat.state.data.catalog.observations)) { assert.equal(o.checkedAt, later); assert.equal(o.lastChangedAt, at); }
  const bad = await collect(repeat.state, join(d, "duplicate"), 2, next, source(2, true));
  assert.equal(bad.error, "FDCI_SCHEMA_CHANGED"); assert.deepEqual(bad.state.data.catalog, repeat.state.data.catalog);
});

test("optimistic file SHA prevents simultaneous jobs from overwriting a newer checkpoint", async t => {
  const d = await directory(t), remote = server(await initialFdciState(sha));
  const one = await remote.store().load(), two = await remote.store().load();
  const a = await collect(one.state, join(d, "a")), b = await collect(two.state, join(d, "b"), 3, later);
  const results = await Promise.allSettled([remote.store().save(one, a.state), remote.store().save(two, b.state)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.match(results.find(r => r.status === "rejected").reason.message, /STATE_CONFLICT/);
  const stored = await remote.store().load();
  assert.equal(stored.state.sha256, results.find(r => r.status === "fulfilled").value.state.sha256);
});

test("lost ACK and truncated ACK body reconcile by reading exact blob, never repeating a write", async t => {
  const d = await directory(t);
  for (const mode of ["fetch", "body", "before"]) {
    const remote = server(await initialFdciState(sha)), old = await remote.store().load();
    const done = await collect(old.state, join(d, mode), 2); remote.control.loseAck = mode;
    if (mode === "before") await assert.rejects(remote.store().save(old, done.state), /COMMIT_UNCERTAIN/);
    else assert.equal((await remote.store().save(old, done.state)).recoveredAck, true);
    assert.equal(remote.control.puts, 1);
  }
});

test("missing/corrupt state fails closed; large Contents metadata retrieves the exact blob; partial promotion is rejected", async t => {
  const d = await directory(t), remote = server(await initialFdciState(sha));
  remote.control.missing = true; await assert.rejects(remote.store().load(), /STATE_MISSING/); assert.equal(remote.control.puts, 0);
  remote.control.missing = false; remote.control.corrupt = true; await assert.rejects(remote.store().load(), /BLOB_MISMATCH/);
  remote.control.corrupt = false; remote.control.large = true; const old = await remote.store().load();
  const partial = await collect(old.state, join(d, "partial"));
  const altered = structuredClone(partial.state); altered.data.catalog = await buildFdciCatalog([], at); altered.sha256 = await catalogHash(altered.data);
  await assert.rejects(remote.store().save(old, altered), /PARTIAL_PROMOTION_FORBIDDEN/); assert.equal(remote.control.puts, 0);
});

test("explicit migration preserves official artifact checkpoint/catalog; synthetic or unapproved provenance rejected", async t => {
  const d = await directory(t), partial = await collect(await initialFdciState(sha), join(d, "partial"));
  const data = { format: 2, origin: { dataset: "official-readonly", repository: FDCI_STATE_REPOSITORY, workflowId: 55,
    runId: 101, runAttempt: 1, sha: "b".repeat(40), branch: "main" }, checkpoint: partial.state.data.checkpoint, catalog: null };
  const artifact = { data, sha256: await catalogHash(data) }, approval = { sourceSha: "b".repeat(40), runId: 101, codeSha: sha };
  const migrated = await migrateOfficialFdciArtifact(artifact, approval);
  assert.deepEqual(migrated.data.checkpoint, artifact.data.checkpoint); assert.equal(migrated.data.lastAttempt.status, "partial");
  await assert.rejects(migrateOfficialFdciArtifact(artifact, { ...approval, runId: 102 }), /PROVENANCE/);
  const synthetic = structuredClone(artifact); synthetic.data.origin.dataset = "synthetic"; synthetic.sha256 = await catalogHash(synthetic.data);
  await assert.rejects(migrateOfficialFdciArtifact(synthetic, approval), /PROVENANCE/);
  const corrupt = structuredClone(migrated); corrupt.data.generation = 0;
  await assert.rejects(validateDurableFdciState(corrupt), /INVALID/);
});

test("prepared durable workflow remains disabled/manual and writes no Pages or Cloudflare resource", async () => {
  const yaml = createRequire(import.meta.resolve("eslint"))("js-yaml");
  const w = yaml.load(await readFile("docs/examples/fdci-static-durable.yml.example", "utf8"));
  assert.deepEqual(Object.keys(w.on), ["workflow_dispatch"]); assert.equal(w.permissions.contents, "write");
  assert.match(w.jobs.collect.if, /FDCI_DURABLE_ENABLED == 'true'/); assert.equal(w.concurrency["cancel-in-progress"], false);
  assert.ok(w.jobs.collect.steps.every(s => !s.uses || /^actions\/(checkout|setup-node|upload-artifact)@v4$/.test(s.uses)));
});

test("web reader pairs status/checksum with complete catalog, shows stale on partial/error, and accepts verified empty", async t => {
  const d = await directory(t), good = await collect(await initialFdciState(sha), join(d, "good"), 2);
  const partial = await collect(good.state, join(d, "partial"), 3, later);
  const empty = await collect(good.state, join(d, "empty"), 0, next);
  let state = good.state, brokenStatus = false;
  const url = "https://possee41.github.io/docentetuc-fdci-catalog-pilot/catalog.json";
  const reader = createFdciCatalogReader(url, async target => {
    if (target.endsWith("catalog.json")) return Response.json(state.data.catalog);
    const view = fdciDurableView(state, Date.parse(next));
    return Response.json({ status: view.status, updatedAt: view.updatedAt, ageMs: view.ageMs, lastAttempt: view.lastAttempt,
      catalogSha256: brokenStatus ? "incorrect" : state.data.catalog.sha256, revision: "b".repeat(40) });
  }, () => Date.parse(next), new URL("status.json", url).href);
  assert.equal((await reader()).status, "ready");
  state = partial.state; const stale = await reader(); assert.equal(stale.status, "stale"); assert.equal(stale.items.length, 2); assert.equal(stale.ageMs, 7_200_000);
  state = empty.state; brokenStatus = true;
  assert.equal((await reader()).items.length, 2); // Mismatched CDN pair cannot promote the empty snapshot.
  brokenStatus = false; const cleared = await reader(); assert.equal(cleared.status, "ready"); assert.deepEqual(cleared.items, []);
  assert.throws(() => createFdciCatalogReader(url, async () => Response.json({}), Date.now, "https://other.example/status.json"), /ORIGIN_FORBIDDEN/);
});
