import assert from "node:assert/strict";
import test from "node:test";
import { callGate, resolveGateConfig, runFdciGatewayJob } from "./import-gate.mjs";
import { fdciSafety, safeImportError } from "./import-via-gateway.mjs";

const secret = "synthetic_fdci_gateway_secret_123456789";
const base = { SYNC_SOURCE: "fdci", IMPORT_GATEWAY_ORIGIN: "https://docentetuc-import-canary-1-2.possee41.workers.dev",
  IMPORT_GATEWAY_DATABASE_ID: "00000000-0000-4000-8000-000000000012",
  IMPORT_GATEWAY_DATABASE_NAME: "docentetuc-web-canary-1-2",
  FDCI_IMPORT_SECRET: secret, IMPORT_GATE_RUN_ID: "test-run" };

test("acepta solo orígenes de gateway aislados y secretos válidos", () => {
  assert.equal(resolveGateConfig({ ...base }).source, "fdci");
  assert.equal(resolveGateConfig({ ...base,
    IMPORT_GATEWAY_ORIGIN: "https://docentetuc-import-1-2.possee41.workers.dev" }).source, "fdci");
  assert.throws(() => resolveGateConfig({ ...base, IMPORT_GATEWAY_ORIGIN: "https://example.com" }), /GATE_CONFIG_INVALID/);
  assert.throws(() => resolveGateConfig({ ...base, IMPORT_GATEWAY_ORIGIN: "https://docentetuc-import-canary-1-2.possee41.workers.dev/x" }),
    /GATE_CONFIG_INVALID/);
  assert.throws(() => resolveGateConfig({ ...base, FDCI_IMPORT_SECRET: "corto" }), /GATE_SECRET_INVALID/);
  assert.throws(() => resolveGateConfig({ ...base, SYNC_SOURCE: "otra" }), /GATE_SOURCE_INVALID/);
});

test("abre y cierra con el secreto de la fuente, sin aceptar respuestas dudosas", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), auth: init.headers.authorization });
    const body = JSON.parse(init.body);
    return new Response(JSON.stringify(body.action === "open"
      ? { ok: true, source: "fdci", owner: "test-run", expiresAt: new Date(Date.now() + 600_000).toISOString() }
      : { ok: true, source: "fdci", owner: "test-run", closed: true }), { status: 200 });
  };
  const opened = await callGate("open", { ...base, IMPORT_GATE_TTL_SECONDS: "600" }, fetcher);
  assert.equal(opened.action, "open");
  assert.ok(opened.expiresAt);
  const closed = await callGate("close", base, fetcher);
  assert.equal(closed.action, "close");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://docentetuc-import-canary-1-2.possee41.workers.dev/api/internal/import-gate");
  assert.equal(calls[0].body.source, "fdci");
  assert.equal(calls[0].auth, `Bearer ${secret}`);

  await assert.rejects(callGate("open", base, async () => new Response("{}", { status: 503 })), /GATE_HTTP_503/);
  await assert.rejects(callGate("open", base, async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    /GATE_RESPONSE_INVALID/);
  await assert.rejects(callGate("open", base, async () => new Response(JSON.stringify({ ok: true,
    expiresAt: "2000-01-01T00:00:00.000Z" }), { status: 200 })), /GATE_RESPONSE_INVALID/);
  await assert.rejects(callGate("close", base, async () => Response.json({ ok: false })), /GATE_RESPONSE_INVALID/);
  await assert.rejects(callGate("close", base, async () => { throw new Error("offline"); }), /GATE_UNAVAILABLE/);
  await assert.rejects(callGate("reabrir", base, fetcher), /GATE_ACTION_INVALID/);
});

const jobConfig = { ...base, IMPORT_GATEWAY_ENABLED: "true", FDCI_SCOPE: "active" };
const course = { capacitacion_id: 42, nombre: "Curso ficticio", token: "ficticio", slug: "ficticio" };
const commission = { id: 9001, capacitacion_id: 42, fecha_apertura_preinscripcion: "2026-10-17 23:00:00", fecha_cierre_preinscripcion: "2026-10-19 08:00:00" };

