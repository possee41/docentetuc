import assert from "node:assert/strict";
import test from "node:test";
import { collectFdci, runFdciImport } from "../scripts/import-fdci.mjs";
import { prepareFdciImports, validFdciImport } from "./fdci-import.ts";

const course = { capacitacion_id: 42, nombre: "Capacitación sintética", token: "synthetic", slug: "curso", niveles: "Primaria" };
const commission = { id: 6379, capacitacion_id: 42, fecha_apertura_preinscripcion: "2026-10-17 23:00:00", fecha_cierre_preinscripcion: "2026-10-19 08:00:00" };
const selection = { token: course.token, slug: course.slug, commissionId: String(commission.id) };
const endpoint = "https://receiver.example/api/internal/fdci-import";
const token = "synthetic_receiver_secret_1234567890";

test("un contenido FDCI extenso conserva datos críticos bajo el límite del receptor", async () => {
  const [row] = await prepareFdciImports([{ ...course, contenido: "Contenido oficial ".repeat(650) }],
    [{ ...commission, cupo_disponible_pre: 0 }]);
  const metadata = JSON.parse(row.metadata);
  assert.ok(row.metadata.length <= 6000);
  assert.equal(validFdciImport(row), true);
  assert.equal(metadata.trainingId, String(course.capacitacion_id));
  assert.equal(metadata.sourceUrl, row.officialUrl);
  assert.equal(metadata.registrationOpensAt, "2026-10-17T23:00:00-03:00");
  assert.equal(metadata.availablePreCapacity, 0);
  assert.ok(metadata.content.endsWith("…"));
});

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

test("modo activo consulta solo el curso activo y no incorpora otras comisiones ni cursos sin fecha próxima", async () => {
  const active = { ...commission, id: 6386, capacitacion_id: 3099, cupo_disponible_pre: 99 };
  const parent = { ...course, capacitacion_id: 3099, token: "WjvM7pmw", slug: "curso-activo", proxima_fecha_preinscripcion: null };
  const other = { ...course, capacitacion_id: 3096, token: "other", slug: "curso-no-activo", proxima_fecha_preinscripcion: null };
  const calls: string[] = [];
  const sent: string[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("getCapaActivas")) return Response.json([active]);
    if (url.endsWith("getRestoCapas")) return Response.json([parent, other]);
    if (url.endsWith("getCupo")) return Response.json({ comisiones: [active, { ...active, id: 6387 }] });
    if (url === endpoint) {
      const items = JSON.parse(String(init?.body)).items;
      sent.push(...items.map((item: { id: string }) => item.id));
      return Response.json({ ok: true, received: items.length, created: items.length, updated: 0, unchanged: 0 });
    }
    throw new Error("unexpected URL");
  };
  const result = await runFdciImport({ endpoint, token, scope: "active", fetcher });
  assert.equal(calls.filter((url) => url.endsWith("getCupo")).length, 1);
  assert.deepEqual(sent, ["fdci:commission:6386"]);
  assert.equal(result.completed, false);
});

test("barrido completo recupera cursos sin fecha próxima y envía como máximo un registro por solicitud", async () => {
  const courses = Array.from({ length: 7 }, (_, index) => ({ ...course, capacitacion_id: index + 40, token: `token${index}`, slug: `curso-${index}`, proxima_fecha_preinscripcion: null }));
  let details = 0;
  const sent: number[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("getCapaActivas")) return Response.json([]);
    if (url.endsWith("getRestoCapas")) return Response.json(courses);
    if (url.endsWith("getCupo")) { details++; return Response.json({ comisiones: [] }); }
    if (url === endpoint) {
      const items = JSON.parse(String(init?.body)).items;
      sent.push(items.length);
      return Response.json({ ok: true, received: items.length, created: items.length, updated: 0, unchanged: 0 });
    }
    throw new Error("unexpected URL");
  };
  const result = await runFdciImport({ endpoint, token, scope: "full", fetcher });
  assert.equal(details, 7);
  assert.deepEqual(sent, Array(7).fill(1));
  assert.equal(result.completed, true);
});

