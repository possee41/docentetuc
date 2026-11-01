import assert from "node:assert/strict";
import test from "node:test";
import { callGate, resolveGateConfig } from "./import-gate.mjs";

const secret = "synthetic_fdci_gateway_secret_123456789";
const base = { SYNC_SOURCE: "fdci", IMPORT_GATEWAY_ORIGIN: "https://docentetuc-import-canary-1-2.possee41.workers.dev",
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
