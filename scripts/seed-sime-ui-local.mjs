// Sends only synthetic public SIME responses to a receiver bound to a local D1.
import { runSimeImport } from "./import-sime.mjs";

const sourceFetch = async (input) => {
  const url = String(input);
  if (url.includes("ObtenerPeriodos")) return Response.json({ periodos: [{ text: "10/2026" }] });
  if (url.includes("ObtenerVacantes/1")) return Response.json({ vacantes: [{
    id: 9401, codigo: "PDVC-20261022-9401", caracter: "SUPLENTE",
    fechaPublicacionInicio: "22/10/2026 08:00", fechaPublicacionFin: "23/10/2026 18:00",
    cargos: "[9000306/00] ESC. 172 - MAESTRO DE JARDIN", abierto: true,
  }] });
  if (url.includes("ObtenerVacantes")) return Response.json({ vacantes: [] });
  if (url.includes("ObtenerVacante/9401")) return Response.json({ vacante: { descripcion: "Inscripción online por SIME", fechaDesignacion: "24/10/2026" } });
  throw new Error("Fuente sintética inesperada");
};

const endpoint = process.env.SIME_IMPORT_URL || "";
if (endpoint !== "http://127.0.0.1:8794/api/internal/sime-import") throw new Error("Solo se permite el receptor local aislado");
console.log(JSON.stringify(await runSimeImport({ endpoint, token: process.env.SIME_IMPORT_SECRET || "", sourceFetch,
  now: new Date("2026-10-22T15:00:00Z") })));
