import { env } from "cloudflare:workers";
import { getD1 } from "@/db";
import { authError, currentUser } from "@/lib/current-user";
import { matchesProfile, profileMatch } from "@/lib/matching";
import { driveEntryUrl, htmlToText, parsePublicDriveFolder } from "@/lib/public-documents";
import { mergeTrainingData, parseTrainingMetadata } from "@/lib/training";
import { parseCenetTrainings, parseInfdCatalog, parseInfdTrainings, type PublicTraining } from "@/lib/external-trainings";
import { usefulInformation } from "@/lib/useful-information";
import { registrationState } from "@/lib/home-dashboard";
import { diffByHash } from "@/lib/sync-diff";

export const dynamic = "force-dynamic";

type Publication = {
  id: string; source: string; externalId: string; kind: string; category: string; title: string; summary: string;
  level: string; area: string; junta: string; location: string; shift: string; character: string;
  startsAt: string | null; endsAt: string | null; status: string; officialUrl: string; metadata?: string; contentHash: string; sourceUpdatedAt: string | null;
};

const juntas = [
  [1, "Inicial y Primaria"], [2, "Secundaria"], [3, "Técnica, Agrotécnica y No Formal"], [4, "Superior, Especial y Artística"],
] as const;

type DocumentSource = readonly [externalId: string, title: string, category: string, junta: string, officialUrl: string];
const documents: readonly DocumentSource[] = [
  ["com-primaria", "Comunicados de Educación Inicial y Primaria", "Comunicados", "Inicial y Primaria", "https://docs.google.com/document/d/1Oo-LmX9DyPBfhZNHPRYYiRf6MJiN837VoSXK2F-LIZE/edit?usp=sharing"],
  ["com-secundaria", "Comunicados de Educación Secundaria", "Comunicados", "Secundaria", "https://docs.google.com/document/d/1PTKViYaH7i8CHcng99I51lKbZIkjwLnc3ctrJC5898g/edit?usp=sharing"],
  ["com-tecnica", "Comunicados de Educación Técnica, Agrotécnica y No Formal", "Comunicados", "Técnica, Agrotécnica y No Formal", "https://docs.google.com/document/d/1k0dIv5PJ-CuWabcKhL6mEf-lqfZbGps6V7VdS-ao1F8/edit?usp=sharing"],
  ["com-superior", "Comunicados de Nivel Superior, Especial y Artística", "Comunicados", "Superior, Especial y Artística", "https://docs.google.com/document/d/1SVQr81QbdgRdfqUAPdBhXBlYxpQwKIdDbqxK35tDoOI/edit?usp=sharing"],
  ["pad-primaria", "Padrones de Educación Inicial y Primaria", "Padrones", "Inicial y Primaria", "https://drive.google.com/drive/folders/0B9nsld8DcxkyZ04zbmxOTFNBNkE?resourcekey=0-N_tuv1wH33HaPvQKhxquww"],
  ["pad-secundaria", "Padrones de Educación Secundaria", "Padrones", "Secundaria", "https://drive.google.com/drive/folders/0B9nsld8DcxkydjZkRTBGV1JzSVE?resourcekey=0-71bD600USZEczBSRONjj-w"],
  ["pad-tecnica", "Padrones de Educación Técnica, Agrotécnica y No Formal", "Padrones", "Técnica, Agrotécnica y No Formal", "https://drive.google.com/drive/folders/0B9nsld8DcxkySC1NUWdSMkdlY2s?resourcekey=0-yI1BMkZQzYW4hFwVMbdvHA"],
  ["pad-superior", "Padrones de Educación Superior, Especial y Artística", "Padrones", "Superior, Especial y Artística", "https://drive.google.com/drive/folders/0B9nsld8DcxkyNzloZnlCbHZhUVE?resourcekey=0-QSoeQ-4hqb9joCnl8FgDrg"],
  ["abiertos-primaria", "Llamados abiertos de Inicial y Primaria", "Llamados abiertos", "Inicial y Primaria", "https://drive.google.com/drive/folders/1z9S807nunn8JiDl7C8VtBwPlrqb_OESq"],
  ["abiertos-superior", "Padrones de llamados abiertos", "Llamados abiertos", "Superior, Especial y Artística", "https://drive.google.com/drive/folders/1Cm6ICwm8v2wrmLcjq-yd-U2Bb2MEO6Fx"],
  ["res-ascenso", "Decreto 2926/5 — Ascenso de Jerarquía", "Resoluciones", "Todas", "https://padrones.educaciontuc.gov.ar/2020/ascenso.pdf"],
  ["res-valoracion", "Decreto 292/5 — Valoración de títulos y antecedentes", "Resoluciones", "Todas", "https://padrones.educaciontuc.gov.ar/2020/DECRETO_292.pdf"],
] as const;

