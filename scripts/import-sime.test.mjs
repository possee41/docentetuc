import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parseSimeOptions, runSimeImport } from "./import-sime.mjs";
import { resolveGatewayConfig } from "./import-via-gateway.mjs";

const endpoint = "https://sime-receiver.example/api/internal/sime-import";
const token = "synthetic_sime_gateway_secret_123456789";
const now = new Date("2026-10-22T15:00:00Z");

const vacancy = (id) => ({ id, codigo: `PDVC-20261022-${id}`, caracter: "SUPLENTE",
  fechaPublicacionInicio: "22/10/2026 08:00", fechaPublicacionFin: "23/10/2026 18:00",
  cargos: `[9000306/00] ESC. 172 - MAESTRO DE JARDIN ${id}`, abierto: true });

// Synthetic SIME: per-Junta vacancy lists. IDs arrive unsorted on purpose.
function source({ ids = [], broken = [] } = {}) {
  return (async (input) => {
    const url = new URL(String(input));
    const junta = url.pathname.match(/Obtener(?:Periodos|Vacantes)\/(\d)/)?.[1];
    if (junta && broken.includes(Number(junta))) return new Response("", { status: 503 });
    if (url.pathname.startsWith("/Vacantes/ObtenerPeriodos/"))
      return Response.json({ periodos: junta === "1" ? [{ text: "10/2026" }] : [] });
    if (url.pathname.startsWith("/Vacantes/ObtenerVacantes/"))
      return Response.json({ vacantes: junta === "1" ? [...ids].reverse().map(vacancy) : [] });
    if (url.pathname.startsWith("/Vacantes/ObtenerVacante/"))
      return Response.json({ vacante: { descripcion: "Inscripción online por SIME" } });
    throw new Error("SIME_SOURCE_URL_UNEXPECTED");
  });
}

function receiver() {
  const calls = [], sent = [];
  const fetchImpl = async (input, init = {}) => {
    assert.equal(new URL(String(input)).pathname, "/api/internal/sime-import");
    if (!init.method || init.method === "GET") return Response.json({ items: [], nextCursor: null });
    const payload = JSON.parse(init.body);
    calls.push(payload);
    if (payload.mode !== "batch") return Response.json({ ok: true });
    for (const item of payload.items) sent.push(item.id);
    return Response.json({ ok: true, received: payload.items.length, created: payload.items.length,
      updated: 0, unchanged: 0, queries: 1, rowsRead: 1, rowsWritten: payload.items.length });
  };
  return { calls, sent, fetch: fetchImpl,
    modes: () => calls.map((call) => call.mode),
    batches: () => calls.filter((call) => call.mode === "batch").flatMap((call) => call.items.map((item) => item.id)) };
}

function run(options, sourceFetch, sink) {
  return runSimeImport({ endpoint, token, sourceFetch, receiverFetch: sink.fetch, now, ...options });
}

test("el límite acota los envíos, no confirma éxito y deja un punto de reanudación verificable", async () => {
  const sink = receiver();
  const result = await run({ juntas: [1], limit: 2 }, source({ ids: [103, 101, 102] }), sink);
  assert.deepEqual(result, { discovered: 3, created: 2, updated: 0, unchanged: 0, queries: 2, rowsRead: 2,
    rowsWritten: 2, resumedAfter: null, nextResumeAfter: "sime:102", truncated: true, completed: false });
  assert.deepEqual(sink.batches(), ["sime:101", "sime:102"]);
  assert.deepEqual(sink.modes(), ["start", "batch", "batch"]);
});

