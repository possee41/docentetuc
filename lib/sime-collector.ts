import { officialMetadata, readMetadata, withOfficial, type CollectedPublication } from "./official-publication.ts";
import { SourceSyncError, sourceErrorCode } from "./publication-lifecycle.ts";
import { fetchSourceJson } from "./source-fetch.ts";
import { applySimeDetail, normalizeSimeVacancy, selectSimeDetails, validSimeDetail, type SimeDetail, type SimeVacancy } from "./sime-publications.ts";

const juntas = [
  [1, "Inicial y Primaria"], [2, "Secundaria"], [3, "Técnica, Agrotécnica y No Formal"], [4, "Superior, Especial y Artística"],
] as const;

// Shared by the legacy route and the external runner; this only reads the public SIME API.
export async function collectSimePublications(previous: Map<string, { metadata: string }>, fetcher: typeof fetch = fetch, now = new Date()) {
  const items: CollectedPublication[] = [];
  const records = new Map<string, { vacancy: SimeVacancy; junta: string; juntaId: number }>();
  for (const [juntaId, junta] of juntas) {
    const options = { source: "SIME", signal: AbortSignal.timeout(15_000), headers: { Accept: "application/json", "User-Agent": "DocenteTuc/1.0 (+agregador de fuentes publicas)" }, fetcher };
    const periodData = await fetchSourceJson<{ periodos: { text: string }[] }>(`https://sime.educaciontuc.gov.ar/Vacantes/ObtenerPeriodos/${juntaId}?caracter=-1&tab=1`, options);
    if (!Array.isArray(periodData?.periodos)) throw new SourceSyncError("SCHEMA_ERROR", "SIME periodos shape changed");
    if (!periodData.periodos.length) continue;
    const periodText = periodData.periodos[0]?.text;
    if (typeof periodText !== "string" || !periodText.trim()) throw new SourceSyncError("SCHEMA_ERROR", "SIME period text is missing");
    const [month = "", year = ""] = periodText.split("/");
    const data = await fetchSourceJson<{ vacantes: SimeVacancy[] }>(`https://sime.educaciontuc.gov.ar/Vacantes/ObtenerVacantes/${juntaId}?caracter=-1&tab=1&mesBuscar=${month}&anioBuscar=${year}`, { ...options, signal: AbortSignal.timeout(15_000) });
    if (!Array.isArray(data?.vacantes)) throw new SourceSyncError("SCHEMA_ERROR", "SIME vacantes shape changed");
    if (data.vacantes.some((vacancy) => !vacancy || !Number.isFinite(vacancy.id) || typeof vacancy.cargos !== "string")) throw new SourceSyncError("SCHEMA_ERROR", "SIME vacancy record shape changed");
    for (const vacancy of data.vacantes) {
      records.set(`sime:${vacancy.id}`, { vacancy, junta, juntaId });
      items.push(normalizeSimeVacancy(vacancy, junta, juntaId, previous.get(`sime:${vacancy.id}`)?.metadata, now));
    }
  }
  // Keep checking a known upcoming act after its vacancy leaves the current period.
  const today = now.toISOString().slice(0, 10);
  for (const [id, row] of previous) {
    if (!id.startsWith("sime:") || records.has(id)) continue;
    const m = officialMetadata(row), raw = readMetadata(row.metadata).simeVacancy as SimeVacancy | undefined;
    const board = juntas.find(([, label]) => label === m?.junta);
    if (!raw || !board || !m?.facts.designation || m.facts.designation.value.slice(0, 10) < today) continue;
    records.set(id, { vacancy: raw, junta: board[1], juntaId: board[0] });
    const item = normalizeSimeVacancy(raw, board[1], board[0], row.metadata, now);
    const normalized = officialMetadata(item)!;
    normalized.issues.push("No visible en listado vigente; el Acto se verifica por el detalle público.");
    item.metadata = withOfficial(item.metadata, normalized);
    items.push(item);
  }
  const warnings: string[] = [];
  for (const item of selectSimeDetails(items)) {
    try {
      const response = await fetchSourceJson<{ vacante: SimeDetail }>(`https://sime.educaciontuc.gov.ar/Vacantes/ObtenerVacante/${item.externalId}?origen=&postulante=`, {
        source: "SIME", signal: AbortSignal.timeout(15_000), headers: { Accept: "application/json" }, fetcher,
      });
      if (!validSimeDetail(response)) throw new SourceSyncError("SCHEMA_ERROR", "SIME detail shape changed");
      applySimeDetail(item, response.vacante, now.toISOString());
    } catch (error) {
      applySimeDetail(item, null, now.toISOString());
      warnings.push(`${item.id}: ${sourceErrorCode(error)}`);
    }
    const record = records.get(item.id)!;
    const refreshed = normalizeSimeVacancy(record.vacancy, record.junta, record.juntaId, item.metadata, now);
    items[items.findIndex((row) => row.id === item.id)] = refreshed;
  }
  return { items, complete: warnings.length === 0, warnings: warnings.length ? { SIME: `Detalles parciales: ${warnings.join("; ")}` } : {} };
}