const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
const simeDate = (value?: string) => {
  if (!value) return null;
  const match = value.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  return match ? `${match[3]}-${match[2]}-${match[1]}T${match[4]}:${match[5]}:00-03:00` : null;
};
const isOpen = (endsAt: string | null) => !endsAt || new Date(endsAt).getTime() >= Date.now();

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "DocenteTuc/1.0 (+agregador de fuentes publicas)" } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json() as Promise<T>;
}

async function getHtml(url: string) {
  const response = await fetch(url, { headers: { Accept: "text/html", "User-Agent": "DocenteTuc/1.0 (+agregador de fuentes publicas)" } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

const publicTrainingPublications = (items: PublicTraining[], source: string) => Promise.all(items.map(async (item): Promise<Publication> => ({
  id: item.id, source, externalId: item.externalId, kind: "capacitacion", category: source,
  title: item.title, summary: item.summary, level: item.level, area: item.area, junta: "", location: "Online", shift: "", character: item.modality,
  startsAt: item.startsAt, endsAt: item.endsAt, status: item.status, officialUrl: item.officialUrl, metadata: JSON.stringify(item.metadata),
  contentHash: await hash(item.raw), sourceUpdatedAt: null,
})));

async function simePublications() {
  const items: Publication[] = [];
  for (const [juntaId, junta] of juntas) {
    const periodData = await getJson<{ periodos: { text: string }[] }>(`https://sime.educaciontuc.gov.ar/Vacantes/ObtenerPeriodos/${juntaId}?caracter=-1&tab=1`);
    const [month = "", year = ""] = (periodData.periodos[0]?.text || "").split("/");
    const data = await getJson<{ vacantes: { id: number; codigo: string; caracter: string; fechaPublicacionInicio: string; fechaPublicacionFin: string; cargos: string; abierto: boolean }[] }>(`https://sime.educaciontuc.gov.ar/Vacantes/ObtenerVacantes/${juntaId}?caracter=-1&tab=1&mesBuscar=${month}&anioBuscar=${year}`);
    for (const vacancy of data.vacantes || []) {
      const startsAt = simeDate(vacancy.fechaPublicacionInicio), endsAt = simeDate(vacancy.fechaPublicacionFin);
      const first = vacancy.cargos.split(", ")[0].replace(/^\[[^\]]+\]\s*/, "");
      const title = first.split(/\s+\[[^\]]*(?:TURNO|#)/i)[0].slice(0, 220);
      const shift = vacancy.cargos.match(/TURNO\s+([^\]]+)/i)?.[1]?.trim() || "";
      items.push({ id: `sime:${vacancy.id}`, source: "SIME", externalId: String(vacancy.id), kind: "vacante", category: vacancy.abierto ? "Llamado abierto" : "Vacante", title, summary: vacancy.cargos, level: junta, area: title, junta, location: "", shift, character: vacancy.caracter, startsAt, endsAt, status: isOpen(endsAt) ? "vigente" : "cerrada", officialUrl: `https://sime.educaciontuc.gov.ar/Vacantes/Detalle/${vacancy.id}?seleccionado=${juntaId - 1}&tab=1&accion=-1`, contentHash: await hash(JSON.stringify(vacancy)), sourceUpdatedAt: startsAt });
    }
  }
  return items;
}

async function trainingPublications() {
  const base = "https://apicapacitaciones.educaciontuc.edu.ar/api";
  const [courses, active] = await Promise.all([
    getJson<Record<string, unknown>[]>(`${base}/gestionCapas/getRestoCapas`),
    getJson<Record<string, unknown>[]>(`${base}/gestionCapas/getCapaActivas`),
  ]);
  return Promise.all(mergeTrainingData(courses, active).map(async (item): Promise<Publication> => ({
    id: item.id, source: "Capacitación Docente", externalId: item.externalId, kind: "capacitacion", category: item.metadata.entity === "commission" ? `Comisión #${item.metadata.commissionId}` : "Capacitación",
    title: item.title, summary: item.summary, level: item.level, area: item.area, junta: "", location: item.location, shift: "", character: item.modality,
    startsAt: item.startsAt, endsAt: item.endsAt, status: item.status, officialUrl: item.officialUrl, metadata: JSON.stringify(item.metadata),
    contentHash: await hash(JSON.stringify(item.raw)), sourceUpdatedAt: item.sourceUpdatedAt,
  })));
}

async function cenetPublications() {
  const url = "https://cenet.inet.edu.ar/mod/page/view.php?id=30493";
  return publicTrainingPublications(parseCenetTrainings(await getHtml(url)), "CeNET / INET");
}

async function infdPublications() {
  const catalogUrl = "https://red.infd.edu.ar/cursos-nacionales-2/", catalogHtml = await getHtml(catalogUrl), catalog = parseInfdCatalog(catalogHtml);
  const pages = await Promise.allSettled(catalog.pages.map(async (url) => parseInfdTrainings(await getHtml(url), url, catalog)));
  return publicTrainingPublications(pages.flatMap((result) => result.status === "fulfilled" ? result.value : []), "INFoD / AulaS-TIC");
}

async function boardPublications() {
  const publications: Publication[] = [];
  let exportedDriveDocs = 0;
  for (const [externalId, title, category, junta, officialUrl] of documents) {
    let fingerprint = officialUrl, summary = `Documento público oficial de la Junta ${junta}.`, metadata = "{}";
    if (officialUrl.includes("docs.google.com/document/")) {
      const docId = officialUrl.split("/d/")[1].split("/")[0];
      const response = await fetch(`https://docs.google.com/document/d/${docId}/export?format=html`);
      if (response.ok) { fingerprint = await response.text(); summary = htmlToText(fingerprint) || summary; metadata = JSON.stringify({ contentAvailable: true, format: "google-doc" }); }
    } else if (officialUrl.includes("drive.google.com/drive/folders/")) {
      const folderId = officialUrl.split("/folders/")[1].split(/[?/#]/)[0], queue = [folderId], visited = new Set<string>(), indexed = new Map<string, ReturnType<typeof parsePublicDriveFolder>[number]>();
      // ponytail: cuatro páginas públicas por fuente; usar Drive API oficial si hace falta recorrer árboles más profundos.
      while (queue.length && visited.size < 4) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);
        const response = await fetch(current === folderId ? officialUrl : `https://drive.google.com/drive/folders/${current}`);
        if (!response.ok) continue;
        for (const entry of parsePublicDriveFolder(await response.text(), current)) {
          indexed.set(entry.id, entry);
          if (entry.mimeType === "application/vnd.google-apps.folder" && !visited.has(entry.id)) queue.push(entry.id);
        }
      }
      const entries = [...indexed.values()];
      if (visited.size) {
        fingerprint = JSON.stringify(entries);
        summary = `Carpeta pública oficial con ${entries.length} elementos indexados. Abrí cada resultado para consultar su nombre y fuente.`;
        metadata = JSON.stringify({ contentAvailable: true, format: "drive-folder", itemCount: entries.length });
        for (const entry of entries) {
          const entryUrl = driveEntryUrl(entry), isGoogleDoc = entry.mimeType === "application/vnd.google-apps.document";
          let entrySummary = `${entry.name}. Archivo público oficial disponible en Google Drive.`, contentAvailable = false;
          // ponytail: límite de subconsultas; usar Drive API oficial si el Ministerio publica un feed estable.
          if (isGoogleDoc && exportedDriveDocs < 4) {
            const documentResponse = await fetch(`https://docs.google.com/document/d/${entry.id}/export?format=html`);
            exportedDriveDocs++;
            if (documentResponse.ok) { entrySummary = htmlToText(await documentResponse.text()) || entrySummary; contentAvailable = true; }
          }
          publications.push({ id: `drive:${externalId}:${entry.id}`, source: "Padrones y Comunicados", externalId: entry.id, kind: "junta", category, title: entry.name, summary: entrySummary, level: "", area: "", junta, location: "", shift: "", character: "", startsAt: null, endsAt: null, status: "vigente", officialUrl: entryUrl, metadata: JSON.stringify({ contentAvailable, format: entry.mimeType, parent: externalId }), contentHash: await hash([entry.name, entry.mimeType, entry.updatedAt, entrySummary].join("|")), sourceUpdatedAt: entry.updatedAt });
        }
      }
    }
    publications.push({ id: `padrones:${externalId}`, source: "Padrones y Comunicados", externalId, kind: "junta", category, title, summary, level: "", area: "", junta, location: "", shift: "", character: "", startsAt: null, endsAt: null, status: "vigente", officialUrl, metadata, contentHash: await hash(fingerprint), sourceUpdatedAt: null });
  }
  return publications;
}

async function usefulPublications(): Promise<Publication[]> {
  return Promise.all(usefulInformation.map(async (item) => ({
    id: `info:${item.id}`, source: "Información oficial Tucumán", externalId: item.id, kind: "informacion", category: item.category,
    title: item.title, summary: item.summary, level: "", area: item.metadata.aliases?.join(", ") || "", junta: "", location: item.metadata.address || "", shift: "", character: item.metadata.recordType,
    startsAt: null, endsAt: null, status: item.metadata.sourceStatus === "partial" ? "verificación parcial" : "verificado", officialUrl: item.officialUrl,
    metadata: JSON.stringify(item.metadata), contentHash: await hash(JSON.stringify(item)), sourceUpdatedAt: item.metadata.lastVerified,
  })));
}

async function runSync() {
  const db = getD1();
  const previous = await db.prepare("SELECT id, content_hash, starts_at, ends_at, metadata FROM publications").all<{ id: string; content_hash: string; starts_at: string | null; ends_at: string | null; metadata: string }>();
  const old = new Map(previous.results.map((row) => [row.id, row]));
  const results = await Promise.allSettled([simePublications(), trainingPublications(), boardPublications(), usefulPublications(), cenetPublications(), infdPublications()]);
  const publications = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (!publications.length) throw new Error("Las fuentes no respondieron.");
  const { fresh, changed, unchanged, writes } = diffByHash(old, publications);
  let rowsWritten = 0;
  const countWrites = (results: unknown) => { for (const result of Array.isArray(results) ? results : [results]) rowsWritten += Number((result as { meta?: { rows_written?: number } })?.meta?.rows_written || 0); };
  for (let offset = 0; offset < writes.length; offset += 40) {
    countWrites(await db.batch(writes.slice(offset, offset + 40).map((item) => db.prepare(`INSERT INTO publications (id, source, external_id, kind, category, title, summary, level, area, junta, location, shift, character, starts_at, ends_at, status, official_url, metadata, content_hash, source_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET source=excluded.source, category=excluded.category, title=excluded.title, summary=excluded.summary, level=excluded.level, area=excluded.area, junta=excluded.junta, location=excluded.location, shift=excluded.shift, character=excluded.character, starts_at=excluded.starts_at, ends_at=excluded.ends_at, status=excluded.status, official_url=excluded.official_url, metadata=excluded.metadata, content_hash=excluded.content_hash, source_updated_at=excluded.source_updated_at, updated_at=CURRENT_TIMESTAMP`).bind(item.id, item.source, item.externalId, item.kind, item.category, item.title, item.summary, item.level, item.area, item.junta, item.location, item.shift, item.character, item.startsAt, item.endsAt, item.status, item.officialUrl, item.metadata || "{}", item.contentHash, item.sourceUpdatedAt))));
  }
  if (results[1].status === "fulfilled") {
    countWrites(await db.prepare("INSERT OR IGNORE INTO saved_publications (user_id, publication_id, in_agenda, followed, saved_at) SELECT s.user_id, 'fdci:course:' || p.external_id, s.in_agenda, s.followed, s.saved_at FROM saved_publications s JOIN publications p ON p.id=s.publication_id JOIN publications replacement ON replacement.id='fdci:course:' || p.external_id WHERE p.id LIKE 'fdci:%' AND p.id NOT LIKE 'fdci:course:%' AND p.id NOT LIKE 'fdci:commission:%'").run());
    countWrites(await db.prepare("DELETE FROM publications WHERE id LIKE 'fdci:%' AND id NOT LIKE 'fdci:course:%' AND id NOT LIKE 'fdci:commission:%'").run());
  }
  const sourceCounts = new Map<string, number>();
  publications.forEach((item) => sourceCounts.set(item.source, (sourceCounts.get(item.source) || 0) + 1));
  countWrites(await db.batch([...sourceCounts].map(([source, count]) => db.prepare("INSERT INTO sync_state (source, synced_at, item_count, error) VALUES (?, CURRENT_TIMESTAMP, ?, NULL) ON CONFLICT(source) DO UPDATE SET synced_at=CURRENT_TIMESTAMP, item_count=excluded.item_count, error=NULL").bind(source, count))));

  const profiles = await db.prepare("SELECT * FROM profiles").all<Record<string, unknown>>();
  const interesting = [...fresh.filter((item) => !item.id.startsWith("drive:") && item.kind !== "informacion").slice(0, 60), ...changed.filter((item) => !item.id.startsWith("drive:") && item.kind !== "informacion")];
  for (const profile of profiles.results) {
    const match = (item: Publication) => {
      const fullProfile = { level: String(profile.level || ""), area: String(profile.area || ""), subjects: String(profile.subjects || ""), junta: String(profile.junta || ""), roles: String(profile.roles || ""), department: String(profile.department || ""), locality: String(profile.locality || ""), shifts: String(profile.shifts || ""), wantsInterim: Boolean(profile.wants_interim), wantsSubstitute: Boolean(profile.wants_substitute), trainingInterests: String(profile.training_interests || "") };
      if (item.kind !== "capacitacion") return matchesProfile(item, fullProfile);
      if (!Boolean(profile.notify_new_trainings)) return false;
      const scope = String(profile.training_notify_scope || "relevant");
      if (scope === "all") return true;
      if (scope === "level") return matchesProfile(item, { level: fullProfile.level });
      if (scope === "area") return matchesProfile(item, { area: fullProfile.area, subjects: fullProfile.subjects });
      if (scope === "interests") return matchesProfile(item, { trainingInterests: fullProfile.trainingInterests });
      const metadata = parseTrainingMetadata(item.metadata), state = registrationState(metadata?.registrationOpensAt, metadata?.registrationClosesAt, new Date());
      return ["today", "tomorrow", "two-three", "four-seven", "eight-fourteen"].includes(state) && profileMatch(item, fullProfile).score >= Math.min(100, Math.max(0, Number(profile.training_match_threshold) || 80));
    };
    const statements = interesting.filter(match).map((item) => {
      const metadata = item.kind === "capacitacion" ? parseTrainingMetadata(item.metadata) : null, previous = old.get(item.id), previousMetadata = item.kind === "capacitacion" ? parseTrainingMetadata(previous?.metadata) : null;
      const dateChanged = Boolean(previous && [previous.starts_at, previous.ends_at, previousMetadata?.registrationOpensAt, previousMetadata?.registrationClosesAt].join("|") !== [item.startsAt, item.endsAt, metadata?.registrationOpensAt, metadata?.registrationClosesAt].join("|"));
      const designationMatch = item.kind === "vacante" ? profileMatch(item, { level: String(profile.level || ""), area: String(profile.area || ""), subjects: String(profile.subjects || ""), junta: String(profile.junta || ""), roles: String(profile.roles || ""), department: String(profile.department || ""), locality: String(profile.locality || ""), shifts: String(profile.shifts || ""), wantsInterim: Boolean(profile.wants_interim), wantsSubstitute: Boolean(profile.wants_substitute) }) : null;
      const designationType = designationMatch ? `DESIGNACION_${designationMatch.status === "exact" ? "EXACTA" : "PARCIAL"}_${designationMatch.criteria.some((criterion) => criterion.key === "role" && criterion.matched) ? "CARGO" : "GENERAL"}` : "DESIGNACION_NUEVA";
      const type = old.has(item.id) ? (item.kind === "junta" ? "PADRON_ACTUALIZADO" : item.kind === "vacante" ? "DESIGNACION_CAMBIO" : dateChanged ? "FECHA_CAMBIADA" : "FECHA_IMPORTANTE") : item.kind === "vacante" ? designationType : metadata?.entity === "commission" ? "COMISION_NUEVA" : item.kind === "capacitacion" ? "CAPACITACION_NUEVA" : item.category === "Comunicados" ? "COMUNICADO_NUEVO" : "PADRON_NUEVO";
      return db.prepare("INSERT OR IGNORE INTO notifications (user_id, publication_id, type) VALUES (?, ?, ?)").bind(String(profile.user_id), item.id, type);
    });
    for (let offset = 0; offset < statements.length; offset += 40) countWrites(await db.batch(statements.slice(offset, offset + 40)));
  }
  const sourceMetrics = [...sourceCounts].map(([source, recovered]) => ({ source, recovered, fresh: fresh.filter((item) => item.source === source).length, changed: changed.filter((item) => item.source === source).length, unchanged: unchanged.filter((item) => item.source === source).length }));
  const metrics = { count: publications.length, fresh: fresh.length, changed: changed.length, unchanged: unchanged.length, failures: results.filter((result) => result.status === "rejected").length, rowsWritten, sources: sourceMetrics };
  console.log("sync_completed", metrics);
  return metrics;
}

export async function POST(request: Request) {
  try {
    const scheduled = Boolean(env.CRON_SECRET) && request.headers.get("x-docentetuc-cron") === env.CRON_SECRET;
    if (!scheduled) await currentUser(request);
    const db = getD1();
    const latest = await db.prepare("SELECT MAX(synced_at) AS synced_at FROM sync_state").first<{ synced_at: string | null }>();
    if (!scheduled && latest?.synced_at && Date.now() - new Date(`${latest.synced_at}Z`).getTime() < 60 * 60_000) return Response.json({ ok: true, skipped: true, reason: "central_sync_recent" });
    return Response.json({ ok: true, ...(await runSync()) });
  } catch (error) {
    console.error("sync_failed", error);
    return Response.json({ error: authError(error) ? "Iniciá sesión para actualizar." : "No se pudieron actualizar las fuentes. Probá nuevamente en unos minutos." }, { status: authError(error) ? 401 : 502 });
  }
}
