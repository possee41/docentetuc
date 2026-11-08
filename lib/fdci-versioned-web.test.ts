import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildFdciCatalog, catalogHash } from "./fdci-static-catalog.ts";
import { buildFdciActiveVersion, createFdciVersionedReader, FDCI_RAW_ACTIVE_URL } from "./fdci-static-publication.ts";
import { fdciPilotAllowed, integrateFdciCatalog, fdciCatalogMessage, fdciPublicVerification, withFdciPublicVerification } from "./fdci-catalog-integration.ts";
import { enrollmentForDisplay } from "./personalized-catalog.ts";
import { fdciPersonalBlocked, withFdciPersonalCapability } from "./fdci-personal-contract.ts";
import type { Publication } from "./types.ts";
import { generateFdciCatalog, syntheticFdciFetch } from "../scripts/fdci-static-catalog.mjs";

const at = "2026-11-06T10:00:00.000Z", now = () => Date.parse(at);
const course = (id = "101") => ({ id: `fdci:commission:${id}`, externalId: id, title: `Curso simulado ${id}`,
  summary: "Fixture local, no publicada", category: "Capacitaciones", level: "Primario", area: "Matemática",
  location: "Tucumán", character: "Gratuito", status: "Inscripción abierta", normalizedStatus: "ACTIVE",
  officialUrl: `https://capacitaciondocente.educaciontuc.gov.ar/comisiones/${id}`, registrationOpenAt: at,
  registrationCloseAt: "2026-11-20T10:00:00.000Z", startsAt: null, endsAt: null, sourceUpdatedAt: null });
async function fixture(items: Record<string, unknown>[] = [course()], generation = 3, updatedAt = at) {
  const catalog = await buildFdciCatalog(items, updatedAt);
  const pointer = await buildFdciActiveVersion({ generation, stateChecksum: "a".repeat(64), stateRevision: "b".repeat(40),
    codeSha: "c".repeat(40), catalogSha256: catalog.sha256, catalogUpdatedAt: catalog.updatedAt,
    lastAttempt: { at: updatedAt, status: "complete", error: null } });
  return { catalog, pointer };
}
async function harness(initial?: Awaited<ReturnType<typeof fixture>>) {
  let data = initial ?? await fixture(), fail = false, corrupt = false;
  const requests: { url: string; options?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    if (fail) throw Error("synthetic network/CORS failure");
    const value = String(url) === FDCI_RAW_ACTIVE_URL ? data.pointer : corrupt ? { ...data.catalog, sha256: "0".repeat(64) } : data.catalog;
    assert.equal(String(url), String(url) === FDCI_RAW_ACTIVE_URL ? FDCI_RAW_ACTIVE_URL : new URL(data.pointer.versionPath, FDCI_RAW_ACTIVE_URL).href);
    return new Response(JSON.stringify(value), { headers: { "content-type": "text/plain; charset=utf-8" } });
  };
  return { read: createFdciVersionedReader(FDCI_RAW_ACTIVE_URL, fetcher, now), requests,
    set: (next: typeof data) => { data = next; }, fail: () => { fail = true; }, corrupt: () => { corrupt = true; } };
}

