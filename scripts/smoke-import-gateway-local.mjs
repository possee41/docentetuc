// Run only against the local Workerd gateway on 127.0.0.1:8798.
import assert from "node:assert/strict";
import { resolveGatewayConfig, runGatewayImport } from "./import-via-gateway.mjs";

const config = { SYNC_SOURCE: "sime", IMPORT_GATEWAY_ORIGIN: "http://127.0.0.1:8798/",
  IMPORT_GATEWAY_DATABASE_ID: "00000000-0000-4000-8000-000000000012",
  IMPORT_GATEWAY_DATABASE_NAME: "docentetuc-web-canary-1-2-local",
  SIME_IMPORT_SECRET: "synthetic_sime_gateway_secret_123456789" };
const vacancy = { id: 9401, codigo: "PRUEBA-9401", caracter: "SUPLENTE",
  fechaPublicacionInicio: "22/10/2026 08:00", fechaPublicacionFin: "23/10/2026 18:00",
  cargos: "[9000306/00] ESC. 172 - MAESTRO DE JARDIN", abierto: true };
const sourceFetch = async (input) => {
  const url = String(input);
  if (url.includes("ObtenerPeriodos")) return Response.json({ periodos: [{ text: "10/2026" }] });
  if (url.includes("ObtenerVacantes/1")) return Response.json({ vacantes: [vacancy] });
  if (url.includes("ObtenerVacantes")) return Response.json({ vacantes: [] });
  if (url.includes("ObtenerVacante/9401")) return Response.json({ vacante: { descripcion: "Prueba local sin datos personales" } });
  throw new Error("UNEXPECTED_SOURCE_URL");
};
const target = resolveGatewayConfig(config);
const first = await runGatewayImport(target, config, sourceFetch);
const second = await runGatewayImport(target, config, sourceFetch);
assert.equal(first.created + first.unchanged, 1);
assert.equal(second.created, 0);
assert.equal(second.updated, 0);
assert.equal(second.unchanged, 1);
console.log(JSON.stringify({ local: true, first: { created: first.created, updated: first.updated },
  repeat: { created: second.created, updated: second.updated, unchanged: second.unchanged } }));
