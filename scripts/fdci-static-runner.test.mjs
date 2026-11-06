import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { initialFdciState, createFdciGitStateStore, FDCI_STATE_REPOSITORY, FDCI_STATE_BRANCH } from "./fdci-static-durable.mjs";
import { createFdciGitPublisher } from "./fdci-static-publisher.mjs";
import { runIntegratedFdci, reviewFdciExecutable } from "./fdci-static-runner.mjs";
import { createFdciVersionedReader, validateFdciActiveVersion, FDCI_RAW_ACTIVE_URL } from "../lib/fdci-static-publication.ts";

const sha = "a".repeat(40), at = "2026-11-06T12:00:00.000Z", later = "2026-11-06T13:00:00.000Z", next = "2026-11-06T14:00:00.000Z";
const activePath = "fdci-catalog/active.json", activeUrl = `https://possee41.github.io/docentetuc-fdci-catalog-pilot/${activePath}`;
const gitSha = bytes => createHash("sha1").update(`blob ${Buffer.byteLength(bytes)}\0`).update(bytes).digest("hex");
async function directory(t) {
  const parent = resolve(tmpdir()), root = await mkdtemp(join(parent, "fdci-integrated-"));
  t.after(async () => { assert.equal(dirname(root), parent); await rm(root, { recursive: true, force: true }); }); return root;
}
function source(count = 2, title = "SINTÉTICO") {
  const rows = Array.from({ length: count }, (_, i) => ({ id: 9000 + i, capacitacion_id: 100 + i,
    fecha_apertura_preinscripcion: "2026-01-01 08:00:00", fecha_cierre_preinscripcion: "2099-12-01 08:00:00" }));
  return async (url, options) => Response.json(url.endsWith("getCapaActivas") ? rows : url.endsWith("getRestoCapas")
    ? rows.map(r => ({ capacitacion_id: r.capacitacion_id, nombre: title + r.id, token: String(r.capacitacion_id), slug: "demo" }))
    : { comisiones: rows.filter(r => String(r.capacitacion_id) === JSON.parse(options.body).token) });
}
async function repository() {
  const initial = await initialFdciState(sha), files = new Map([[FDCI_STATE_BRANCH + ":fdci-state.json", JSON.stringify(initial) + "\n"], ["main:catalog.json", "SYNTHETIC PUBLIC CATALOG UNCHANGED\n"]]);
  const writes = [], faults = new Map();
  const fetcher = async (url, options) => {
    const u = new URL(url), prefix = `/repos/${FDCI_STATE_REPOSITORY}/contents/`;
    assert.equal(u.origin, "https://api.github.com"); assert.ok(u.pathname.startsWith(prefix)); assert.equal(options.redirect, "error");
    const path = u.pathname.slice(prefix.length), body = options.body ? JSON.parse(options.body) : null;
    const branch = options.method === "PUT" ? body.branch : u.searchParams.get("ref"), key = branch + ":" + path;
    assert.ok(["main", FDCI_STATE_BRANCH].includes(branch));
    assert.ok(branch === FDCI_STATE_BRANCH ? path === "fdci-state.json" : path === activePath || /^fdci-catalog\/versions\/[a-f0-9]{64}\.json$/.test(path));
    const current = files.get(key);
    if (options.method === "GET") return current === undefined ? Response.json({}, { status: 404 }) : Response.json({
      type: "file", path, sha: gitSha(current), size: Buffer.byteLength(current), encoding: "base64", content: Buffer.from(current).toString("base64") });
    assert.equal(options.method, "PUT");
    if (current === undefined ? body.sha !== undefined : body.sha !== gitSha(current)) return Response.json({}, { status: 409 });
    const fault = faults.get(path) ?? faults.get(path.includes("/versions/") ? "version" : "");
    if (fault) { faults.delete(path); faults.delete("version"); }
    if (fault === "before") throw Error("synthetic failure before Git commit");
    const bytes = Buffer.from(body.content, "base64").toString("utf8"); files.set(key, bytes); writes.push({ branch, path, bytes });
    if (fault === "after") throw Error("synthetic lost ACK after Git commit");
    return Response.json({ content: { sha: gitSha(bytes) } });
  };
  const store = createFdciGitStateStore({ token: "synthetic-test-only", fetcher }), publisher = createFdciGitPublisher({ token: "synthetic-test-only", fetcher });
  return { files, writes, faults, store, publisher, pointer: () => JSON.parse(files.get("main:" + activePath)),
    publicFetch: async url => { const bytes = files.get("main:" + new URL(url).pathname.split("/docentetuc-fdci-catalog-pilot/")[1]);
      return new Response(bytes ?? "missing", { status: bytes ? 200 : 404, headers: { "content-type": "application/json" } }); } };
}
async function run(r, root, checkedAt = at, fetcher = source(), recoverOnly = false) {
  return runIntegratedFdci({ store: r.store, publisher: r.publisher, codeSha: sha, root, sourceFetch: fetcher, checkedAt, recoverOnly, pause: async () => {} });
}