test("valid versioned empty catalog is ready, without legacy fallback", async () => {
  const h = await harness(await fixture([])), result = await h.read();
  assert.equal(result.status, "ready"); assert.deepEqual(result.items, []); assert.equal(result.generation, 3);
  assert.equal(result.updatedAt, at); assert.equal(h.requests.length, 2);
  assert(h.requests.every(r => !r.url.endsWith("/catalog.json")));
});
test("simulated courses retain dates, level, links and version provenance; external private actions stay off", async () => {
  const h = await harness(await fixture([course(), course("102")])), result = await h.read();
  const merged = await integrateFdciCatalog([], result.catalog!, "ready", now(), result.generation);
  assert.equal(merged.publications.length, 2);
  for (const p of merged.publications) {
    assert.equal(p.level, "Primario"); assert.equal(p.registration_open_at, at); assert(p.official_url.startsWith("https://capacitaciondocente."));
    const meta = JSON.parse(p.metadata); assert.equal(meta.catalogGeneration, 3); assert.equal(meta.catalogSha256, result.catalogSha256);
    assert.equal(meta.catalogOnly, true); assert.equal(merged.info[p.id].canSave, false); assert.equal(merged.info[p.id].canSchedule, false); assert.equal(merged.info[p.id].canRemind, false);
  }
});
test("bad document checksum is unavailable and never replaces a good catalog", async () => {
  const h = await harness(), good = await h.read(); h.corrupt();
  const stale = await h.read(); assert.equal(stale.status, "stale"); assert.deepEqual(stale.catalog, good.catalog);
  const fresh = await harness(); fresh.corrupt(); assert.equal((await fresh.read()).status, "unavailable");
});
test("bad reference checksum, path escape and unapproved origin are rejected", async () => {
  for (const versionPath of ["https://evil.test/x.json", "../catalog.json", "versions/wrong.json"]) {
    const f = await fixture(); f.pointer.versionPath = versionPath;
    const { sha256: _hash, ...body } = f.pointer; void _hash; f.pointer.sha256 = await catalogHash(body);
    assert.equal((await (await harness(f)).read()).status, "unavailable");
  }
  const f = await fixture(); f.pointer.sha256 = "0".repeat(64);
  assert.equal((await (await harness(f)).read()).status, "unavailable");
  assert.throws(() => createFdciVersionedReader("https://evil.test/active.json"));
});
test("network/CORS failure retains the last verified version and marks it stale", async () => {
  const h = await harness(), good = await h.read(); h.fail(); const bad = await h.read();
  assert.equal(bad.status, "stale"); assert.deepEqual(bad.items, good.items); assert.equal(bad.updatedAt, at);
});
test("older generation or same-generation substitution cannot roll back accepted content", async () => {
  const h = await harness(); const good = await h.read();
  h.set(await fixture([], 2)); assert.equal((await h.read()).catalogSha256, good.catalogSha256);
  h.set(await fixture([], 3)); assert.equal((await h.read()).status, "stale");
  h.set(await fixture([], 4)); const empty = await h.read(); assert.equal(empty.status, "ready"); assert.deepEqual(empty.items, []);
});
test("old successful catalog remains explicitly stale; simulated cancellation is not a current fetch error", async () => {
  const f = await fixture([], 3, "2026-11-04T10:00:00.000Z");
  f.pointer.lastAttempt = { at, status: "source-error", error: "FDCI_CANCELLED" };
  const { sha256: _hash, ...body } = f.pointer; void _hash; f.pointer.sha256 = await catalogHash(body);
  const result = await (await harness(f)).read();
  assert.equal(result.status, "stale"); assert.equal(result.error, null); assert.equal(result.lastAttempt?.error, "FDCI_CANCELLED");
  assert.equal(result.updatedAt, "2026-11-04T10:00:00.000Z");
});
test("D1 wins by canonical ID or external ID under both source aliases; unrelated records survive", async () => {
  const { catalog } = await fixture();
  const external = (await integrateFdciCatalog([], catalog, "ready", now())).publications[0];
  for (const source of ["FDCI", "Capacitación Docente"]) {
    const stored: Publication = { ...external, id: "stored-101", source, title: "Edición administrativa", metadata: "{}" };
    const unrelated = { ...stored, id: "other", source: "Otra fuente", external_id: "999" };
    const result = await integrateFdciCatalog([stored, unrelated], catalog, "ready", now());
    assert.deepEqual(result.publications, [stored, unrelated]); assert.equal(result.info[stored.id].canSave, true);
    assert.deepEqual((await integrateFdciCatalog([stored, unrelated], await buildFdciCatalog([], at), "ready", now())).publications, [stored, unrelated]);
  }
});
test("the verified old pilot fingerprint cannot replace a valid official catalog", async () => {
  const h = await harness(await fixture([])); const good = await h.read();
  const { catalog } = await generateFdciCatalog(syntheticFdciFetch, at, async () => {});
  assert.equal(catalog.version, "14ffa0ebd934c43d36757b89be76318ee0053a45352912f758786ee5377c613b");
  h.set(await fixture(catalog.items, 4));
  const result = await h.read(); assert.deepEqual(result.catalog, good.catalog); assert.equal(result.status, "stale");
});
test("versioned official content is not excluded by PRUEBA, DEMO or SINTÉTICA words", async () => {
  const h = await harness(await fixture([{ ...course(), title: "PRUEBA y DEMO SINTÉTICA: contenidos didácticos" }]));
  assert.equal((await h.read()).status, "ready");
});
test("reference bypasses cache, immutable file uses cache, both omit credentials and forbid redirects", async () => {
  const h = await harness(); await h.read();
  assert.equal(h.requests[0].options?.cache, "no-store"); assert.equal(h.requests[1].options?.cache, "force-cache");
  for (const { options } of h.requests) { assert.equal(options?.credentials, "omit"); assert.equal(options?.redirect, "error"); assert.equal(options?.mode, "cors"); }
});
test("authorized public hosts read the official catalog without allowing other origins", () => {
  assert(fdciPilotAllowed("canary.docentetuc.com.ar", "?fdciCatalogTest=1"));
  assert(fdciPilotAllowed("canary.docentetuc.com.ar", "")); assert(fdciPilotAllowed("docentetuc.com.ar", "?fdciCatalogTest=1"));
  assert(fdciPilotAllowed("docentetuc.com.ar", ""));
  assert(!fdciPilotAllowed("docentetuc.com.ar.evil.example", "?fdciCatalogTest=1"));
  const route = readFileSync(new URL("../app/api/app/route.ts", import.meta.url), "utf8");
  assert(!route.includes("catalog.json")); assert(!route.includes("fetchFdciCatalog"));
  assert.match(route, /prepareFdciPersonalAction/);
});

