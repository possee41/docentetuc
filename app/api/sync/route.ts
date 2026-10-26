import { env } from "cloudflare:workers";
import { getD1 } from "@/db";
import { authError, currentUser } from "@/lib/current-user";
import { designationRoleFromTitle, isEligibleForPersonalizedHome, matchesProfile, profileMatch } from "@/lib/matching";
import { driveEntryUrl, fetchPublicDrivePage, plainDocumentText } from "@/lib/public-documents";
import { advanceBoardCrawl, boardCrawlReadyForNextCycle, boardQueueJson, initialBoardCrawl, restoreBoardCrawl } from "@/lib/board-crawl";
import { mergeTrainingData, parseTrainingMetadata, trainingReminderKey } from "@/lib/training";
import { isCenetMarkupRecognized, isHistoricalCenetOffer, parseCenetTrainings, parseInfdCatalog, parseInfdTrainings, parseInfdWebinars, type PublicTraining } from "@/lib/external-trainings";
import { usefulInformation } from "@/lib/useful-information";
import { registrationState } from "@/lib/home-dashboard";
import { diffByHash, hashSourceSnapshot, hasMeaningfulPublicationChange, isDocumentTextExportMigration } from "@/lib/sync-diff";
import { notificationDedupeKey } from "@/lib/notification-events";
import { circuitMatches, inferCircuit } from "@/lib/circuits";
import { assessSourceSync, missingAfterValidatedSync, publicationLifecycle, SourceSyncError, sourceErrorCode, type SourceSyncStatus } from "@/lib/publication-lifecycle";
import { collectSourcePages } from "@/lib/source-fetch";
import { fromStoredPublication, officialMetadata, officialLifecycle, readMetadata } from "@/lib/official-publication";
import { collectSimePublications } from "@/lib/sime-collector";
import { classifyDriveReference, documentReference, extractJuntaNotices } from "@/lib/junta-notices";
import { BOARD_PORTAL, parseBoardPlacements } from "@/lib/board-sources";
import { officialChange, reconcileOfficialPublications } from "@/lib/official-reconciliation";
import { fdciLegacyEnabled } from "@/lib/fdci-sync-mode";
import { externalSyncSources, legacySyncPaused } from "@/lib/external-sync-sources";

export const dynamic = "force-dynamic";

type Publication = {
  id: string; source: string; externalId: string; kind: string; category: string; title: string; summary: string;
  level: string; area: string; junta: string; location: string; shift: string; character: string;
  circuit?: string; sourceCircuitRaw?: string; circuitInferenceSource?: string; circuitConfidence?: number;
  startsAt: string | null; endsAt: string | null; status: string; officialUrl: string; metadata?: string; contentHash: string; sourceUpdatedAt: string | null;
  sourcePublishedAt?: string | null;
};

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
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { Accept: "application/json", "User-Agent": "DocenteTuc/1.0 (+agregador de fuentes publicas)" } });
  if (!response.ok) throw new Error(`HTTP_${response.status} ${url}`);
  return response.json() as Promise<T>;
}

async function getHtml(url: string, traceSource?: string) {
  const started = Date.now();
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { Accept: "text/html", "User-Agent": "DocenteTuc/1.0 (+agregador de fuentes publicas)" } });
  if (traceSource) console.log("source_page_http", { source: traceSource, page: new URL(url).pathname, status: response.status, contentType: response.headers.get("content-type"), redirected: response.redirected, elapsedMs: Date.now() - started });
  if (!response.ok) throw new SourceSyncError("HTTP_ERROR", `HTTP_${response.status} ${url}`, `HTTP_${response.status}`);
  return response.text();
}

const publicTrainingPublications = (items: PublicTraining[], source: string) => Promise.all(items.map(async (item): Promise<Publication> => ({
  id: item.id, source, externalId: item.externalId, kind: "capacitacion", category: item.metadata.category || source,
  title: item.title, summary: item.summary, level: item.level, area: item.area, junta: "", location: "Online", shift: "", character: item.modality,
  startsAt: item.startsAt, endsAt: item.endsAt, status: item.status, officialUrl: item.officialUrl, metadata: JSON.stringify(item.metadata),
  contentHash: await hash(JSON.stringify({ raw: item.raw, metadata: item.metadata, title: item.title, summary: item.summary, startsAt: item.startsAt, endsAt: item.endsAt, status: item.status })), sourceUpdatedAt: null,
})));

async function trainingPublications() {
  const base = "https://apicapacitaciones.educaciontuc.edu.ar/api";
  const [courses, active] = await Promise.all([
    getJson<Record<string, unknown>[]>(`${base}/gestionCapas/getRestoCapas`),
    getJson<Record<string, unknown>[]>(`${base}/gestionCapas/getCapaActivas`),
  ]);
  if (!Array.isArray(courses) || !Array.isArray(active)) throw new Error("PARSE_ERROR FDCI response shape changed");
  const activeIds = new Set(active.map((item) => String(item.capacitacion_id)));
  const detailCandidates = courses.filter((item) => item.proxima_fecha_preinscripcion || activeIds.has(String(item.capacitacion_id)));
  const details = await Promise.allSettled(detailCandidates.map(async (course) => {
    const response = await fetch(`${base}/capa/getCupo`, { method: "POST", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ token: course.token, slug: course.slug }) });
    if (!response.ok) throw new Error(`HTTP_${response.status} FDCI commission detail`);
    const detail = await response.json() as { comisiones?: Record<string, unknown>[] };
    if (!Array.isArray(detail.comisiones)) throw new Error("PARSE_ERROR FDCI commission detail changed");
    return detail.comisiones.filter((commission) => String(commission.capacitacion_id) === String(course.capacitacion_id));
  }));
  const commissions = [...active, ...details.flatMap((result) => result.status === "fulfilled" ? result.value : [])];
  const items = await Promise.all(mergeTrainingData(courses, commissions).map(async (item): Promise<Publication> => ({
    id: item.id, source: "Capacitación Docente", externalId: item.externalId, kind: "capacitacion", category: item.metadata.entity === "commission" ? `Comisión #${item.metadata.commissionId}` : "Capacitación",
    title: item.title, summary: item.summary, level: item.level, area: item.area, junta: "", location: item.location, shift: "", character: item.modality,
    startsAt: item.startsAt, endsAt: item.endsAt, status: item.status, officialUrl: item.officialUrl, metadata: JSON.stringify(item.metadata),
    contentHash: await hashSourceSnapshot(item.raw, { metadata: item.metadata, status: item.status, startsAt: item.startsAt, endsAt: item.endsAt }), sourceUpdatedAt: item.sourceUpdatedAt,
  })));
  return { items, complete: details.every((result) => result.status === "fulfilled") };
}