test("official collector + durable state + immutable publication run end-to-end; exact replay writes nothing", async t => {
  const d = await directory(t), r = await repository(), result = await run(r, join(d, "one"));
  assert.equal(result.status, "complete"); assert.equal(result.result.requests, 4); assert.equal(result.result.items, 2);
  assert.equal(result.publication.changed, true); const state = await r.store.load(), pointer = await validateFdciActiveVersion(r.pointer());
  assert.equal(pointer.stateRevision, state.revision); assert.equal(pointer.stateChecksum, state.state.sha256);
  assert.equal(pointer.catalogSha256, state.state.data.catalog.sha256);
  assert.deepEqual(r.writes.map(w => w.branch), [FDCI_STATE_BRANCH, "main", "main"]); // Explicit state -> version -> pointer order.
  const count = r.writes.length; assert.equal((await r.publisher.reconcile(state)).changed, false); assert.equal(r.writes.length, count);
  const reader = createFdciVersionedReader(activeUrl, r.publicFetch, () => Date.parse(at));
  const view = await reader(); assert.equal(view.status, "ready"); assert.equal(new Set(view.items.map(i => i.id)).size, 2);
  assert.equal(r.files.get("main:catalog.json"), "SYNTHETIC PUBLIC CATALOG UNCHANGED\n");
});

test("partial/error retain last complete version with stale metadata; legitimate empty catalog promotes zero items", async t => {
  const d = await directory(t), r = await repository(); await run(r, join(d, "initial")); const original = r.pointer();
  const partial = await run(r, join(d, "partial"), later, source(3));
  assert.equal(partial.status, "partial"); assert.equal(partial.result.requests, 4); assert.equal(r.pointer().catalogSha256, original.catalogSha256);
  const reader = createFdciVersionedReader(activeUrl, r.publicFetch, () => Date.parse(next));
  assert.equal((await reader()).status, "stale"); assert.equal((await reader()).items.length, 2);
  const failed = await run(r, join(d, "error"), next, async () => Response.json({}, { status: 403 }));
  assert.equal(failed.status, "source-error"); assert.equal(r.pointer().catalogSha256, original.catalogSha256);
  // Complete the interrupted scan before switching to an empty new cycle.
  await run(r, join(d, "finish"), "2026-11-06T15:00:00.000Z", source(3));
  const empty = await run(r, join(d, "empty"), "2026-11-06T16:00:00.000Z", source(0));
  assert.equal(empty.status, "complete"); assert.equal(empty.result.requests, 2);
  const emptyReader = createFdciVersionedReader(activeUrl, r.publicFetch, () => Date.parse("2026-11-06T16:00:00.000Z"));
  assert.deepEqual((await emptyReader()).items, []); assert.equal((await emptyReader()).status, "ready");
  assert.ok(r.files.has("main:fdci-catalog/" + original.versionPath)); // Previous immutable version remains recoverable.
});

