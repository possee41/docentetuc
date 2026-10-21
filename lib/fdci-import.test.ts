import assert from "node:assert/strict";
import test from "node:test";
import { collectFdci, runFdciImport } from "../scripts/import-fdci.mjs";

const course = { capacitacion_id: 42, nombre: "Capacitación sintética", token: "synthetic", slug: "curso", niveles: "Primaria" };
const commission = { id: 6379, capacitacion_id: 42, fecha_apertura_preinscripcion: "2026-10-17 23:00:00", fecha_cierre_preinscripcion: "2026-10-19 08:00:00" };
const selection = { token: course.token, slug: course.slug, commissionId: String(commission.id) };
const endpoint = "https://receiver.example/api/internal/fdci-import";
const token = "synthetic_receiver_secret_1234567890";

test("la selección consulta un solo detalle y conserva la fecha oficial de la comisión", async () => {
  const calls: string[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("getCapaActivas")) return Response.json([]);
    if (url.endsWith("getRestoCapas")) return Response.json([course, { ...course, capacitacion_id: 43, token: "other", slug: "otro" }]);
    if (url.endsWith("getCupo")) {
      assert.equal(JSON.parse(String(init?.body)).token, course.token);
      return Response.json({ comisiones: [commission, { ...commission, id: 6380 }] });
    }
    throw new Error("unexpected URL");
  };
  const result = await collectFdci(fetcher, selection);
  assert.equal(result.coursesFetched, 1);
  assert.equal(calls.filter((url) => url.endsWith("getCupo")).length, 1);
  assert.deepEqual(result.items.map((item: { id: string }) => item.id), ["fdci:commission:6379"]);
  assert.equal(result.items[0].registrationOpenAt, "2026-10-17T23:00:00-03:00");
  assert.equal(result.items[0].registrationCloseAt, "2026-10-19T08:00:00-03:00");
});

test("la importación puntual envía un lote, sin marcar éxito del catálogo ni ausencias", async () => {
  const { items, failures, coursesFetched } = await collectFdci(async (input: RequestInfo | URL) => Response.json(String(input).endsWith("getCupo") ? { comisiones: [commission] } : String(input).endsWith("getRestoCapas") ? [course] : []), selection);
  const modes: string[] = [];
  const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { mode: string; items: unknown[] };
    modes.push(body.mode);
    return Response.json({ ok: true, received: body.items.length, created: 1, updated: 0, unchanged: 0 });
  };
  const result = await runFdciImport({ endpoint, token, selection, fetcher, collect: async () => ({ items, failures, coursesFetched }) });
  assert.deepEqual(modes, ["batch"]);
  assert.equal(result.completed, false);
  assert.equal(result.discovered, 1);
});

test("fuente incompleta, comisión inexistente y selección inválida fallan sin escrituras", async () => {
  const emptySource = async (input: RequestInfo | URL) => Response.json(String(input).endsWith("getCupo") ? { comisiones: [] } : String(input).endsWith("getRestoCapas") ? [course] : []);
  await assert.rejects(collectFdci(emptySource, selection), /FDCI_COMMISSION_NOT_FOUND/);
  let writes = 0;
  const receiver = async () => { writes++; return Response.json({ ok: true }); };
  await assert.rejects(runFdciImport({ endpoint, token, selection, fetcher: receiver, collect: async () => ({ items: [], failures: 1, coursesFetched: 1 }) }), /FDCI_EMPTY_RESPONSE/);
  await assert.rejects(runFdciImport({ endpoint, token, selection: { ...selection, commissionId: "bad" }, fetcher: receiver }), /FDCI_SELECTION_INVALID/);
  await assert.rejects(runFdciImport({ endpoint, token, fetcher: receiver }), /FDCI_SELECTION_INVALID/);
  assert.equal(writes, 0);
});