function fixture(options = {}) {
  const calls = [], ids = new Map();
  let writes = 0;
  const receiver = async (url, init = {}) => {
    if (String(url).includes("import-identity")) {
      calls.push("identity");
      return Response.json({ name: base.IMPORT_GATEWAY_DATABASE_NAME, id: base.IMPORT_GATEWAY_DATABASE_ID });
    }
    const body = JSON.parse(init.body);
    if (body.action) {
      calls.push(body.action);
      if (options.openAmbiguous && body.action === "open") throw new Error("private token must never appear");
      if (options.closeFailure && body.action === "close") return new Response(null, { status: 503 });
      return Response.json({ ok: true, source: "fdci", owner: "test-run", closed: true, expiresAt: new Date(Date.now() + 600000).toISOString() });
    }
    calls.push("import");
    assert.equal(init.headers["x-import-gate-owner"], "test-run");
    const item = body.items[0];
    const existed = ids.has(item.id), changed = ids.get(item.id) !== item.contentHash;
    ids.set(item.id, item.contentHash);
    if (changed) writes++;
    if (options.ambiguous) throw new Error("private response lost");
    return Response.json({ ok: true, received: 1, created: !existed ? 1 : 0, updated: existed && changed ? 1 : 0, unchanged: !changed ? 1 : 0 });
  };
  const source = async (url, init = {}) => {
    calls.push("official");
    if (options.abort) { options.abort.abort(); throw new Error("cancelled"); }
    if (options.rateLimit) return new Response(null, { status: 429 });
    if (String(url).endsWith("getCapaActivas")) return Response.json(options.commissions || [commission]);
    if (String(url).endsWith("getRestoCapas")) return Response.json(options.courses || [course]);
    assert.equal(JSON.parse(init.body).token, "ficticio");
    return Response.json({ comisiones: options.commissions || [commission] });
  };
  return { calls, ids, source, receiver, writes: () => writes };
}

test("destino incompleto, SHA no aprobado y presupuestos ampliados nunca abren concesiones", async () => {
  const production = { ...jobConfig, IMPORT_GATEWAY_TARGET: "production", IMPORT_GATEWAY_DATABASE_NAME: "docentetuc-db",
    IMPORT_GATEWAY_DATABASE_ID: "baaf5886-0123-4948-96da-aa7106424549", IMPORT_GATEWAY_ORIGIN: "https://docentetuc-import-1-2.possee41.workers.dev" };
  for (const config of [production, { ...production, IMPORT_GATEWAY_PRODUCTION_ENABLED: "true", IMPORT_GATEWAY_APPROVED_SHA: "a".repeat(40) },
    { ...jobConfig, FDCI_MAX_REQUESTS: "7" }, { ...jobConfig, FDCI_MAX_PUBLICATIONS: "6" },
    { ...jobConfig, FDCI_PAUSE_MS: "0" }, { ...jobConfig, FDCI_SCOPE: "full" }, { ...jobConfig, SYNC_SOURCE: "constructor" }]) {
    const f = fixture();
    const result = await runFdciGatewayJob(config, "b".repeat(40), f.source, f.receiver);
    assert.equal(result.status, "ERROR");
    assert.equal(f.calls.length, 0);
  }
  assert.throws(() => fdciSafety({ ...jobConfig, IMPORT_GATE_RUN_ID: "" }), /GATE_RUN_ID_REQUIRED/);
  assert.throws(() => resolveGateConfig({ ...jobConfig, IMPORT_GATE_TTL_SECONDS: "601" }), /GATE_TTL_INVALID/);
});

test("job acotado, repetición sin escrituras y cierre confirmado", async () => {
  const f = fixture();
  const first = await runFdciGatewayJob(jobConfig, "", f.source, f.receiver);
  assert.equal(first.status, "OK");
  assert.equal(first.created, 1);
  assert.equal(first.rejected, 0);
  assert.equal(first.sourceRequests, 3);
  assert.equal(first.closed, true);
  assert.ok(f.calls.indexOf("identity") < f.calls.indexOf("open"));
  const second = await runFdciGatewayJob(jobConfig, "", f.source, f.receiver);
  assert.equal(second.unchanged, 1);
  assert.equal(second.updated, 0);
  assert.equal(f.writes(), 1);
  assert.equal(f.ids.size, 1);
  assert.equal(f.calls.at(-1), "close");
});

test("respuesta perdida después de escritura no reintenta y cierra conservando incertidumbre", async () => {
  const f = fixture({ ambiguous: true });
  const result = await runFdciGatewayJob(jobConfig, "", f.source, f.receiver);
  assert.equal(result.status, "ERROR");
  assert.equal(result.code, "IMPORT_RESULT_UNCERTAIN");
  assert.equal(result.uncertain, 1);
  assert.equal(result.closed, true);
  assert.equal(f.calls.filter(x => x === "import").length, 1);
  assert.equal(f.writes(), 1);
  assert.doesNotMatch(JSON.stringify(result), /private|token|secret/);
});