test("failed state commit cannot expose a new catalog", async t => {
  const d = await directory(t), r = await repository(); await run(r, join(d, "initial"));
  const before = r.files.get("main:" + activePath), writes = r.writes.length; r.faults.set("fdci-state.json", "before");
  await assert.rejects(run(r, join(d, "failed"), later, source(2, "CAMBIO")), /STATE_COMMIT_UNCERTAIN/);
  assert.equal(r.files.get("main:" + activePath), before); assert.equal(r.writes.length, writes);
});

test("failures after state commit or after version write recover before another source request", async t => {
  const d = await directory(t);
  for (const fault of ["version", activePath]) {
    const r = await repository(); await run(r, join(d, "initial-" + fault.replaceAll("/", "-")));
    const old = r.files.get("main:" + activePath); r.faults.set(fault, "before");
    await assert.rejects(run(r, join(d, "fail-" + fault.replaceAll("/", "-")), later, source(2, "CAMBIO")), /PUBLICATION_COMMIT_UNCERTAIN/);
    assert.equal(r.files.get("main:" + activePath), old); const confirmed = await r.store.load();
    assert.equal(confirmed.state.data.generation, 2); const checkpoint = confirmed.state.data.checkpoint.sha256;
    const versions = () => r.writes.filter(w => w.path.includes("/versions/")).length, count = versions();
    const recovered = await run(r, join(d, "unused"), next, async () => { throw Error("MUST_NOT_RECOLLECT"); });
    assert.equal(recovered.collected, false); assert.equal(r.pointer().catalogSha256, confirmed.state.data.catalog.sha256);
    assert.equal((await r.store.load()).state.data.checkpoint.sha256, checkpoint);
    if (fault === activePath) assert.equal(versions(), count); // Orphan version reused, not rewritten.
    const total = r.writes.length; await run(r, join(d, "unused-again"), next, async () => { throw Error("MUST_NOT_RECOLLECT"); }, true);
    assert.equal(r.writes.length, total);
  }
});

test("lost pointer ACK reconciles without duplicate writes; recovery-only also repairs a deleted immutable version", async t => {
  const d = await directory(t), r = await repository(); await run(r, join(d, "initial"));
  r.faults.set(activePath, "after"); const done = await run(r, join(d, "next"), later, source(2, "CAMBIO"));
  assert.equal(done.publication.recoveredAck, true); assert.equal(r.writes.filter(w => w.path === activePath).length, 2);
  const missing = "main:fdci-catalog/" + r.pointer().versionPath; r.files.delete(missing);
  const repaired = await run(r, join(d, "unused"), next, async () => { throw Error("MUST_NOT_RECOLLECT"); }, true);
  assert.equal(repaired.collected, false); assert.equal(repaired.publication.repairedVersion, true); assert.ok(r.files.has(missing));
});

test("concurrent runners cannot publish a losing cursor; older pointer generations cannot overwrite newer ones", async t => {
  const d = await directory(t), r = await repository();
  const both = await Promise.allSettled([run(r, join(d, "one"), at, source(2, "A")), run(r, join(d, "two"), later, source(2, "B"))]);
  assert.equal(both.filter(x => x.status === "fulfilled").length, 1); assert.match(both.find(x => x.status === "rejected").reason.message, /STATE_CONFLICT/);
  const old = await r.store.load(); assert.equal(r.pointer().stateChecksum, old.state.sha256);
  await run(r, join(d, "new"), next, source(2, "NUEVO"));
  await assert.rejects(r.publisher.reconcile(old), /PUBLICATION_STALE_STATE/);
  await assert.rejects(r.publisher.reconcile({ revision: "0".repeat(40), state: await initialFdciState(sha) }), /STATE_CATALOG_MISSING/);
});