async function cenetPublications() {
  const url = "https://cenet.inet.edu.ar/mod/page/view.php?id=30493";
  const html = await getHtml(url);
  if (!isCenetMarkupRecognized(html)) throw new Error("FORMAT_CHANGED CeNET parser markers not found");
  return publicTrainingPublications(parseCenetTrainings(html), "CeNET / INET");
}

async function infdPublications() {
  const catalogUrl = "https://red.infd.edu.ar/cursos-nacionales-2/", catalogHtml = await getHtml(catalogUrl, "INFoD"), catalog = parseInfdCatalog(catalogHtml);
  if (!catalog.pages.length) throw new Error("FORMAT_CHANGED INFoD course links not found");
  const pages = await collectSourcePages(catalog.pages, async (url) => {
    const html = await getHtml(url, "INFoD");
    return url.includes("/webinarios/") ? parseInfdWebinars(html, url) : parseInfdTrainings(html, url, catalog);
  });
  const diagnostics = pages.diagnostics;
  console.log("infd_pages_sync", diagnostics);
  const failures = diagnostics.filter((page) => page.errorCode).map((page) => `${page.page}: ${page.errorCode}`);
  if (!pages.items.length) throw new Error(pages.allFailed ? "HTTP_ERROR INFoD pages unavailable" : "FORMAT_CHANGED INFoD course structure not found");
  return { items: await publicTrainingPublications(pages.items, "INFoD / AulaS-TIC"), complete: pages.complete, warnings: failures.length ? { "INFoD / AulaS-TIC": failures.join("; ") } : {} };
}

