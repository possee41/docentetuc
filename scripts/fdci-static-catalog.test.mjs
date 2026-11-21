import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { buildFdciCatalog, validateFdciCatalog, createFdciCatalogReader, CATALOG_MAX_BYTES } from "../lib/fdci-static-catalog.ts";
import { generateFdciCatalog, publishLocalCatalog, syntheticFdciFetch } from "./fdci-static-catalog.mjs";
const at = "2026-11-05T12:00:00.000Z", later = "2026-11-05T13:00:00.000Z";
const url = "https://possee41.github.io/docentetuc-fdci-catalog/catalog.json";
const demo = () => generateFdciCatalog(syntheticFdciFetch, at, async () => {});
async function directory(t) {
  const root = resolve(tmpdir()), d = await mkdtemp(join(root, "fdci-static-"));
  t.after(async () => { assert.equal(dirname(resolve(d)), root); await rm(d, { recursive: true, force: true }); });
  return d;
}

test("existing Node collector yields deterministic public-only JSON, sorted IDs and verifiable hashes", async () => {
  const a = await demo(), b = await demo(); assert.equal(a.requests, 3); assert.deepEqual(a, b);
  assert.equal(a.catalog.items.length, 2); assert.deepEqual(await validateFdciCatalog(a.catalog), a.catalog);
  const input = { ...a.catalog.items[0], token: "DO_NOT_EXPORT", user_id: "PRIVATE", metadata: "PRIVATE" };
  const output = await buildFdciCatalog([a.catalog.items[1], input, input], at);
  assert.deepEqual(output, a.catalog); assert(!JSON.stringify(output).includes("PRIVATE")); assert(!JSON.stringify(output).includes("DO_NOT_EXPORT"));
  await assert.rejects(buildFdciCatalog([input, { ...input, title: "Conflicting duplicate" }], at), /DUPLICATE_CONFLICT/);
});

test("real empty source is a fresh empty catalog, not a network error", async () => {
  const { catalog, requests } = await generateFdciCatalog(async () => Response.json([]), at, async () => {});
  assert.equal(requests, 2); assert.deepEqual(catalog.items, []);
  const read = createFdciCatalogReader(url, async () => Response.json(catalog), () => Date.parse(at));
  assert.equal((await read()).status, "ready"); assert.equal((await read()).items.length, 0);
});

test("new public content changes version; time alone updates observation/integrity, not dataset version", async () => {
  const { catalog } = await demo();
  const observed = await buildFdciCatalog(catalog.items, later);
  assert.equal(observed.version, catalog.version); assert.notEqual(observed.sha256, catalog.sha256);
  const changed = await buildFdciCatalog([{ ...catalog.items[0], title: "New public title" }], later);
  assert.notEqual(changed.version, catalog.version);
  await assert.rejects(validateFdciCatalog({ ...catalog, items: changed.items }), /INVALID/);
});

test("failed promotion preserves the old catalog; subsequent success recovers and retains immutable versions", async t => {
  const d = await directory(t), { catalog } = await demo(); await publishLocalCatalog(catalog, d);
  const previous = await readFile(join(d, "catalog.json"), "utf8");
  const changed = await buildFdciCatalog([{ ...catalog.items[0], title: "Updated" }], later);
  await assert.rejects(publishLocalCatalog(changed, d, async () => { throw Error("synthetic interruption before atomic rename"); }));
  assert.equal(await readFile(join(d, "catalog.json"), "utf8"), previous);
  await publishLocalCatalog(changed, d);
  assert.equal(JSON.parse(await readFile(join(d, "catalog.json"), "utf8")).sha256, changed.sha256);
  assert.equal((await readdir(join(d, "versions"))).length, 2);
  await assert.rejects(publishLocalCatalog(catalog, d), /OLDER/);
});

test("publication lock rejects simultaneous writers without removing the owner's lock", async t => {
  const d = await directory(t), { catalog } = await demo();
  let release, entered; const waiting = new Promise(r => { release = r; }); const locked = new Promise(r => { entered = r; });
  const first = publishLocalCatalog(catalog, d, async (a, b) => { entered(); await waiting; const { rename } = await import("node:fs/promises"); await rename(a, b); });
  await locked;
  try { await assert.rejects(publishLocalCatalog(catalog, d), /EEXIST/); }
  finally { release(); await first; }
  assert(!((await readdir(d)).includes(".publish.lock")));
});

