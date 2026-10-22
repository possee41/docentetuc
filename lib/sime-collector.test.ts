import assert from "node:assert/strict";
import test from "node:test";
import { collectSimePublications } from "./sime-collector.ts";
import { officialMetadata } from "./official-publication.ts";

const vacancy = { id: 9401, codigo: "PDVC-20261022-9401", caracter: "SUPLENTE", fechaPublicacionInicio: "22/10/2026 08:00", fechaPublicacionFin: "23/10/2026 18:00", cargos: "[9000306/00] ESC. 172 - MAESTRO DE JARDIN", abierto: true };
const now = new Date("2026-10-22T15:00:00Z");

test("el mismo recolector SIME sirve a Node y Worker sin datos privados ni ausencias falsas", async () => {
  const urls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("ObtenerPeriodos")) return Response.json({ periodos: [{ text: "10/2026" }] });
    if (url.includes("ObtenerVacantes/1")) return Response.json({ vacantes: [vacancy] });
    if (url.includes("ObtenerVacantes")) return Response.json({ vacantes: [] });
    if (url.includes("ObtenerVacante/9401")) return Response.json({ vacante: { descripcion: "Inscripción online por SIME", fechaDesignacion: "24/10/2026", designado: "dato privado que no debe guardarse" } });
    throw new Error("URL inesperada");
  }) as typeof fetch;
  const result = await collectSimePublications(new Map(), fetcher, now);
  assert.equal(result.complete, true);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, "sime:9401");
  assert.deepEqual(officialMetadata(result.items[0])?.topics, ["INSCRIPCION_SIME"]);
  assert.equal(officialMetadata(result.items[0])?.facts.designation?.value, "2026-10-24");
  assert.equal(JSON.stringify(result).includes("dato privado"), false);
  assert.equal(urls.filter((url) => url.includes("ObtenerVacante/")).length, 1);
});

test("un detalle inaccesible deja el barrido incompleto y conserva la vacante pública", async () => {
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("ObtenerPeriodos")) return Response.json({ periodos: [{ text: "10/2026" }] });
    if (url.includes("ObtenerVacantes/1")) return Response.json({ vacantes: [vacancy] });
    if (url.includes("ObtenerVacantes")) return Response.json({ vacantes: [] });
    return new Response("", { status: 503 });
  }) as typeof fetch;
  const result = await collectSimePublications(new Map(), fetcher, now);
  assert.equal(result.complete, false);
  assert.deepEqual(result.items.map((item) => item.id), ["sime:9401"]);
  assert.equal(officialMetadata(result.items[0])?.detailStatus, "PENDING");
});