test("immutable conflicts and CDN gaps fail closed; web retains last valid catalog and rejects pointer rollback", async t => {
  const d = await directory(t), r = await repository(); await run(r, join(d, "initial"));
  const oldPointer = r.files.get("main:" + activePath), old = await r.store.load();
  const reader = createFdciVersionedReader(activeUrl, r.publicFetch, () => Date.parse(next)); assert.equal((await reader()).items.length, 2);
  await run(r, join(d, "new"), later, source(2, "NUEVO"));
  const key = "main:fdci-catalog/" + r.pointer().versionPath, bytes = r.files.get(key); r.files.delete(key);
  const gap = await reader(); assert.equal(gap.status, "stale"); assert.equal(gap.items[0].title, old.state.data.catalog.items[0].title);
  r.files.set(key, bytes); assert.equal((await reader()).status, "ready");
  const newPointer = r.files.get("main:" + activePath); r.files.set("main:" + activePath, oldPointer);
  assert.equal((await reader()).status, "stale"); r.files.set("main:" + activePath, newPointer);
  r.files.set(key, JSON.stringify(old.state.data.catalog) + "\n");
  await assert.rejects(r.publisher.reconcile(await r.store.load()), /IMMUTABLE_VERSION_CONFLICT/);
});

test("executable revision review is explicit and preserves cursor/catalog/attempt without resetting generation", async t => {
  const d = await directory(t), r = await repository(); await run(r, join(d, "initial"));
  const old = await r.store.load(), bytes = r.files.get(FDCI_STATE_BRANCH + ":fdci-state.json");
  const approval = { expectedRevision: old.revision, expectedChecksum: old.state.sha256, oldCodeSha: sha, newCodeSha: "b".repeat(40) };
  const reviewed = await reviewFdciExecutable(bytes, approval);
  assert.deepEqual(reviewed.data.checkpoint, old.state.data.checkpoint); assert.deepEqual(reviewed.data.catalog, old.state.data.catalog);
  assert.deepEqual(reviewed.data.lastAttempt, old.state.data.lastAttempt); assert.equal(reviewed.data.generation, old.state.data.generation + 1);
  await assert.rejects(reviewFdciExecutable(bytes, { ...approval, expectedRevision: "0".repeat(40) }), /PROVENANCE/);
});

test("integrated workflow is local-only, manual, disabled by default, pinned to executable SHA and recovery-only by default", async () => {
  const yaml = createRequire(import.meta.resolve("eslint"))("js-yaml");
  const w = yaml.load(await readFile("docs/examples/fdci-static-integrated.yml.example", "utf8"));
  assert.deepEqual(Object.keys(w.on), ["workflow_dispatch"]); assert.equal(w.on.workflow_dispatch.inputs.recovery_only.default, true);
  assert.deepEqual(w.permissions, { contents: "write" }); assert.equal(w.concurrency["cancel-in-progress"], false);
  assert.match(w.jobs.synchronize.if, /FDCI_INTEGRATED_ENABLED == 'true'/);
  assert.equal(w.jobs.synchronize.steps.find(s => s.uses === "actions/checkout@v4").with.ref, "${{ vars.FDCI_STATIC_APPROVED_SHA }}");
});

test("raw CDN reader needs no Pages build and accepts only fixed repository/path and verified JSON", async t => {
  const d = await directory(t), r = await repository(); await run(r, join(d, "initial")); let html = false;
  const read = createFdciVersionedReader(FDCI_RAW_ACTIVE_URL, async (url, options) => {
    assert.equal(options.credentials, "omit"); assert.equal(options.redirect, "error");
    const u = new URL(url); assert.equal(u.origin, "https://raw.githubusercontent.com");
    const path = u.pathname.split("/main/")[1];
    return new Response(r.files.get("main:" + path), { headers: { "content-type": html ? "text/html" : "text/plain; charset=utf-8" } });
  }, () => Date.parse(at));
  assert.equal((await read()).items.length, 2); html = true; assert.equal((await read()).status, "stale");
  assert.throws(() => createFdciVersionedReader(FDCI_RAW_ACTIVE_URL.replace("/main/", "/other/")), /ORIGIN_FORBIDDEN/);
});
