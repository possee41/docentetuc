import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { initialDailyState, sealDailyState, validateDailyState, runDailyBatch, runDailyCheckpoint, createDailyGitStore } from "./daily-sync-state.mjs";
import { collectDailySnapshot, runDailySource } from "./daily-sources.mjs";
import { runDailyNews, newsTarget } from "./news-via-receiver.mjs";
import gateway from "../workers/daily-source-gateway.mjs";

const sha = "a".repeat(40), token = "synthetic_daily_secret_12345678901234567890";
function memory(source = "sime") {
  let stored = { revision: "0".repeat(40), state: initialDailyState(source, sha) }, n = 0;
  return { load: async () => structuredClone(stored), save: async (old, state) => {
    if (old.revision !== stored.revision) throw Error("DAILY_STATE_CONFLICT");
    validateDailyState(state, source, sha);
    stored = { revision: (++n).toString(16).padStart(40, "0"), state: structuredClone(state) }; return structuredClone(stored);
  } };
}
const row = (id, value = id) => ({ id: `sime:${id}`, contentHash: createHash("sha256").update(String(value)).digest("hex") });
const collect = items => async () => ({ items, complete: true });
function sqliteSink() {
  const raw = new DatabaseSync(":memory:"); raw.exec("CREATE TABLE publications(id TEXT PRIMARY KEY,hash TEXT NOT NULL)");
  const calls = [];
  return { raw, calls, send: async payload => {
    calls.push(payload);
    if (payload.mode !== "batch") return { ok: true };
    const item = payload.items[0], old = raw.prepare("SELECT hash FROM publications WHERE id=?").get(item.id);
    raw.prepare("INSERT INTO publications VALUES(?,?) ON CONFLICT(id) DO UPDATE SET hash=excluded.hash WHERE hash<>excluded.hash").run(item.id, item.contentHash);
    return { ok: true, received: 1, created: +!old, updated: +(Boolean(old) && old.hash !== item.contentHash), unchanged: +(old?.hash === item.contentHash) };
  } };
}
const batch = (store, options) => runDailyBatch({ store, source: "sime", codeSha: sha, owner: "1-1", ...options });