test("la reanudación continúa donde quedó, sin repetir, y solo la corrida completa confirma", async () => {
  const sink = receiver();
  const first = await run({ juntas: [1], limit: 2 }, source({ ids: [103, 101, 102] }), sink);
  const second = await run({ juntas: [1], limit: 2, resumeAfter: first.nextResumeAfter },
    source({ ids: [103, 101, 102] }), sink);
  assert.deepEqual(sink.batches(), ["sime:101", "sime:102", "sime:103"]);
  assert.deepEqual([second.discovered, second.nextResumeAfter, second.truncated, second.completed], [1, "", false, false]);
  assert.equal(sink.modes().includes("finish"), false);
  const full = await run({ limit: 50 }, source({ ids: [103, 101, 102] }), sink);
  assert.deepEqual([full.discovered, full.completed], [3, true]);
  assert.deepEqual({ ...sink.calls.at(-1) }, { mode: "finish", complete: true, count: 3 });
  assert.deepEqual(sink.batches().slice(3), ["sime:101", "sime:102", "sime:103"]);
});

test("un límite que trunca las cuatro Juntas tampoco declara OK", async () => {
  const sink = receiver();
  const result = await run({ limit: 1 }, source({ ids: [101, 102] }), sink);
  assert.deepEqual([result.truncated, result.completed, sink.modes().includes("finish")], [true, false, false]);
});

test("una Junta inaccesible conserva lo enviado y deja el estado en PARTIAL", async () => {
  const sink = receiver();
  await assert.rejects(run({ limit: 50 }, source({ ids: [101], broken: [2] }), sink), /SIME_PARTIAL_SOURCE/);
  assert.deepEqual(sink.batches(), ["sime:101"]);
  assert.deepEqual(sink.calls.at(-1), { mode: "error", code: "PARTIAL" });
  assert.equal(sink.modes().includes("finish"), false);
});

test("las opciones por entorno son acotadas y fallan cerradas", () => {
  assert.deepEqual(parseSimeOptions({}), { juntas: [1, 2, 3, 4], limit: 50, resumeAfter: "" });
  assert.deepEqual(parseSimeOptions({ SIME_IMPORT_JUNTAS: "3, 1", SIME_IMPORT_LIMIT: "7", SIME_IMPORT_RESUME_AFTER: "sime:42" }),
    { juntas: [1, 3], limit: 7, resumeAfter: "sime:42" });
  for (const config of [{ SIME_IMPORT_JUNTAS: "" }, { SIME_IMPORT_JUNTAS: "1,5" }, { SIME_IMPORT_JUNTAS: "1,1" },
    { SIME_IMPORT_LIMIT: "" }, { SIME_IMPORT_LIMIT: "0" }, { SIME_IMPORT_LIMIT: "1001" }, { SIME_IMPORT_LIMIT: "2.5" },
    { SIME_IMPORT_RESUME_AFTER: "101" }, { SIME_IMPORT_RESUME_AFTER: "sime:x" }])
    assert.throws(() => parseSimeOptions(config), /SIME_IMPORT_OPTIONS_INVALID/);
  const canary = { IMPORT_GATEWAY_ORIGIN: "http://127.0.0.1:8798/",
    IMPORT_GATEWAY_DATABASE_ID: "00000000-0000-4000-8000-000000000012",
    IMPORT_GATEWAY_DATABASE_NAME: "docentetuc-web-canary-1-2-local" };
  assert.throws(() => resolveGatewayConfig({ ...canary, SYNC_SOURCE: "juntas", SIME_IMPORT_SECRET: token }), /GATEWAY_SECRET_INVALID/);
  assert.equal(resolveGatewayConfig({ ...canary, SYNC_SOURCE: "sime", SIME_IMPORT_SECRET: token }).source, "sime");
});

test("el cursor no avanza si el gateway no confirma el lote", async () => {
  const calls = [];
  const failing = async (input, init = {}) => {
    if (!init.method || init.method === "GET") return Response.json({ items: [], nextCursor: null });
    const payload = JSON.parse(init.body);
    calls.push(payload);
    if (payload.mode !== "batch") return Response.json({ ok: true });
    return calls.filter((call) => call.mode === "batch").length === 2
      ? Response.json({ error: "sin confirmación" }, { status: 503 })
      : Response.json({ ok: true, received: 1, created: 1, updated: 0, unchanged: 0, queries: 1, rowsRead: 1, rowsWritten: 1 });
  };
  await assert.rejects(run({ juntas: [1], limit: 3 }, source({ ids: [101, 102, 103] }), { fetch: failing }),
    /SIME_RECEIVER_HTTP_503/);
  assert.equal(calls.some((call) => call.mode === "finish"), false);
  assert.equal(calls.some((call) => call.mode === "error"), true);
});