test("una respuesta activa incompleta no escribe ni declara éxito", async () => {
  let writes = 0;
  const fetcher = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("getCapaActivas")) return Response.json([{ ...commission, capacitacion_id: 999 }]);
    if (url.endsWith("getRestoCapas")) return Response.json([course]);
    if (url === endpoint) { writes++; return Response.json({ ok: true }); }
    throw new Error("unexpected URL");
  };
  await assert.rejects(runFdciImport({ endpoint, token, scope: "active", fetcher }), /FDCI_SELECTION_INCOMPLETE/);
  assert.equal(writes, 0);
});

test("el barrido completo guarda cursos sanos ante un detalle fallido, sin declarar éxito", async () => {
  const sent: string[] = [];
  const healthy = { ...course, capacitacion_id: 43, token: "healthy", slug: "sano" };
  const failed = { ...course, capacitacion_id: 44, token: "failed", slug: "incompleto" };
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("getCapaActivas")) return Response.json([]);
    if (url.endsWith("getRestoCapas")) return Response.json([healthy, failed]);
    if (url.endsWith("getCupo")) return Response.json(JSON.parse(String(init?.body)).token === "healthy" ? { comisiones: [] } : {});
    if (url === endpoint) {
      const items = JSON.parse(String(init?.body)).items as { id: string }[];
      sent.push(...items.map((item) => item.id));
      return Response.json({ ok: true, received: items.length, created: items.length, updated: 0, unchanged: 0 });
    }
    throw new Error("unexpected URL");
  };
  await assert.rejects(runFdciImport({ endpoint, token, scope: "full", fetcher }), (error: Error & {
    failures?: number; diagnostics?: { schema: number }; result?: { created: number; discovered: number };
  }) => {
    assert.equal(error.message, "FDCI_PARTIAL_SOURCE");
    assert.equal(error.failures, 1);
    assert.equal(error.diagnostics?.schema, 1);
    assert.equal(error.result?.created, 2);
    assert.equal(error.result?.discovered, 2);
    return true;
  });
  assert.ok(sent.includes("fdci:course:43"));
  assert.ok(!sent.some((id) => id.startsWith("fdci:commission:")));
});

test("clasifica HTTP y JSON inválido sin atribuir un éxito al detalle", async () => {
  const courses = [{ ...course, capacitacion_id: 47, token: "http", slug: "http" },
    { ...course, capacitacion_id: 48, token: "json", slug: "json" }];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("getCapaActivas")) return Response.json([]);
    if (url.endsWith("getRestoCapas")) return Response.json(courses);
    if (url.endsWith("getCupo")) return JSON.parse(String(init?.body)).token === "http" ?
      new Response(null, { status: 404 }) : new Response("{", { status: 200 });
    throw new Error("unexpected URL");
  };
  const result = await collectFdci(fetcher, undefined, "full");
  assert.equal(result.failures, 2);
  assert.equal(result.diagnostics?.http.HTTP_404, 1);
  assert.equal(result.diagnostics?.invalidJson, 1);
});

test("un registro rechazado no bloquea los siguientes ni declara el catálogo completo", async () => {
  const first = { ...course, capacitacion_id: 45, token: "first", slug: "primero" };
  const second = { ...course, capacitacion_id: 46, token: "second", slug: "segundo" };
  const collected = await collectFdci(async (input: RequestInfo | URL) => Response.json(
    String(input).endsWith("getRestoCapas") ? [first, second] : String(input).endsWith("getCupo") ? { comisiones: [] } : []));
  const sent: string[] = [];
  const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
    const id = (JSON.parse(String(init?.body)).items as { id: string }[])[0].id;
    sent.push(id);
    return id === "fdci:course:45" ? Response.json({ error: "Lote inválido." }, { status: 400 }) :
      Response.json({ ok: true, received: 1, created: 1, updated: 0, unchanged: 0 });
  };
  await assert.rejects(runFdciImport({ endpoint, token, scope: "full", fetcher, collect: async () => collected }),
    (error: Error & { failures?: number; result?: { created: number; rejected: number } }) => {
      assert.equal(error.message, "FDCI_PARTIAL_SOURCE");
      assert.equal(error.failures, 1);
      assert.equal(error.result?.created, 1);
      assert.equal(error.result?.rejected, 1);
      return true;
    });
  assert.deepEqual(sent, ["fdci:course:45", "fdci:course:46"]);
});