test("independent batches continue after confirmed ACK; unchanged records never write twice", async () => {
  const store = memory(), sink = sqliteSink();
  try {
    const one = await batch(store, { collect: collect([row(1), row(2), row(3)]), send: sink.send, limit: 2 });
    assert.equal(one.completed, false); assert.equal(one.pending, 1); assert.equal(one.cursor, "sime:2");
    assert.equal(sink.calls.some(c => c.mode === "finish"), false);
    const two = await batch(store, { owner: "2-1", collect: collect([row(3), row(1), row(2)]), send: sink.send, limit: 2 });
    assert.equal(two.processed, 1); assert.equal(two.completed, true);
    const three = await batch(store, { owner: "3-1", collect: collect([row(1), row(2), row(3)]), send: sink.send });
    assert.equal(three.processed, 0);
    assert.equal(sink.raw.prepare("SELECT count(*) AS n FROM publications").get().n, 3);
    assert.equal(sink.calls.filter(c => c.mode === "batch").length, 3);
  } finally { sink.raw.close(); }
});
test("pending data survives disappearing from the next feed; latest version replaces older pending content", async () => {
  const store = memory(), sink = sqliteSink();
  try {
    await batch(store, { collect: collect([row(1), row(2, "old"), row(3)]), send: sink.send, limit: 1 });
    await batch(store, { owner: "2-1", collect: collect([row(2, "new")]), send: sink.send });
    assert.equal(sink.raw.prepare("SELECT hash FROM publications WHERE id='sime:2'").get().hash, row(2, "new").contentHash);
    assert.equal(sink.raw.prepare("SELECT count(*) AS n FROM publications").get().n, 3);
  } finally { sink.raw.close(); }
});
test("complete empty catalogue succeeds; incomplete or failed collection preserves last success and writes nothing", async () => {
  const store = memory(); let writes = 0;
  const send = async () => { writes++; return { ok: true }; };
  const empty = await batch(store, { collect: collect([]), send }); assert.equal(empty.completed, true);
  const success = (await store.load()).state.data.lastSuccessAt; writes = 0;
  await assert.rejects(batch(store, { collect: async () => ({ complete: false, items: [row(1)] }), send }), /INCOMPLETE/);
  assert.equal(writes, 0); assert.equal((await store.load()).state.data.lastSuccessAt, success);
  assert.equal((await store.load()).state.data.halted, false);
});
test("lost publication ACK preserves intent, never advances cursor and blocks next execution", async () => {
  const store = memory(), sink = sqliteSink();
  try {
    await assert.rejects(batch(store, { collect: collect([row(1)]), send: async payload => {
      const ack = await sink.send(payload); if (payload.mode === "batch") throw Error("NETWORK_AMBIGUOUS"); return ack;
    } }), /NETWORK_AMBIGUOUS/);
    const d = (await store.load()).state.data;
    assert.equal(d.halted, true); assert.equal(d.cursor, ""); assert.equal(d.pending, 1); assert.equal(d.inFlight.id, "sime:1");
    assert.equal(sink.raw.prepare("SELECT count(*) AS n FROM publications").get().n, 1);
    await assert.rejects(batch(store, { owner: "2-1", collect: collect([row(1)]), send: sink.send }), /HALTED/);
  } finally { sink.raw.close(); }
});
test("1102 and invalid ACK suspend without confirming progress", async () => {
  for (const fail of [async () => { throw Error("HTTP_1102"); }, async () => ({ ok: true, received: 1, created: 0, updated: 0, unchanged: 0 })]) {
    const store = memory();
    await assert.rejects(batch(store, { collect: collect([row(1)]), send: async p => p.mode === "batch" ? fail() : { ok: true } }));
    assert.equal((await store.load()).state.data.halted, true);
  }
});
test("concurrent process cannot overwrite claimed cursor; expired lease alone permits a safe restart", async () => {
  const store = memory(); let release, entered;
  const ready = new Promise(r => { entered = r; }), pause = new Promise(r => { release = r; });
  const first = batch(store, { collect: async () => { entered(); await pause; return { complete: true, items: [] }; }, send: async () => ({ ok: true }) });
  await ready;
  await assert.rejects(batch(store, { owner: "2-1", collect: collect([]), send: async () => ({ ok: true }) }), /BUSY/);
  release(); await first;
  const p = await store.load(); await store.save(p, sealDailyState({ ...p.state.data, generation: p.state.data.generation + 1,
    owner: "expired", expiresAt: "2020-01-01T00:00:00.000Z" }));
  assert.equal((await batch(store, { collect: collect([]), send: async () => ({ ok: true }) })).completed, true);
});
test("Juntas interruption retains its checkpoint and blocks unattended retries", async () => {
  const store = memory("juntas");
  await assert.rejects(runDailyCheckpoint({ store, codeSha: sha, owner: "1-1", operation: async () => { throw Error("D1_FAILURE"); } }), /D1_FAILURE/);
  assert.equal((await store.load()).state.data.inFlight.mode, "checkpoint");
  await assert.rejects(runDailyCheckpoint({ store, codeSha: sha, owner: "2-1", operation: async () => ({ completed: true }) }), /HALTED/);
});
test("Git store verifies checksum/provenance, CAS and reads back a lost state ACK without replaying PUT", async () => {
  let current = initialDailyState("sime", sha), puts = 0;
  const gitSha = bytes => createHash("sha1").update(`blob ${Buffer.byteLength(bytes)}\0`).update(bytes).digest("hex");
  const fetcher = async (input, init = {}) => {
    assert.ok(String(input).startsWith("https://api.github.com/repos/possee41/docentetuc/contents/sime.json"));
    const bytes = JSON.stringify(current) + "\n", revision = gitSha(bytes);
    if (init.method === "PUT") { puts++; const p = JSON.parse(init.body); assert.equal(p.branch, "daily-state-sime");
      if (p.sha !== revision) return new Response(null, { status: 409 });
      current = JSON.parse(Buffer.from(p.content, "base64")); throw Error("LOST_GIT_ACK"); }
    return Response.json({ sha: revision, path: "sime.json", type: "file", size: Buffer.byteLength(bytes), encoding: "base64", content: Buffer.from(bytes).toString("base64") });
  };
  const store = createDailyGitStore({ source: "sime", codeSha: sha, token: "fake", fetcher }), prior = await store.load();
  const saved = await store.save(prior, sealDailyState({ ...prior.state.data, generation: 1 }));
  assert.equal(saved.state.data.generation, 1); assert.equal(puts, 1);
  await assert.rejects(store.save(prior, sealDailyState({ ...prior.state.data, generation: 1 })), /CONFLICT/);
  await assert.rejects(createDailyGitStore({ source: "sime", codeSha: sha, token: "fake", fetcher: async () => new Response(null, { status: 404 }) }).load(), /MISSING_NO_RESET/);
  assert.throws(() => validateDailyState({ ...current, sha256: "0".repeat(64) }, "sime", sha), /INVALID/);
  assert.throws(() => validateDailyState(current, "infd", sha), /INVALID/);
});
test("confirmed state survives entirely new Node processes and directories", () => {
  const dir = mkdtempSync(join(tmpdir(), "daily-cursor-"));
  try {
    const script = `import{readFileSync,writeFileSync}from'node:fs';import{initialDailyState,sealDailyState,validateDailyState}from'${new URL("./daily-sync-state.mjs", import.meta.url).href}';const p=process.argv[2];const old=process.argv[3]==='first'?initialDailyState('sime','${sha}'):validateDailyState(JSON.parse(readFileSync(p)),'sime','${sha}');writeFileSync(p,JSON.stringify(sealDailyState({...old.data,generation:old.data.generation+1,cursor:process.argv[3]==='first'?'sime:50':old.data.cursor})));`;
    writeFileSync(join(dir, "run.mjs"), script);
    const path = join(dir, "state.json");
    for (const mode of ["first", "second"]) execFileSync(process.execPath, [join(dir, "run.mjs"), path, mode], { cwd: dir });
    const d = JSON.parse(readFileSync(path)).data; assert.equal(d.generation, 2); assert.equal(d.cursor, "sime:50");
  } finally { rmSync(dir, { recursive: true }); }
});
test("collectors stage in Node: SIME, INFoD, CeNET generate no receiver POST", async () => {
  const now = new Date("2026-10-22T15:00:00Z"); let reads = 0;
  const receiverFetch = async (_url, init = {}) => { assert.equal(init.method, "GET"); reads++; return Response.json({ items: [], nextCursor: null }); };
  const sime = await collectDailySnapshot({ source: "sime", secret: token, endpoint: "https://local.test/api/internal/sime-import" }, {
    now, receiverFetch, sourceFetch: async input => {
      const url = String(input);
      if (url.includes("ObtenerPeriodos")) return Response.json({ periodos: [] });
      throw Error("UNEXPECTED_SOURCE_REQUEST");
    } });
  assert.equal(sime.complete, true); assert.equal(reads, 1);
  for (const source of ["infd", "cenet"]) {
    const sourceFetch = async input => {
      if (source === "cenet") return new Response(readFileSync(new URL("../lib/fixtures/cenet-cohort-sample.html", import.meta.url), "utf8"));
      return new Response(String(input).endsWith("cursos-nacionales-2/") ? '<a href="https://red.infd.edu.ar/cursos-plan-nacional-de-alfabetizacion/">Cursos</a>' : '<p style="font-size:30px"><strong>Curso ficticio local</strong></p><p>Curso autoasistido. INICIO: 14/09</p>');
    };
    const snap = await collectDailySnapshot({ source, secret: token, endpoint: `https://local.test/api/internal/public-source-import/${source}` }, { now, receiverFetch, sourceFetch });
    assert.equal(snap.complete, true); assert.ok(snap.items.length > 0);
  }
});
test("daily runner never reopens retired FDCI production gateway", async () => {
  const config = { DAILY_SOURCES_ENABLED: "true", SYNC_SOURCE: "sime", SIME_IMPORT_SECRET: token,
    IMPORT_GATEWAY_TARGET: "production", IMPORT_GATEWAY_PRODUCTION_ENABLED: "true", IMPORT_GATEWAY_APPROVED_SHA: sha,
    IMPORT_GATEWAY_DATABASE_ID: "baaf5886-0123-4948-96da-aa7106424549", IMPORT_GATEWAY_DATABASE_NAME: "docentetuc-db",
    IMPORT_GATEWAY_ORIGIN: "https://docentetuc-import-1-2.possee41.workers.dev" };
  await assert.rejects(runDailySource(config, sha, { receiverFetch: async () => { throw Error("MUST_NOT_FETCH"); } }), /RETIRED_GATEWAY_FORBIDDEN/);
});
test("daily SIME runner verifies identity, claims state, opens once, propagates owner and closes even on failure", async () => {
  const config = { DAILY_SOURCES_ENABLED: "true", SYNC_SOURCE: "sime", SIME_IMPORT_SECRET: token, GITHUB_RUN_ID: "1", GITHUB_RUN_ATTEMPT: "1",
    IMPORT_GATEWAY_ORIGIN: "http://127.0.0.1:9999", IMPORT_GATEWAY_DATABASE_NAME: "docentetuc-import-canary-1-2",
    IMPORT_GATEWAY_DATABASE_ID: "00000000-0000-4000-8000-000000000012" };
  for (const failure of [null, "identity", "close"]) {
    const store = memory(); const events = [];
    const receiverFetch = async (input, init = {}) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("import-identity")) { events.push("identity"); return failure === "identity" ? new Response(null, { status: 401 }) : Response.json({ name: config.IMPORT_GATEWAY_DATABASE_NAME, id: config.IMPORT_GATEWAY_DATABASE_ID }); }
      if (path.endsWith("import-gate")) {
        const p = JSON.parse(init.body); events.push(p.action);
        assert.equal(p.ttlSeconds, 600); assert.equal(p.source, "sime"); assert.equal(p.owner, "1-1");
        if (p.action === "close" && failure === "close") return new Response(null, { status: 503 });
        return Response.json({ ok: true, source: "sime", owner: "1-1", closed: p.action === "close", expiresAt: new Date(Date.now() + 600_000).toISOString() });
      }
      assert.equal(new Headers(init.headers).get("x-import-gate-owner"), "1-1");
      if (init.method === "GET") return Response.json({ items: [], nextCursor: null });
      events.push(JSON.parse(init.body).mode); return Response.json({ ok: true });
    };
    const options = { store, receiverFetch, sourceFetch: async () => Response.json({ periodos: [] }) };
    if (!failure) {
      assert.equal((await runDailySource(config, sha, options)).completed, true);
      assert.deepEqual(events, ["identity", "open", "start", "finish", "close"]);
    } else {
      await assert.rejects(runDailySource(config, sha, options));
      assert.equal((await store.load()).state.data.halted, true);
      const count = events.length;
      await assert.rejects(runDailySource(config, sha, options), /HALTED/); assert.equal(events.length, count);
      if (failure === "identity") assert.equal(events.includes("open"), false);
      else assert.equal(events.at(-1), "close");
    }
  }
});
test("new receiver: disabled exits before DB; FDCI, oversized TTL, wrong secret and foreign owner rejected", async () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec("CREATE TABLE import_gateway_identity(id INTEGER PRIMARY KEY,database_name TEXT,database_id TEXT); INSERT INTO import_gateway_identity VALUES(1,'local','local'); CREATE TABLE import_gate_lease(id INTEGER PRIMARY KEY,source TEXT,expires_at TEXT,opened_at TEXT,opened_by TEXT)");
  const db = { prepare: sql => { const bound = (args = []) => ({ bind: (...a) => bound(a), first: async () => raw.prepare(sql).get(...args) ?? null,
    run: async () => ({ meta: { changes: Number(raw.prepare(sql).run(...args).changes) } }) }); return bound(); } };
  const env = { DB: db, DAILY_SOURCES_ENABLED: "true", DAILY_RECEIVER_NAME: "docentetuc-sources-1-2", IMPORT_GATE_ENABLED: "false",
    IMPORT_GATE_LEASE_REQUIRED: "true", IMPORT_DATABASE_NAME: "local", IMPORT_DATABASE_ID: "local", SIME_IMPORT_SECRET: token };
  const call = (body, secret = token) => gateway.fetch(new Request("https://local.test/api/internal/import-gate", { method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }), env);
  try {
    assert.equal((await gateway.fetch(new Request("https://local.test/api/internal/sime-import"), {})).status, 503);
    assert.equal((await call({ action: "open", source: "fdci", owner: "a", ttlSeconds: 600 })).status, 400);
    assert.equal((await call({ action: "open", source: "sime", owner: "a", ttlSeconds: 601 })).status, 400);
    assert.equal((await call({ action: "open", source: "sime", owner: "a", ttlSeconds: 600 }, "wrong".repeat(8))).status, 401);
    assert.equal((await call({ action: "open", source: "sime", owner: "a", ttlSeconds: 600 })).status, 200);
    assert.equal((await call({ action: "close", source: "sime", owner: "b" })).status, 409);
    raw.exec("UPDATE import_gate_lease SET expires_at='2020-01-01T00:00:00.000Z'");
    assert.equal((await gateway.fetch(new Request("https://local.test/api/internal/sime-import", { headers: { Authorization: `Bearer ${token}`, "X-Import-Gate-Owner": "a" } }), env)).status, 503);
    assert.equal((await call({ action: "close", source: "sime", owner: "a" })).status, 200);
  } finally { raw.close(); }
});
test("news runner sends bounded articles[] for all registry feeds, never publishing or notifying", async () => {
  const store = memory("news"), bodies = []; const now = new Date("2026-11-08T12:00:00Z");
  const sourceFetch = async input => {
    const url = new URL(String(input));
    const date = "Fri, 06 Nov 2026 12:00:00 GMT";
    const xml = url.hostname.includes("blogspot") ? `<feed><entry><title>Artículo ficticio</title><link rel="alternate" href="https://${url.hostname}/2026/11/local.html"/><published>2026-11-06T12:00:00Z</published><updated>2026-11-06T12:00:00Z</updated></entry></feed>` : `<rss><channel><item><title>Artículo ficticio</title><link>https://${url.hostname}/local/</link><pubDate>${date}</pubDate></item></channel></rss>`;
    return new Response(xml, { headers: { "Content-Type": "application/xml" } });
  };
  const config = { DAILY_SOURCES_ENABLED: "true", NEWS_DISCOVERY_ORIGIN: "https://canary.docentetuc.com.ar", NEWS_DISCOVERY_SECRET: token, GITHUB_RUN_ID: "1", GITHUB_RUN_ATTEMPT: "1" };
  const receiverFetch = async (_url, init) => { const b = JSON.parse(init.body); bodies.push(b);
    return Response.json({ status: "OK", autoPublish: false, notifications: false, totalReceived: 1, result: { created: 1, updated: 0, unchanged: 0, skipped: 0 } }); };
  const first = await runDailyNews(config, sha, { store, sourceFetch, receiverFetch, now });
  assert.equal(first.processed, 3); assert.equal(first.completed, true);
  assert.deepEqual(new Set(bodies.map(b => b.articles[0].feedKey)), new Set(["ministry", "atep", "infod"]));
  assert.ok(bodies.every(b => b.articles.length === 1 && b.maxCandidates === 1 && !Object.hasOwn(b, "feeds")));
  await runDailyNews({ ...config, GITHUB_RUN_ID: "2" }, sha, { store, sourceFetch, receiverFetch, now });
  assert.equal(bodies.length, 3);
  await assert.rejects(runDailyNews(config, sha, { store, sourceFetch: async () => { throw Error("SOURCE_DOWN"); }, receiverFetch, now }), /SOURCE_DOWN/);
  assert.equal(bodies.length, 3); assert.ok((await store.load()).state.data.lastSuccessAt);
  assert.throws(() => newsTarget({ ...config, NEWS_DISCOVERY_ORIGIN: "https://docentetuc.com.ar" }), /NOT_APPROVED/);
});