test("un ACK incompleto no cuenta como confirmación ni permite seguir escribiendo", async () => {
  const calls = [];
  const invalid = async (input, init = {}) => {
    if (!init.method || init.method === "GET") return Response.json({ items: [], nextCursor: null });
    const payload = JSON.parse(init.body);
    calls.push(payload);
    if (payload.mode !== "batch") return Response.json({ ok: true });
    return Response.json({ ok: true, received: 1, created: 0, updated: 0, unchanged: 0, queries: 1, rowsRead: 1, rowsWritten: 0 });
  };
  await assert.rejects(run({ juntas: [1], limit: 3 }, source({ ids: [101, 102] }), { fetch: invalid }),
    /SIME_RECEIVER_ACK_INVALID/);
  assert.equal(calls.filter((call) => call.mode === "batch").length, 1);
  assert.equal(calls.some((call) => call.mode === "finish"), false);
});

test("producción exige habilitación explícita y el SHA aprobado", () => {
  const production = { SYNC_SOURCE: "sime", IMPORT_GATEWAY_ORIGIN: "https://docentetuc-import-1-2.example.workers.dev/",
    IMPORT_GATEWAY_DATABASE_ID: "baaf5886-0123-4948-96da-aa7106424549", IMPORT_GATEWAY_DATABASE_NAME: "docentetuc-db",
    SIME_IMPORT_SECRET: token };
  const approved = "a".repeat(40);
  assert.throws(() => resolveGatewayConfig({ ...production, IMPORT_GATEWAY_TARGET: "production" }, approved),
    /GATEWAY_PRODUCTION_NOT_APPROVED/);
  assert.throws(() => resolveGatewayConfig({ ...production, IMPORT_GATEWAY_TARGET: "production",
    IMPORT_GATEWAY_PRODUCTION_ENABLED: "true" }, "b".repeat(40)), /GATEWAY_PRODUCTION_NOT_APPROVED/);
  assert.throws(() => resolveGatewayConfig({ ...production, IMPORT_GATEWAY_PRODUCTION_ENABLED: "true",
    IMPORT_GATEWAY_APPROVED_SHA: approved }, approved), /GATEWAY_TARGET_FORBIDDEN/);
  assert.equal(resolveGatewayConfig({ ...production, IMPORT_GATEWAY_TARGET: "production",
    IMPORT_GATEWAY_PRODUCTION_ENABLED: "true", IMPORT_GATEWAY_APPROVED_SHA: approved }, approved).source, "sime");
});

test("el workflow sigue siendo manual, solo SIME y con destino canary por defecto", () => {
  const workflow = readFileSync(new URL("../.github/workflows/sime-import.yml", import.meta.url), "utf8");
  assert.match(workflow, /^\s{2}workflow_dispatch:/m);
  assert.equal(/^\s*schedule:/m.test(workflow), false);
  assert.match(workflow, /^\s*SYNC_SOURCE: sime$/m);
  assert.match(workflow, /^\s*IMPORT_GATEWAY_TARGET: \$\{\{ inputs\.target \}\}$/m);
  assert.match(workflow, /^\s*IMPORT_GATEWAY_PRODUCTION_ENABLED: \$\{\{ inputs\.confirm_production && 'true' \|\| 'false' \}\}$/m);
  assert.match(workflow, /^\s*IMPORT_GATEWAY_APPROVED_SHA: \$\{\{ vars\.SIME_IMPORT_REF \}\}$/m);
  assert.match(workflow, /default: canary/);
  assert.match(workflow, /^\s*SIME_IMPORT_SECRET: \$\{\{ secrets\.SIME_IMPORT_SECRET \}\}$/m);
  for (const other of ["FDCI", "CENET", "INFD", "JUNTAS"])
    assert.equal(workflow.includes(`${other}_IMPORT_SECRET`), false);
});