test("apertura ambigua, cancelación, 429 y fallo del cierre quedan explícitos sin reintentos ciegos", async () => {
  for (const options of [{ openAmbiguous: true }, { abort: new AbortController() }, { rateLimit: true }, { rateLimit: true, closeFailure: true }]) {
    const f = fixture(options);
    const result = await runFdciGatewayJob(jobConfig, "", f.source, f.receiver, options.abort?.signal);
    assert.notEqual(result.status, "OK");
    assert.equal(f.calls.filter(x => x === "open").length, 1);
    assert.equal(f.calls.filter(x => x === "close").length, 1);
    assert.equal(f.writes(), 0);
    assert.equal(result.closed, !options.closeFailure);
    if (options.rateLimit) assert.equal(f.calls.filter(x => x === "official").length, 1);
    if (options.abort) assert.equal(f.calls.filter(x => x === "official").length, 1);
  }
});

test("reintentos de lectura cuentan dentro del presupuesto y un ACK inválido nunca se reenvía", async () => {
  const limited = fixture();
  let attempts = 0;
  const failingSource = async () => { attempts++; return new Response(null, { status: 503 }); };
  const result = await runFdciGatewayJob({ ...jobConfig, FDCI_MAX_REQUESTS: "2" }, "", failingSource, limited.receiver);
  assert.equal(attempts, 2);
  assert.equal(result.sourceRequests, 2);
  assert.equal(result.status, "PARTIAL");
  assert.equal(result.closed, true);

  const f = fixture();
  let imports = 0;
  const receiver = async (url, init) => {
    if (String(url).endsWith("fdci-import")) {
      imports++;
      return Response.json({ ok: true, received: 1, created: 99, updated: 0, unchanged: 0 });
    }
    return f.receiver(url, init);
  };
  const invalid = await runFdciGatewayJob(jobConfig, "", f.source, receiver);
  assert.equal(invalid.code, "IMPORT_ACK_INVALID");
  assert.equal(invalid.uncertain, 1);
  assert.equal(invalid.created, 0);
  assert.equal(imports, 1);
  assert.equal(invalid.closed, true);
});

test("un runner concurrente que pierde open no importa ni cierra la concesión ajena", async () => {
  const f = fixture();
  const otherOwner = "running-b";
  const receiver = async (url, init) => {
    if (String(url).endsWith("import-gate")) {
      const body = JSON.parse(init.body);
      assert.equal(body.owner, "test-run");
      assert.notEqual(body.owner, otherOwner);
      return new Response(null, { status: 409 });
    }
    return f.receiver(url, init);
  };
  const result = await runFdciGatewayJob(jobConfig, "", f.source, receiver);
  assert.equal(result.code, "GATE_HTTP_409");
  assert.equal(result.closed, false);
  assert.equal(result.closeCode, "GATE_HTTP_409");
  assert.equal(otherOwner, "running-b");
  assert.equal(f.calls.filter(x => x === "official" || x === "import").length, 0);
});

test("límites duros y exclusiones dejan PARTIAL sin tocar históricos", async () => {
  const records = [commission, { ...commission, id: 6375 }, { id: 9003, capacitacion_id: 42 }, { ...commission, id: 9004 }];
  const f = fixture({ commissions: records });
  const result = await runFdciGatewayJob({ ...jobConfig, FDCI_MAX_PUBLICATIONS: "1" }, "", f.source, f.receiver);
  assert.equal(result.status, "PARTIAL");
  assert.equal(result.created, 1);
  assert.equal(result.skipped, 2);
  assert.equal(result.deferred, 1);
  assert.deepEqual([...f.ids.keys()], ["fdci:commission:9001"]);
  assert.equal(result.closed, true);
  const exhausted = fixture();
  const limited = await runFdciGatewayJob({ ...jobConfig, FDCI_MAX_REQUESTS: "2" }, "", exhausted.source, exhausted.receiver);
  assert.equal(limited.status, "PARTIAL");
  assert.equal(limited.sourceRequests, 2);
  assert.equal(limited.sourceErrors.requestLimit, 1);
  assert.equal(exhausted.writes(), 0);
});

test("diagnóstico solo expone contadores y códigos, sin propiedades arbitrarias", () => {
  const error = new Error("https://private.example/secret");
  error.result = { created: 1, updated: -1, rejected: "token", url: "secret" };
  error.diagnostics = { http: { HTTP_429: 1, SECRET: 3 }, timeoutOrNetwork: 2 };
  const result = safeImportError(error);
  assert.equal(result.created, 1);
  assert.equal(result.updated, 0);
  assert.equal(result.rejected, 0);
  assert.equal(result.sourceErrors.HTTP_429, 1);
  assert.doesNotMatch(JSON.stringify(result), /private|secret|SECRET/);
});