async function boardPublications() {
  let portalPlacements: ReturnType<typeof parseBoardPlacements> = [];
  let portalWarning = "";
  try { portalPlacements = parseBoardPlacements(await getHtml(BOARD_PORTAL)); }
  catch { portalWarning = "Índice oficial no verificable en este intento; se conservaron las URLs registradas."; }
  const db = getD1();
  const storedCrawls = await db.prepare("SELECT root_id, queue_json, visited_json, working_json, snapshot_json, completed_at FROM board_crawl_state").all<{ root_id: string; queue_json: string; visited_json: string; working_json: string; snapshot_json: string; completed_at: string | null }>();
  const states = new Map(documents.filter(([, , , , url]) => url.includes("/drive/folders/")).map(([root, , , , url]) => {
    const id = url.split("/folders/")[1].split(/[?/#]/)[0], stored = storedCrawls.results.find(row => row.root_id === root);
    return [root, stored ? restoreBoardCrawl(id, stored) : initialBoardCrawl(id)] as const;
  }));
  const previousScan = await db.prepare("SELECT CASE WHEN COUNT(*)=2 AND COUNT(last_successful_sync_at)=2 THEN MIN(last_successful_sync_at) ELSE NULL END AS completed_at FROM sync_state WHERE source IN ('Padrones','Llamados abiertos')").first<{ completed_at: string | null }>();
  const restart = boardCrawlReadyForNextCycle([...states.values()], previousScan?.completed_at || null);
  const publications: Publication[] = [];
  let exportedDriveDocs = 0;
  const incompleteCategories = new Set<string>();
  const categoryErrors: Record<string, unknown> = {};
  const warnings: Record<string, string> = {};
  let firstError: unknown = null;
  const previousDrive = await db.prepare("SELECT * FROM publications WHERE source='Padrones y Comunicados'").all<Record<string, unknown>>();
  const previousNotices = previousDrive.results.map(fromStoredPublication);
  const previousDriveById = new Map(previousNotices.map((row) => [row.id, row]));
  for (let offset = 0; offset < documents.length; offset += 4) {
    await Promise.all(documents.slice(offset, offset + 4).map(async ([externalId, title, category, junta, officialUrl]) => {
    try {
    const documentStatus = "Documento público · vigencia no informada";
    let fingerprint = officialUrl, summary = `Documento público oficial de la Junta ${junta}.`, metadata = "{}", rawNoticeText: string | undefined;
    if (officialUrl.includes("docs.google.com/document/")) {
      const docId = officialUrl.split("/d/")[1].split("/")[0];
      const response = await fetch(`https://docs.google.com/document/d/${docId}/export?format=txt`, { signal: AbortSignal.timeout(40_000) });
      if (!response.ok) throw new Error(`HTTP_${response.status} ${officialUrl}`);
      fingerprint = await response.text(); rawNoticeText = fingerprint; summary = plainDocumentText(fingerprint) || summary; metadata = JSON.stringify({ contentAvailable: true, format: "google-doc", textFormat: "txt" });
    } else if (officialUrl.includes("drive.google.com/drive/folders/")) {
      const folderId = officialUrl.split("/folders/")[1].split(/[?/#]/)[0];
      const previousState = states.get(externalId)!;
      const state = restart ? { ...initialBoardCrawl(folderId), snapshot: previousState.snapshot, completedAt: previousState.completedAt } : previousState;
      const result = await advanceBoardCrawl(folderId, state, (id, cursor) => fetchPublicDrivePage(id, cursor, id === folderId ? officialUrl : undefined), 2, new Date().toISOString());
      await db.prepare(`INSERT INTO board_crawl_state (root_id, queue_json, visited_json, working_json, snapshot_json, completed_at, last_attempt_at, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(root_id) DO UPDATE SET queue_json=excluded.queue_json, visited_json=excluded.visited_json, working_json=excluded.working_json, snapshot_json=excluded.snapshot_json, completed_at=excluded.completed_at, last_attempt_at=excluded.last_attempt_at, error=excluded.error`)
        .bind(externalId, boardQueueJson(result.state), JSON.stringify(result.state.visited), JSON.stringify(result.state.working), JSON.stringify(result.state.snapshot), result.state.completedAt, new Date().toISOString(), result.error).run();
      console.log("board_crawl_progress", { root: externalId, pagesProcessed: result.pagesProcessed, pagesExpectedAtLeast: result.pagesExpectedAtLeast, foldersCompleted: result.state.visited.length, pending: result.state.queue.length, complete: result.cycleCompleted, error: result.error });
      if (!result.cycleCompleted) {
        incompleteCategories.add(category);
        warnings[category] = result.error ? `${externalId}: ${result.error}` : `${externalId}: barrido en curso (${result.pagesProcessed} páginas; al menos ${result.pagesExpectedAtLeast} detectadas).`;
      }
      const entries = result.entries;
      if (result.error && !entries.length && !result.state.visited.length) throw new Error(result.error);
      if (entries.length || result.cycleCompleted) {
        fingerprint = JSON.stringify(entries);
        summary = `Carpeta pública oficial con ${entries.length} elementos indexados${result.cycleCompleted ? "" : " hasta ahora"}. Abrí cada resultado para consultar su nombre y fuente.`;
        metadata = JSON.stringify({ contentAvailable: true, format: "drive-folder", itemCount: entries.length, fullScanAt: result.state.completedAt });
        for (const entry of entries) {
          const entryUrl = driveEntryUrl(entry), isGoogleDoc = entry.mimeType === "application/vnd.google-apps.document";
          let entrySummary = `${entry.name}. Archivo público oficial disponible en Google Drive.`, contentAvailable = false, textFormat: string | undefined, entryNoticeText: string | undefined;
          const previous = previousDriveById.get(`drive:${externalId}:${entry.id}`);
          let previousMetadata: { contentAvailable?: boolean; textFormat?: string } = {};
          try { previousMetadata = JSON.parse(previous?.metadata || "{}"); } catch {}
          const cachedNotices = previousNotices.filter(x => officialMetadata(x)?.sourceRootId === `drive:${externalId}:${entry.id}`);
          if (isGoogleDoc && previousMetadata.contentAvailable && previous?.sourceUpdatedAt === entry.updatedAt && cachedNotices.length) {
            entrySummary = previous.summary; contentAvailable = true; textFormat = previousMetadata.textFormat || "html";
            publications.push(...cachedNotices);
          } else if (isGoogleDoc && exportedDriveDocs < 4) {
            exportedDriveDocs++;
            try {
              const documentResponse = await fetch(`https://docs.google.com/document/d/${entry.id}/export?format=txt`, { signal: AbortSignal.timeout(40_000) });
              if (documentResponse.ok) { entryNoticeText = await documentResponse.text(); entrySummary = plainDocumentText(entryNoticeText) || entrySummary; contentAvailable = true; textFormat = "txt"; }
            } catch (error) { console.warn("drive_document_text_unavailable", entry.id, error); }
          }
          const entryPublication: Publication = { id: `drive:${externalId}:${entry.id}`, source: "Padrones y Comunicados", externalId: entry.id, kind: "junta", category, title: entry.name, summary: entrySummary, level: "", area: "", junta, location: "", shift: "", character: "", startsAt: null, endsAt: null, status: documentStatus, officialUrl: entryUrl, metadata: JSON.stringify({ contentAvailable, format: entry.mimeType, parent: externalId, textFormat }), contentHash: "", sourceUpdatedAt: entry.updatedAt };
          publications.push(classifyDriveReference(entryPublication, entry.mimeType));
          if (entryNoticeText !== undefined) publications.push(...extractJuntaNotices(entryPublication, entryNoticeText, previousNotices));
        }
      }
    }
    const placements = portalPlacements.filter(x => x.url === officialUrl);
    const previousRoot = previousDriveById.get(`padrones:${externalId}`);
    const oldPlacements = readMetadata(previousRoot?.metadata).portalPlacements;
    metadata = JSON.stringify({ ...readMetadata(metadata), portalPlacements: placements.length ? placements : oldPlacements || [], portalWarning });
    const rootPublication: Publication = { id: `padrones:${externalId}`, source: "Padrones y Comunicados", externalId, kind: "junta", category, title, summary, level: "", area: "", junta, location: "", shift: "", character: "", startsAt: null, endsAt: null, status: documentStatus, officialUrl, metadata, contentHash: await hash(`${fingerprint}|${documentStatus}`), sourceUpdatedAt: null };
    publications.push(documentReference(rootPublication));
    if (rawNoticeText !== undefined) {
      const notices = extractJuntaNotices(rootPublication, rawNoticeText, previousNotices);
      publications.push(...notices);
      if (!notices.length) {
        incompleteCategories.add(category);
        warnings[category] = `${externalId}: no se reconocieron límites de avisos; se mantiene la referencia oficial.`;
      }
    }
    } catch (error) {
      incompleteCategories.add(category);
      categoryErrors[category] = error;
      warnings[category] = `${externalId}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 400);
      firstError ??= error;
      console.error("document_source_failed", externalId, error);
    }
    }));
  }
  if (!publications.length && firstError) throw firstError;
  return { items: publications, complete: incompleteCategories.size === 0, incompleteCategories: [...incompleteCategories], warnings, categoryErrors };
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
  const fdciMode = (env as { FDCI_SYNC_MODE?: string }).FDCI_SYNC_MODE;
  const external = externalSyncSources((env as { EXTERNAL_SYNC_SOURCES?: string }).EXTERNAL_SYNC_SOURCES, fdciMode);
  const legacyFdci = fdciLegacyEnabled(fdciMode) && !external.has("Capacitación Docente");
  const externalNames = [...external];
  const legacyWhere = externalNames.length ? ` WHERE source NOT IN (${externalNames.map(() => "?").join(",")})` : "";
  const legacyCondition = externalNames.length ? ` AND source NOT IN (${externalNames.map(() => "?").join(",")})` : "";
  const previous = await db.prepare(`SELECT id, external_id, official_url, source_published_at, source, category, kind, status, source_status, registration_open_at, registration_close_at, expires_at, content_hash, starts_at, ends_at, metadata, normalized_status, title, summary, level, area, junta, location, shift, character, source_updated_at FROM publications${legacyWhere}`).bind(...externalNames).all<{ id: string; external_id: string; official_url: string; source_published_at: string | null; source: string; category: string; kind: string; status: string; source_status: string; registration_open_at: string | null; registration_close_at: string | null; expires_at: string | null; content_hash: string; starts_at: string | null; ends_at: string | null; metadata: string; normalized_status: string; title: string; summary: string; level: string; area: string; junta: string; location: string; shift: string; character: string; source_updated_at: string | null }>();
  let rowsRead = Number(previous.meta?.rows_read || previous.results.length);
  const old = new Map(previous.results.map((row) => [row.id, row]));
  const sourceHealthNames = ["SIME", ...(legacyFdci ? ["Capacitación Docente"] : []), "Padrones", "Llamados abiertos", "Comunicados", "Resoluciones", "Información oficial Tucumán", "CeNET / INET", "INFoD / AulaS-TIC"]
    .filter((source) => !external.has(["Padrones", "Llamados abiertos", "Comunicados", "Resoluciones"].includes(source) ? "Padrones y Comunicados" : source));
  const collectors: { source: string; run: () => Promise<Publication[] | { items: Publication[]; complete: boolean; incompleteCategories?: string[]; warnings?: Record<string, string>; categoryErrors?: Record<string, unknown> }> }[] = [
    { source: "SIME", run: () => collectSimePublications(old) },
    ...(legacyFdci ? [{ source: "Capacitación Docente", run: trainingPublications }] : []),
    { source: "Padrones y Comunicados", run: boardPublications },
    { source: "Información oficial Tucumán", run: usefulPublications },
    { source: "CeNET / INET", run: cenetPublications },
    { source: "INFoD / AulaS-TIC", run: infdPublications },
  ].filter((collector) => !external.has(collector.source));
  const syncStartedAt = new Date().toISOString();
  let rowsWritten = 0;
  const countWrites = (result: unknown) => { for (const item of Array.isArray(result) ? result : [result]) { const meta = (item as { meta?: { rows_written?: number; rows_read?: number } })?.meta; rowsWritten += Number(meta?.rows_written || 0); rowsRead += Number(meta?.rows_read || 0); } };
  countWrites(await db.batch(sourceHealthNames.map((source) => db.prepare(`INSERT INTO sync_state (source, synced_at, item_count, last_attempt_at, sync_status, parser_version)
    VALUES (?, CURRENT_TIMESTAMP, 0, ?, 'UNKNOWN', '2')
    ON CONFLICT(source) DO UPDATE SET last_attempt_at=excluded.last_attempt_at`).bind(source, syncStartedAt))));
  const collected = await Promise.all(collectors.map(async (collector) => {
    try {
      const value = await collector.run();
      return { source: collector.source, items: Array.isArray(value) ? value : value.items, complete: Array.isArray(value) || value.complete, incompleteCategories: Array.isArray(value) ? [] : value.incompleteCategories || [], warnings: Array.isArray(value) ? {} : value.warnings || {}, categoryErrors: Array.isArray(value) ? {} : value.categoryErrors || {}, error: null as unknown };
    } catch (error) {
      return { source: collector.source, items: [] as Publication[], complete: false, incompleteCategories: [] as string[], warnings: {} as Record<string, string>, categoryErrors: {} as Record<string, unknown>, error };
    }
  }));
  const sourceItems = collected.flatMap((result) => result.items);
  const presentIds = new Set(sourceItems.map(x => x.id));
  // A partial source must not discard already recovered notices or their
  // evidence while other collectors happen to succeed.
  for (const row of previous.results) {
    const m = officialMetadata(row), collector = collected.find(x => x.source === row.source);
    if (!m || presentIds.has(row.id) || !collector) continue;
    if (collector.error || !collector.complete && (row.source === "SIME" || collector.incompleteCategories.includes(m.sourceCategory || row.category))) {
      sourceItems.push(fromStoredPublication(row)); presentIds.add(row.id);
    }
  }
  const unnormalized = reconcileOfficialPublications(sourceItems);
  const publications = await Promise.all(unnormalized.map(async (item) => {
    let metadata: Record<string, unknown> = {};
    try { metadata = JSON.parse(item.metadata || "{}") as Record<string, unknown>; } catch {}
    const asText = (value: unknown): string => typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : Array.isArray(value) ? value.map(asText).filter(Boolean).join(" · ") : "";
    const explicitRaw = [metadata.circuit, metadata.circuito, metadata.circuitos, metadata.sourceCircuitRaw, metadata.source_circuit_raw].map(asText).filter(Boolean).join(" · ");
    const body = [item.title, item.summary, asText(metadata.recipients), asText(metadata.content)].filter(Boolean).join(" · ");
    const bodyHasCircuit = /\bcircuitos?\b|\btoda la provincia\b|\bprovincial\b/i.test(body);
    const explicit = explicitRaw || (bodyHasCircuit ? body : "");
    const department = [metadata.department, metadata.departamento, metadata.departmentName, metadata.nombre_departamento].map(asText).filter(Boolean).join(" · ");
    const labeledPlace = body.match(/\b(?:departamento|localidad|establecimiento)\s*[:\-]\s*([^.;\n]+)/i)?.[1]?.trim() || "";
    // SIME's public vacancy row often embeds a department name in the school
    // description but has no separate locality field. Infer a circuit only
    // when one of the official department names is literally present there.
    const simeSchoolText = item.source === "SIME" ? item.title : "";
    const locality = [metadata.locality, metadata.localidad, metadata.location, metadata.ubicacion, item.location, labeledPlace, simeSchoolText].map(asText).filter(Boolean).join(" · ");
    const inferred = inferCircuit({ explicit, department, locality });
    const normalizedHash = officialMetadata(item) ? await hash(JSON.stringify({ title: item.title, summary: item.summary, metadata: readMetadata(item.metadata),
      startsAt: item.startsAt, endsAt: item.endsAt, category: item.category, location: item.location, status: item.status, sourceHash: item.contentHash })) : item.contentHash;
    return { ...item, circuit: inferred.normalizedCircuit, sourceCircuitRaw: inferred.sourceCircuitRaw, circuitInferenceSource: inferred.circuitInferenceSource, circuitConfidence: inferred.circuitConfidence, contentHash: await hash(`${normalizedHash}|circuit:${inferred.normalizedCircuit}|raw:${inferred.sourceCircuitRaw}|via:${inferred.circuitInferenceSource}`) };
  }));
  const { fresh, changed, unchanged, writes } = diffByHash(old, publications);
  const metadataOf = (value: string | undefined) => { try { return JSON.parse(value || "{}") as Record<string, unknown>; } catch { return {}; } };
  const notificationChanges = changed.filter((item) => {
    const previousItem = old.get(item.id);
    if (!previousItem) return false;
    if (item.kind === "junta" && previousItem.status === "vigente" && item.status.startsWith("Documento público")) return false;
    if (item.kind === "junta" && isDocumentTextExportMigration(previousItem.metadata, item.metadata || "{}", previousItem.source_updated_at, item.sourceUpdatedAt)) return false;
    if (officialChange(previousItem.metadata, item.metadata)) return true;
    if (item.source === "INFoD / AulaS-TIC" && previousItem.title === item.title && previousItem.status === item.status && previousItem.starts_at === item.startsAt && previousItem.ends_at === item.endsAt) return false;
    if (hasMeaningfulPublicationChange({ ...previousItem, startsAt: previousItem.starts_at, endsAt: previousItem.ends_at, sourceUpdatedAt: previousItem.source_updated_at }, item)) return true;
    if (item.kind !== "capacitacion") return false;
    const previousMetadata = metadataOf(previousItem.metadata), currentMetadata = metadataOf(item.metadata);
    return ["registrationOpensAt", "registrationClosesAt", "courseStartsAt", "courseEndsAt", "dateStatus", "recipients"]
      .some((field) => !Object.is(previousMetadata[field] ?? null, currentMetadata[field] ?? null));
  });
  const now = new Date();
  const lifecycleById = new Map(publications.map((item) => {
    const metadata = metadataOf(item.metadata);
    const lifecycle = officialLifecycle(item, now) ?? publicationLifecycle({ sourceStatus: item.status, sourceStatusIsExplicit: true,
      registrationOpenAt: typeof metadata.registrationOpensAt === "string" ? metadata.registrationOpensAt : null,
      registrationCloseAt: typeof metadata.registrationClosesAt === "string" ? metadata.registrationClosesAt : null,
      expiresAt: item.kind === "vacante" ? item.endsAt : typeof metadata.courseEndsAt === "string" ? metadata.courseEndsAt : null,
      dateStatus: typeof metadata.dateStatus === "string" ? metadata.dateStatus : null, now });
    return [item.id, lifecycle] as const;
  }));
  for (let offset = 0; offset < writes.length; offset += 40) {
    countWrites(await db.batch(writes.slice(offset, offset + 40).map((item) => {
      const metadata = metadataOf(item.metadata);
      const registrationOpenAt = typeof metadata.registrationOpensAt === "string" ? metadata.registrationOpensAt : null;
      const registrationCloseAt = typeof metadata.registrationClosesAt === "string" ? metadata.registrationClosesAt : null;
    const official = officialMetadata(item), directCall = official?.topics.includes("LLAMADO_ABIERTO") && !official?.topics.includes("INSCRIPCION_SIME");
    const expiresAt = directCall ? official?.facts.registrationEnd?.precision === "datetime" ? official.facts.registrationEnd.value : null : item.kind === "vacante" ? item.endsAt : typeof metadata.courseEndsAt === "string" ? metadata.courseEndsAt : null;
      return db.prepare(`INSERT INTO publications (id, source, external_id, kind, category, title, summary, level, area, junta, location, shift, character, circuit, source_circuit_raw, circuit_inference_source, starts_at, ends_at, status, official_url, metadata, content_hash, source_updated_at, last_seen_at, last_changed_at, source_published_at, registration_open_at, registration_close_at, expires_at, source_status, normalized_status, circuit_confidence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET source=excluded.source, category=excluded.category, title=excluded.title, summary=excluded.summary, level=excluded.level, area=excluded.area, junta=excluded.junta, location=excluded.location, shift=excluded.shift, character=excluded.character, circuit=excluded.circuit, source_circuit_raw=excluded.source_circuit_raw, circuit_inference_source=excluded.circuit_inference_source, starts_at=excluded.starts_at, ends_at=excluded.ends_at, status=excluded.status, official_url=excluded.official_url, metadata=excluded.metadata, content_hash=excluded.content_hash, source_updated_at=excluded.source_updated_at, last_seen_at=excluded.last_seen_at, last_changed_at=excluded.last_changed_at, source_published_at=excluded.source_published_at, registration_open_at=excluded.registration_open_at, registration_close_at=excluded.registration_close_at, expires_at=excluded.expires_at, source_status=excluded.source_status, normalized_status=excluded.normalized_status, removed_at=NULL, circuit_confidence=excluded.circuit_confidence, updated_at=CURRENT_TIMESTAMP`)
        .bind(item.id, item.source, item.externalId, item.kind, item.category, item.title, item.summary, item.level, item.area, item.junta, item.location, item.shift, item.character, item.circuit || "UNKNOWN", item.sourceCircuitRaw || "", item.circuitInferenceSource || "unknown", item.startsAt, item.endsAt, item.status, item.officialUrl, item.metadata || "{}", item.contentHash, item.sourceUpdatedAt, syncStartedAt, syncStartedAt, item.sourcePublishedAt || null, registrationOpenAt, registrationCloseAt, expiresAt, item.status || "UNKNOWN", lifecycleById.get(item.id) || "UNKNOWN", item.circuitConfidence || 0);
    })));
  }
  const lifecycleUpdates = unchanged.filter((item) => old.get(item.id)?.normalized_status !== lifecycleById.get(item.id));
  for (let offset = 0; offset < lifecycleUpdates.length; offset += 40) {
    countWrites(await db.batch(lifecycleUpdates.slice(offset, offset + 40).map((item) => db.prepare("UPDATE publications SET normalized_status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(lifecycleById.get(item.id), item.id))));
  }
  if (legacyFdci && !collected.find((result) => result.source === "Capacitación Docente")?.error) {
    countWrites(await db.prepare("INSERT OR IGNORE INTO saved_publications (user_id, publication_id, in_agenda, followed, saved_at) SELECT s.user_id, 'fdci:course:' || p.external_id, s.in_agenda, s.followed, s.saved_at FROM saved_publications s JOIN publications p ON p.id=s.publication_id JOIN publications replacement ON replacement.id='fdci:course:' || p.external_id WHERE p.id LIKE 'fdci:%' AND p.id NOT LIKE 'fdci:course:%' AND p.id NOT LIKE 'fdci:commission:%'").run());
  }

  const sourceGroup = (healthSource: string) => {
    if (["Padrones", "Llamados abiertos", "Comunicados", "Resoluciones"].includes(healthSource)) return {
      source: "Padrones y Comunicados", filter: (item: { category: string; metadata?: string }) => (officialMetadata(item)?.sourceCategory || item.category) === healthSource,
      oldRows: previous.results.filter((item) => item.source === "Padrones y Comunicados" && (officialMetadata(item)?.sourceCategory || item.category) === healthSource),
    };
    return { source: healthSource, filter: () => true, oldRows: previous.results.filter((item) => item.source === healthSource) };
  };
  const health = sourceHealthNames.map((source) => {
    const sourceCollector = collected.find((result) => result.source === source || (sourceGroup(source).source === result.source));
    const filter = sourceGroup(source).filter;
    const current = sourceCollector?.items.filter(filter) || [];
    const oldRows = sourceGroup(source).oldRows;
    const complete = sourceGroup(source).source === "Padrones y Comunicados" ? !sourceCollector?.incompleteCategories.includes(source) : sourceCollector?.complete;
    const error = sourceCollector?.error || (!current.length && sourceCollector?.categoryErrors[source]) || null;
    const status = assessSourceSync({ previousCount: oldRows.length, recordsFound: current.length, complete, error });
    return { source, storageSource: sourceGroup(source).source, current, oldRows, status, error };
  });
  const sourceHealthByPublication = (item: Publication) => item.source === "Padrones y Comunicados" ? officialMetadata(item)?.sourceCategory || item.category : item.source;
  const healthBySource = new Map(health.map((item) => [item.source, item]));
  const removedBySource = new Map<string, number>();
  for (const item of health) {
    const advertisedCenetId = item.source === "CeNET / INET" ? item.current[0]?.id : undefined;
    const previousIds = item.oldRows.filter((row) => {
      // CeNET publishes only the advertised cohort. An older cohort is historical, not deleted from the source.
      if (advertisedCenetId && isHistoricalCenetOffer(row.id, advertisedCenetId)) return false;
      const metadata = metadataOf(row.metadata);
      if (officialMetadata(row)?.entity === "event") return false;
      const state = publicationLifecycle({ normalizedStatus: row.normalized_status, sourceStatus: row.source_status || row.status, sourceStatusIsExplicit: true,
        registrationOpenAt: row.registration_open_at || (typeof metadata.registrationOpensAt === "string" ? metadata.registrationOpensAt : null),
        registrationCloseAt: row.registration_close_at || (typeof metadata.registrationClosesAt === "string" ? metadata.registrationClosesAt : null),
        expiresAt: row.expires_at || (row.kind === "vacante" ? row.ends_at : typeof metadata.courseEndsAt === "string" ? metadata.courseEndsAt : null),
        dateStatus: typeof metadata.dateStatus === "string" ? metadata.dateStatus : null, now });
      return !["CLOSED", "EXPIRED", "REMOVED_FROM_SOURCE"].includes(state);
    }).map((row) => row.id);
    const currentIds = item.current.map((row) => row.id);
    const missing = missingAfterValidatedSync(previousIds, currentIds, item.status as SourceSyncStatus);
    if (missing.length) {
      const statements = missing.map((id) => db.prepare(`UPDATE publications SET source_status='REMOVED_FROM_SOURCE', normalized_status='REMOVED_FROM_SOURCE', removed_at=?, status='desaparecida del origen', updated_at=CURRENT_TIMESTAMP WHERE id=? AND normalized_status NOT IN ('CLOSED','EXPIRED','REMOVED_FROM_SOURCE')`).bind(syncStartedAt, id));
      for (let offset = 0; offset < statements.length; offset += 40) countWrites(await db.batch(statements.slice(offset, offset + 40)));
      removedBySource.set(item.source, missing.length);
    }
    if (item.status === "OK") {
      const categoryCondition = item.storageSource === "Padrones y Comunicados" ? " AND category=?" : "";
      const statement = item.storageSource === "Padrones y Comunicados"
        ? db.prepare(`UPDATE publications SET last_seen_at=? WHERE source=?${categoryCondition} AND normalized_status<>'REMOVED_FROM_SOURCE' AND (last_seen_at='' OR datetime(last_seen_at)<datetime(?,'-24 hours'))`).bind(syncStartedAt, item.storageSource, item.source, syncStartedAt)
        : db.prepare("UPDATE publications SET last_seen_at=? WHERE source=? AND normalized_status<>'REMOVED_FROM_SOURCE' AND (last_seen_at='' OR datetime(last_seen_at)<datetime(?,'-24 hours'))").bind(syncStartedAt, item.storageSource, syncStartedAt);
      countWrites(await statement.run());
    }
  }
  if (legacyFdci && !collected.find((result) => result.source === "Capacitación Docente")?.error) {
    countWrites(await db.prepare(`UPDATE publications SET registration_open_at=NULL, registration_close_at=NULL,
      metadata=json_set(json_remove(metadata,'$.registrationOpensAt','$.registrationHasTime'), '$.preinscripcionFechaConfirmada', json('false'), '$.dateStatus', 'unknown'), updated_at=CURRENT_TIMESTAMP
      WHERE id LIKE 'fdci:course:%' AND normalized_status='REMOVED_FROM_SOURCE' AND registration_open_at IS NOT NULL AND json_valid(metadata)`).run());
    const reminders = await db.prepare(`SELECT r.id, r.user_id, r.publication_id, r.opens_at, r.advance_minutes, r.precision, r.notified,
      p.registration_open_at, p.normalized_status, p.metadata
      FROM training_reminders r JOIN publications p ON p.id=r.publication_id WHERE r.publication_id LIKE 'fdci:%'`)
      .all<{ id: string; user_id: string; publication_id: string; opens_at: string; advance_minutes: number; precision: string; notified: number; registration_open_at: string | null; normalized_status: string; metadata: string }>();
    rowsRead += Number(reminders.meta?.rows_read || reminders.results.length);
    for (const reminder of reminders.results) {
      const metadata = parseTrainingMetadata(reminder.metadata), opening = reminder.registration_open_at ? Date.parse(reminder.registration_open_at) : Number.NaN;
      if (!metadata?.preinscripcionFechaConfirmada || !Number.isFinite(opening) || opening <= now.getTime() || !["ACTIVE", "UPCOMING"].includes(reminder.normalized_status)) {
        countWrites(await db.prepare("DELETE FROM training_reminders WHERE id=?").bind(reminder.id).run());
        continue;
      }
      const key = trainingReminderKey(metadata), id = `${reminder.user_id}:${key}:${reminder.advance_minutes}`;
      const remindAt = new Date(opening - reminder.advance_minutes * 60_000).toISOString();
      if (id !== reminder.id) {
        countWrites(await db.prepare(`INSERT OR IGNORE INTO training_reminders (id, user_id, training_id, publication_id, opens_at, precision, advance_minutes, remind_at, notified)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, reminder.user_id, key, reminder.publication_id, reminder.registration_open_at, reminder.precision, reminder.advance_minutes, remindAt, reminder.opens_at === reminder.registration_open_at ? reminder.notified : 0).run());
        countWrites(await db.prepare("DELETE FROM training_reminders WHERE id=?").bind(reminder.id).run());
      } else if (reminder.opens_at !== reminder.registration_open_at) {
        countWrites(await db.prepare("UPDATE training_reminders SET opens_at=?, remind_at=?, notified=0, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(reminder.registration_open_at, remindAt, id).run());
      }
    }
  }
  for (const lifecycle of ["EXPIRED", "CLOSED"] as const) {
    const reliableCourseDate = "(kind<>'capacitacion' OR (json_valid(metadata) AND lower(COALESCE(json_extract(metadata,'$.dateStatus'),'')) IN ('confirmed','course_confirmed')))";
    const condition = lifecycle === "EXPIRED" ? `expires_at IS NOT NULL AND datetime(expires_at)<datetime(?) AND ${reliableCourseDate}` : `registration_close_at IS NOT NULL AND datetime(registration_close_at)<datetime(?) AND (expires_at IS NULL OR datetime(expires_at)>=datetime(?)) AND ${reliableCourseDate}`;
    const binds = lifecycle === "EXPIRED" ? [syncStartedAt] : [syncStartedAt, syncStartedAt];
    countWrites(await db.prepare(`UPDATE publications SET normalized_status='${lifecycle}', updated_at=CURRENT_TIMESTAMP WHERE normalized_status IN ('ACTIVE','UPCOMING','UNKNOWN') AND normalized_status<>'REMOVED_FROM_SOURCE' AND ${condition}${legacyCondition}`).bind(...binds, ...externalNames).run());
  }
  if (!external.has("Padrones y Comunicados")) countWrites(await db.prepare("UPDATE publications SET status='Documento público · vigencia no informada', source_status='Documento público · vigencia no informada', normalized_status='UNKNOWN' WHERE source='Padrones y Comunicados' AND status='vigente' AND normalized_status IN ('ACTIVE','UPCOMING') AND starts_at IS NULL AND ends_at IS NULL").run());
  const expiredRows = await db.prepare(`SELECT id, source, category FROM publications WHERE normalized_status IN ('CLOSED','EXPIRED')${legacyCondition}`).bind(...externalNames).all<{ id: string; source: string; category: string }>();
  rowsRead += Number(expiredRows.meta?.rows_read || expiredRows.results.length);
  const expiredBySource = new Map<string, number>(), expiredTotalBySource = new Map<string, number>();
  for (const row of expiredRows.results) {
    const source = row.source === "Padrones y Comunicados" ? row.category : row.source;
    expiredTotalBySource.set(source, (expiredTotalBySource.get(source) || 0) + 1);
    if (!["CLOSED", "EXPIRED"].includes(old.get(row.id)?.normalized_status || "")) expiredBySource.set(source, (expiredBySource.get(source) || 0) + 1);
  }
  const metricsFor = (source: string) => {
    const item = healthBySource.get(source)!;
    const created = fresh.filter((row) => sourceHealthByPublication(row) === source).length;
    const updated = changed.filter((row) => sourceHealthByPublication(row) === source).length;
    const removed = removedBySource.get(source) || 0;
    const healthMessages: Partial<Record<SourceSyncStatus, string>> = {
      EMPTY_SUSPECT: "La fuente devolvió cero registros pese a existir datos previos; se conservaron las publicaciones.",
      PARTIAL: "La extracción fue parcial; se incorporaron los resultados recuperados y no se reconciliaron ausencias.",
      FORMAT_CHANGED: "No se reconoció la estructura esperada de la fuente; se conservaron los datos anteriores.",
      DNS_ERROR: "No se pudo localizar el servidor de la fuente; se conservaron los datos anteriores.",
      NETWORK_ERROR: "No se pudo conectar con la fuente; se conservaron los datos anteriores.",
      REDIRECT_ERROR: "La fuente redirigió la consulta a un destino inesperado; se conservaron los datos anteriores.",
      HTML_RESPONSE: "La fuente respondió con una página web en lugar de datos; se conservaron los datos anteriores.",
      EMPTY_RESPONSE: "La fuente respondió vacía; se conservaron los datos anteriores.",
      SCHEMA_ERROR: "La estructura de los datos de la fuente no coincide con la esperada; se conservaron los datos anteriores.",
      TIMEOUT: "La fuente excedió el tiempo de espera; se conservaron los datos anteriores.",
      HTTP_ERROR: "La fuente respondió con un error HTTP; se conservaron los datos anteriores.",
      PARSE_ERROR: "No se pudo interpretar el JSON de la fuente; se conservaron los datos anteriores.",
    };
    const warning = collected.find((result) => result.source === item.storageSource)?.warnings[source];
    const errorMessage = item.error instanceof Error ? item.error.message.slice(0, 400) : item.error ? String(item.error).slice(0, 400) : warning || healthMessages[item.status] || null;
    const sourceError = item.error;
    const errorCode = item.status === "OK" ? null : sourceError ? sourceErrorCode(sourceError) : item.status;
    return { item, created, updated, removed, expired: expiredBySource.get(source) || 0, expiredTotal: expiredTotalBySource.get(source) || 0, errorMessage, errorCode };
  };
  countWrites(await db.batch(sourceHealthNames.map((source) => {
    const metrics = metricsFor(source), { item } = metrics;
    const changedCount = metrics.created + metrics.updated + metrics.removed;
    const itemCount = item.current.length;
    return db.prepare(`UPDATE sync_state SET
      synced_at=CASE WHEN ?='OK' THEN ? ELSE synced_at END,
      item_count=CASE WHEN ? IN ('OK','PARTIAL') THEN ? ELSE item_count END,
      error=CASE WHEN ?='OK' THEN NULL ELSE ? END,
      last_successful_sync_at=CASE WHEN ?='OK' THEN ? ELSE last_successful_sync_at END,
      last_content_change_at=CASE WHEN ?='OK' AND ?>0 THEN ? ELSE last_content_change_at END,
      records_created=?, records_updated=?, records_removed=?, records_expired=?, sync_status=?, error_code=?, error_message=?, parser_version='2'
      WHERE source=?`).bind(item.status, syncStartedAt, item.status, itemCount, item.status, metrics.errorMessage, item.status, syncStartedAt, item.status, changedCount, syncStartedAt, metrics.created, metrics.updated, metrics.removed, metrics.expired, item.status, metrics.errorCode, metrics.errorMessage, source);
  })));

  const profiles = await db.prepare("SELECT * FROM profiles").all<Record<string, unknown>>();
  rowsRead += Number(profiles.meta?.rows_read || profiles.results.length);
  const interesting = [...fresh, ...notificationChanges].filter((item) => {
    const m = officialMetadata(item);
    return (!m || !m.canonicalId && m.entity !== "reference" && !m.candidateIds?.length && !m.topics.includes("CLASIFICACION_PENDIENTE"))
    && !item.id.startsWith("drive:") && item.kind !== "informacion"
    && ["ACTIVE", "UPCOMING"].includes(String(lifecycleById.get(item.id)))
    && healthBySource.get(sourceHealthByPublication(item))?.status === "OK";
  });
  for (const profile of profiles.results) {
    const fullProfile = { level: String(profile.level || ""), levels: String(profile.level || "").split(/[,;|]/).filter(Boolean), area: String(profile.area || ""), subjects: String(profile.subjects || ""), junta: String(profile.junta || ""), boards: String(profile.junta || "").split(/[,;|]/).filter(Boolean), roles: String(profile.roles || ""), department: String(profile.department || ""), locality: String(profile.locality || ""), shifts: String(profile.shifts || ""), characters: String(profile.characters || "").split(/[,;|]/).filter(Boolean), circuits: String(profile.circuits || "").split(/[,;|]/).filter(Boolean), personalMatchThreshold: Number(profile.personal_match_threshold) || 85, wantsInterim: Boolean(profile.wants_interim), wantsSubstitute: Boolean(profile.wants_substitute), trainingInterests: String(profile.training_interests || "") };
    const match = (item: Publication) => {
      if (fullProfile.circuits.length) {
        const directCircuit = item.circuit && /^[iv]+$|^[1-5]$/i.test(item.circuit) ? `Circuito ${item.circuit}` : item.circuit === "ALL" ? "todos los circuitos" : item.sourceCircuitRaw || "";
        if (circuitMatches(inferCircuit({ explicit: directCircuit, locality: item.location || item.sourceCircuitRaw || "" }), fullProfile.circuits) === false) return false;
      }
      if (item.kind === "vacante") return isEligibleForPersonalizedHome({ ...item, role: designationRoleFromTitle(item.title) }, fullProfile);
      if (item.kind !== "capacitacion") return matchesProfile(item, fullProfile);
      if (!Boolean(profile.notify_new_trainings)) return false;
      const metadata = parseTrainingMetadata(item.metadata), scope = String(profile.training_notify_scope || "relevant");
      const matchPublication = metadata?.recipients ? { ...item, recipients: metadata.recipients } : item;
      if (scope === "all") return true;
      if (scope === "level") return matchesProfile(matchPublication, { level: fullProfile.level });
      if (scope === "area") return matchesProfile(matchPublication, { area: fullProfile.area, subjects: fullProfile.subjects });
      if (scope === "interests") return matchesProfile(matchPublication, { trainingInterests: fullProfile.trainingInterests });
      const state = registrationState(metadata?.registrationOpensAt, metadata?.registrationClosesAt, new Date());
      return ["today", "tomorrow", "two-three", "four-seven", "eight-fourteen"].includes(state) && isEligibleForPersonalizedHome(matchPublication, fullProfile);
    };
    const statements = interesting.filter(match).map((item) => {
      const metadata = item.kind === "capacitacion" ? parseTrainingMetadata(item.metadata) : null, previous = old.get(item.id), previousMetadata = item.kind === "capacitacion" ? parseTrainingMetadata(previous?.metadata) : null;
      const dateChanged = Boolean(previous && [previous.starts_at, previous.ends_at, previousMetadata?.registrationOpensAt, previousMetadata?.registrationClosesAt, previousMetadata?.courseStartsAt, previousMetadata?.courseEndsAt, previousMetadata?.dateStatus].join("|") !== [item.startsAt, item.endsAt, metadata?.registrationOpensAt, metadata?.registrationClosesAt, metadata?.courseStartsAt, metadata?.courseEndsAt, metadata?.dateStatus].join("|"));
      const designationMatch = item.kind === "vacante" ? profileMatch({ ...item, role: designationRoleFromTitle(item.title) }, fullProfile) : null;
      const designationType = designationMatch ? `DESIGNACION_${designationMatch.status === "exact" ? "EXACTA" : "PARCIAL"}_${designationMatch.criteria.some((criterion) => criterion.key === "role" && criterion.matched) ? "CARGO" : "GENERAL"}` : "DESIGNACION_NUEVA";
      const type = officialMetadata(item)?.entity === "event" ? old.has(item.id) ? "FECHA_CAMBIADA" : "FECHA_IMPORTANTE" : old.has(item.id) ? (item.kind === "junta" ? item.category === "Comunicados" ? "COMUNICADO_ACTUALIZADO" : "PADRON_ACTUALIZADO" : item.kind === "vacante" ? "DESIGNACION_CAMBIO" : dateChanged ? "FECHA_CAMBIADA" : item.kind === "capacitacion" ? "CAPACITACION_ACTUALIZADA" : "FECHA_IMPORTANTE") : item.kind === "vacante" ? designationType : metadata?.entity === "commission" ? "COMISION_NUEVA" : item.kind === "capacitacion" ? "CAPACITACION_NUEVA" : item.category === "Comunicados" ? "COMUNICADO_NUEVO" : "PADRON_NUEVO";
      const eventDate = metadata?.registrationOpensAt || metadata?.registrationClosesAt || item.endsAt || item.startsAt || item.sourceUpdatedAt || item.contentHash;
      const eventIdentity = old.has(item.id) ? `change:${item.contentHash}` : `date:${eventDate}`;
      const dedupeKey = notificationDedupeKey(item.id, type, eventIdentity);
      return db.prepare("INSERT OR IGNORE INTO notifications (user_id, publication_id, type, dedupe_key, scheduled_at) VALUES (?, ?, ?, ?, ?)").bind(String(profile.user_id), item.id, type, dedupeKey, syncStartedAt);
    });
    for (let offset = 0; offset < statements.length; offset += 40) countWrites(await db.batch(statements.slice(offset, offset + 40)));
  }
  const sourceMetrics = sourceHealthNames.map((source) => {
    const item = healthBySource.get(source)!;
    return { source, status: item.status, recordsFound: item.current.length, created: metricsFor(source).created, updated: metricsFor(source).updated, removed: removedBySource.get(source) || 0, expired: metricsFor(source).expired, expiredTotal: metricsFor(source).expiredTotal, lastSuccessfulSyncAt: item.status === "OK" ? syncStartedAt : null, errorCode: metricsFor(source).errorCode, errorMessage: metricsFor(source).errorMessage };
  });
  // The Worker cron is every 5 minutes, but it invokes source sync only at :00.
  const estimatedRunsPerDay = 24;
  const metrics = { startedAt: syncStartedAt, finishedAt: new Date().toISOString(), count: publications.length, fresh: fresh.length, changed: changed.length, unchanged: unchanged.length, failures: health.filter((item) => item.status !== "OK").length, rowsRead, rowsWritten, estimatedRowsWrittenPerDay: rowsWritten * estimatedRunsPerDay, sources: sourceMetrics };
  console.log("sync_completed", metrics);
  return metrics;
}

export async function POST(request: Request) {
  try {
    const scheduled = Boolean(env.CRON_SECRET) && request.headers.get("x-docentetuc-cron") === env.CRON_SECRET;
    if (!scheduled) await currentUser(request);
    if (legacySyncPaused((env as { LEGACY_SYNC_PAUSED?: string }).LEGACY_SYNC_PAUSED))
      return Response.json({ ok: true, skipped: true, reason: "legacy_sync_paused" });
    const db = getD1();
    const latest = await db.prepare("SELECT MAX(last_attempt_at) AS attempted_at, COUNT(*) AS source_count, SUM(CASE WHEN sync_status<>'OK' THEN 1 ELSE 0 END) AS unhealthy FROM sync_state").first<{ attempted_at: string | null; source_count: number; unhealthy: number | null }>();
    if (!scheduled && Number(latest?.source_count || 0) >= 9 && Number(latest?.unhealthy || 0) === 0 && latest?.attempted_at && Date.now() - new Date(latest.attempted_at).getTime() < 60 * 60_000) return Response.json({ ok: true, skipped: true, reason: "central_sync_recent" });
    const metrics = await runSync();
    return Response.json(scheduled ? { ok: true, ...metrics } : { ok: true, count: metrics.count, failures: metrics.failures, verifiedSources: metrics.sources.filter((source) => source.status === "OK").length });
  } catch (error) {
    console.error("sync_failed", error);
    return Response.json({ error: authError(error) ? "Iniciá sesión para actualizar." : "No se pudieron actualizar las fuentes. Probá nuevamente en unos minutos." }, { status: authError(error) ? 401 : 502 });
  }
}