test("incomplete collection/request cap never replaces a complete file", async t => {
  const d = await directory(t), { catalog } = await demo(); await publishLocalCatalog(catalog, d);
  const old = await readFile(join(d, "catalog.json"), "utf8");
  const commissions = Array.from({ length: 5 }, (_, i) => ({ id: 9000 + i, capacitacion_id: 100 + i }));
  let requests = 0;
  await assert.rejects(generateFdciCatalog(async (u, init) => {
    requests++;
    if (String(u).endsWith("getCapaActivas")) return Response.json(commissions);
    if (String(u).endsWith("getRestoCapas")) return Response.json(commissions.map(c => ({ capacitacion_id: c.capacitacion_id, nombre: "Demo", token: String(c.capacitacion_id), slug: "demo" })));
    const id = Number(JSON.parse(init.body).token); return Response.json({ comisiones: commissions.filter(c => c.capacitacion_id === id) });
  }, later, async () => {}), /INCOMPLETE/);
  assert.equal(requests, 6); assert.equal(await readFile(join(d, "catalog.json"), "utf8"), old);
});

test("reader omits credentials, preserves last good snapshot on network/schema failure and recovers", async () => {
  const { catalog } = await demo(); let mode = "good";
  const updated = await buildFdciCatalog([{ ...catalog.items[0], title: "New" }], later);
  const read = createFdciCatalogReader(url, async (u, init) => {
    assert.equal(u, url); assert.equal(init.credentials, "omit"); assert.equal(init.redirect, "error"); assert(!Object.hasOwn(init.headers, "Authorization"));
    if (mode === "network") throw Error("synthetic failure");
    return Response.json(mode === "corrupt" ? { ...catalog, secret: "DO_NOT_ACCEPT" } : mode === "new" ? updated : catalog);
  }, () => Date.parse(later));
  const first = await read(); assert.equal(first.status, "ready"); first.items[0].title = "Caller mutation";
  for (mode of ["network", "corrupt"]) { const r = await read(); assert.equal(r.status, "stale"); assert.deepEqual(r.items, catalog.items); }
  mode = "new"; assert.equal((await read()).version, updated.version);
  mode = "good"; assert.equal((await read()).version, updated.version); // CDN rollback rejected.
});

test("reader labels old data and never presents missing/invalid responses as fresh empty data", async () => {
  const { catalog } = await demo();
  const old = createFdciCatalogReader(url, async () => Response.json(catalog), () => Date.parse(at) + 86_400_001);
  assert.equal((await old()).status, "stale");
  for (const response of [new Response("failure", { status: 503 }), Response.json({}), new Response("x".repeat(CATALOG_MAX_BYTES + 1), { headers: { "content-type": "application/json" } })]) {
    const read = createFdciCatalogReader(url, async () => response, () => Date.parse(at));
    assert.equal((await read()).status, "unavailable");
  }
  assert.throws(() => createFdciCatalogReader("https://example.com/catalog.json"), /ORIGIN_FORBIDDEN/);
});

test("source network failure leaves current artifact intact; no cloud credentials or D1 calls are needed", async t => {
  const d = await directory(t), { catalog } = await demo(); await publishLocalCatalog(catalog, d);
  const old = await readFile(join(d, "catalog.json"), "utf8"); let calls = 0;
  await assert.rejects(generateFdciCatalog(async u => {
    assert.equal(new URL(u).hostname, "apicapacitaciones.educaciontuc.edu.ar"); calls++; throw Error("FDCI_CANCELLED");
  }, later, async () => {}), /FDCI_CANCELLED/);
  assert.equal(calls, 1); assert.equal(await readFile(join(d, "catalog.json"), "utf8"), old);
});

test("same timestamp conflicting generation cannot silently replace current or reader's accepted data", async t => {
  const d = await directory(t), { catalog } = await demo(); await publishLocalCatalog(catalog, d);
  const conflict = await buildFdciCatalog([{ ...catalog.items[0], title: "Different" }], at);
  await assert.rejects(publishLocalCatalog(conflict, d), /SAME_TIME_CONFLICT/);
  let next = catalog;
  const read = createFdciCatalogReader(url, async () => Response.json(next), () => Date.parse(at));
  await read(); next = conflict;
  const kept = await read(); assert.equal(kept.status, "stale"); assert.equal(kept.version, catalog.version);
});