test("empty verified catalog keeps D1 history without advertising open registrations", async () => {
  const full = await fixture();
  const [stored] = (await integrateFdciCatalog([], full.catalog, "ready", now())).publications;
  const infod = { ...stored, id: "infd:1", source: "INFoD / AulaS-TIC" };
  const cenet = { ...stored, id: "cenet:1", source: "CeNET / INET" };
  const empty = await buildFdciCatalog([], at);
  const result = withFdciPublicVerification([stored, infod, cenet], empty, "ready");
  assert.equal(result[0].title, stored.title); assert.equal(result[0].status, stored.status);
  assert.equal(fdciPublicVerification(result[0])?.status, "historical");
  assert.equal(enrollmentForDisplay(result[0], new Date(at)), "CERRADA");
  assert.equal(result[1], infod); assert.equal(result[2], cenet);
  assert.equal(fdciCatalogMessage("ready", 0), "No hay inscripciones activas verificadas");
  assert.notEqual(fdciCatalogMessage("stale", 0), fdciCatalogMessage("ready", 0));
  assert.notEqual(fdciCatalogMessage("unavailable", null), fdciCatalogMessage("ready", 0));
});

test("stale catalog is not an active offer; fresh proof preserves official fields and private block", async () => {
  const {catalog} = await fixture();
  const {publications} = await integrateFdciCatalog([], catalog, "ready", now(), 3);
  const stale = withFdciPublicVerification(publications, catalog, "stale");
  assert.equal(enrollmentForDisplay(stale[0], new Date(at)), "SIN_FECHA_CONFIRMADA");
  const fresh = withFdciPublicVerification(withFdciPersonalCapability(publications, false, now()), catalog, "ready");
  assert.equal(fdciPublicVerification(fresh[0])?.status, "verified");
  assert.equal(fdciPublicVerification(fresh[0])?.checkedAt, at);
  assert.equal(fresh[0].official_url, catalog.items[0].officialUrl);
  assert.equal(fresh[0].level, catalog.items[0].level);
  assert(fdciPersonalBlocked(fresh[0]));
  const app = readFileSync(new URL("../app/docente-app.tsx", import.meta.url), "utf8");
  assert.match(app, /useFdciCatalogPilot\(data\?\.publications, view === "capacitaciones"\)/u);
});

test("personal buttons require a fresh verified projection and explicit local/canary capability", async () => {
  const { catalog } = await fixture();
  const merged = await integrateFdciCatalog([], catalog, "ready", now(), 3);
  assert(fdciPersonalBlocked(withFdciPersonalCapability(merged.publications, false, now())[0]));
  const enabled = withFdciPersonalCapability(merged.publications, true, now());
  assert(!fdciPersonalBlocked(enabled[0]));
  assert(fdciPersonalBlocked(withFdciPersonalCapability(enabled, true, now() + 86_400_001)[0]));
  const stored = { ...enabled[0], title: "Snapshot conservado", content_hash: await catalogHash({ item: catalog.items[0], evidence: null }) };
  const reloaded = await integrateFdciCatalog([stored], catalog, "ready", now(), 3);
  assert.equal(reloaded.publications.length, 1); assert.equal(reloaded.publications[0].title, stored.title);
  const next = (await integrateFdciCatalog([stored], catalog, "ready", now(), 4)).publications;
  assert.equal(next.length, 1); assert.equal(JSON.parse(next[0].metadata).catalogGeneration, 4);
  const changed = await buildFdciCatalog([{ ...catalog.items[0], summary: "Contenido actualizado" }], at);
  assert.equal((await integrateFdciCatalog([stored], changed, "ready", now(), 5)).publications.length, 0);
});

test("HTTP errors and incomplete JSON never become a displayed catalog", async () => {
  for (const response of [new Response("unavailable", { status: 503 }), new Response('{"items":[', { headers: { "content-type": "application/json" } })]) {
    const read = createFdciVersionedReader(FDCI_RAW_ACTIVE_URL, async () => response, now);
    const result = await read(); assert.equal(result.status, "unavailable"); assert.equal(result.catalog, null);
  }
});

test("a slower old immutable response cannot replace a newer generation", async () => {
  const older = await fixture(), newer = await fixture([], 4);
  let calls = 0, unblock!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { unblock = resolve; });
  const waiting = new Promise<void>(resolve => { started = resolve; });
  const fetcher: typeof fetch = async url => {
    if (String(url) === FDCI_RAW_ACTIVE_URL) return Response.json(calls++ === 0 ? older.pointer : newer.pointer);
    if (String(url).includes(older.catalog.sha256)) { started(); await gate; return Response.json(older.catalog); }
    return Response.json(newer.catalog);
  };
  const read = createFdciVersionedReader(FDCI_RAW_ACTIVE_URL, fetcher, now);
  const slow = read(); await waiting; assert.equal((await read()).generation, 4); unblock();
  const result = await slow; assert.equal(result.generation, 4); assert.deepEqual(result.items, []);
});
