// One synthetic SIME import per invocation. This script cannot target production.
import { resolveGatewayConfig, runGatewayImport } from "./import-via-gateway.mjs";

const config = {
  SYNC_SOURCE: "sime",
  IMPORT_GATEWAY_TARGET: "canary",
  IMPORT_GATEWAY_ORIGIN: "https://docentetuc-import-canary-1-2.possee41.workers.dev/",
  IMPORT_GATEWAY_DATABASE_ID: "853e2f5d-89b1-46a3-9c1c-5cbd46784756",
  IMPORT_GATEWAY_DATABASE_NAME: "docentetuc-web-canary-1-2",
  SIME_IMPORT_SECRET: process.env.SIME_IMPORT_SECRET,
};
const vacancy = {
  id: 9401, codigo: "PRUEBA-9401", caracter: "SUPLENTE",
  fechaPublicacionInicio: "22/10/2026 08:00", fechaPublicacionFin: "23/10/2026 18:00",
  cargos: "[9000306/00] ESC. 172 - MAESTRO DE JARDIN", abierto: true,
};
const sourceFetch = async (input) => {
  const url = String(input);
  if (url.includes("ObtenerPeriodos")) return Response.json({ periodos: [{ text: "10/2026" }] });
  if (url.includes("ObtenerVacantes/1")) return Response.json({ vacantes: [vacancy] });
  if (url.includes("ObtenerVacantes")) return Response.json({ vacantes: [] });
  if (url.includes("ObtenerVacante/9401"))
    return Response.json({ vacante: { descripcion: "Prueba canary sin datos personales" } });
  throw new Error("UNEXPECTED_SOURCE_URL");
};

try {
  const target = resolveGatewayConfig(config);
  const result = await runGatewayImport(target, config, sourceFetch);
  console.log(JSON.stringify({ synthetic: true, source: "sime", ...result }));
} catch (error) {
  console.error("CANARY_SIME_IMPORT_FAILED", error instanceof Error && /^[A-Z_0-9]+$/.test(error.message)
    ? error.message : "CANARY_SIME_IMPORT_FAILED");
  process.exitCode = 1;
}
