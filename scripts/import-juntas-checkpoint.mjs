// Opt-in Node runner. Never invoked by the legacy collector or a scheduled workflow.
import { createHash, randomUUID } from "node:crypto";
import { listDrivePage } from "../lib/junta-external.ts";
import { JUNTA_EXTERNAL_SOURCES } from "../lib/junta-external-sources.ts";
import { classifyDriveReference, documentReference, extractJuntaNotices } from "../lib/junta-notices.ts";
import { driveEntryUrl, plainDocumentText } from "../lib/public-documents.ts";
import { prepareJuntaImport } from "../lib/public-source-import.ts";
import { officialMetadata, withOfficial } from "../lib/official-publication.ts";
import { padronTitleFacts } from "../lib/padron-documents.ts";
import { createDirectD1ReceiverFetch } from "./direct-d1-receiver.mjs";

const folderMime = "application/vnd.google-apps.folder";
const docMime = "application/vnd.google-apps.document";
const day = 24 * 60 * 60 * 1000;
const changes = (result) => Number(result?.meta?.changes ?? result?.meta?.rows_written ?? 0);
const digest = (value) => createHash("sha256").update(value).digest("hex");
// Only explicit, unambiguous period evidence can defer work to the archive.
export function padronWorkScope(entry, now) {
  const year = Number(new Intl.DateTimeFormat('en', {timeZone:'America/Argentina/Tucuman',year:'numeric'}).format(new Date(now)));
  const facts = [entry.name, ...(entry.ancestors || []).map(folder => folder.name),
    ...(entry.suspendedPage?.files.slice(entry.suspendedPage.index).map(file=>file.name)||[])].filter(Boolean).map(padronTitleFacts);
  if (facts.some(fact => fact.yearAmbiguous)) return 'unknown';
  const years = facts.map(fact => fact.year).filter(value => value !== null);
  return years.some(value => value >= year) ? 'current' : years.length ? 'history' : 'unknown';
}

export function padronCurrentCoverage(full, probe, now, { error = false, unacknowledged = false } = {}) {
  const dayOf = value => {
    const date = new Date(value || 'invalid');
    return Number.isFinite(+date) ? new Intl.DateTimeFormat('en-CA', {timeZone:'America/Argentina/Tucuman',year:'numeric',month:'2-digit',day:'2-digit'}).format(date) : null;
  };
  if (!full || !probe) return { currentStatus: 'UNVERIFIED', historyPendingFolders: null, currentPendingFolders: null, currentVerifiedAt: null };
  const state = decode(full.state_json), history = state.queue.filter(entry => padronWorkScope(entry, now) === 'history');
  const pending = state.queue.length - history.length;
  // A file with newer/contradictory evidence inside an old folder remains current work.
  const activeCurrent = state.page && state.page.files.slice(state.page.index).some(file =>
    padronWorkScope({name:file.name,ancestors:state.queue[0]?.ancestors},now) !== 'history');
  const currentPendingFolders = pending || (activeCurrent ? 1 : 0);
  const rootReadAt = probe.state_json ? JSON.parse(probe.state_json).rootListingAt : null;
  const fresh = probe.status === 'OK' && dayOf(rootReadAt) === dayOf(now);
  const sweptAt = state.currentSweepAt;
  const sweptTime = Date.parse(sweptAt || 'invalid');
  const recentSweep = Number.isFinite(sweptTime) && sweptTime <= +now && +now-sweptTime <= 7*day;
  const verified = fresh && recentSweep && !state.currentReadUnknown && !error && !unacknowledged;
  const complete = !currentPendingFolders && (full.status === 'OK' || history.length > 0);
  return { currentStatus: !verified ? 'UNVERIFIED' : complete ? 'CURRENT' : 'PENDING',
    historyPendingFolders: history.length, currentPendingFolders,
    currentVerifiedAt: verified && complete ? sweptAt : null };
}

// Reorder only unconsumed work. An active file/page keeps its exact cursor.
export function prioritizePadronWork(state, now) {
  const year = Number(new Intl.DateTimeFormat('en', {timeZone:'America/Argentina/Tucuman',year:'numeric'}).format(new Date(now)));
  const rank = entry => {
    const names = entry.name ? [entry.name] : (entry.ancestors || []).map(folder => folder.name).reverse();
    for (const name of names) {
      const facts = padronTitleFacts(name);
      if (facts.year === year) return facts.type === 'Definitivo' ? 0 : 1;
      if (facts.year !== null && facts.year < year) return 4;
      if (facts.type === 'Definitivo') return 2;
    }
    return 3;
  };
  const sorted = entries => entries.sort((a,b) => rank(a)-rank(b));
  // Park an archive page intact when newly discovered current work arrives.
  // Restore its exact prefix/token later instead of finishing history first.
  if (state.page && padronWorkScope(state.queue[0] || {},now)==='history' &&
      state.queue.slice(1).some(entry=>padronWorkScope(entry,now)!=='history')) {
    state.queue[0].suspendedPage=state.page;state.page=null;
  }
  if (!state.page) {
    state.queue = sorted(state.queue);
    if(state.queue[0]?.suspendedPage){state.page=state.queue[0].suspendedPage;delete state.queue[0].suspendedPage;}
  }
  if (state.page) {
    const offset = state.page.index + (state.page.itemIndex > 0 ? 1 : 0);
    state.page.files = [...state.page.files.slice(0,offset), ...sorted(state.page.files.slice(offset))];
  }
  return state;
}
export const folderSignature = folder => digest(JSON.stringify([folder.name, folder.modifiedTime || null, folder.resourceKey || ""]));
const initial = (source, cycle = 1, lastDocHash = null) => {
  const url = new URL(source[3]);
  return { version: 1, cycle, queue: url.hostname === "drive.google.com"
    ? [{ id: url.pathname.split("/").at(-1), keys: url.searchParams.get("resourcekey")
      ? [{ id: url.pathname.split("/").at(-1), key: url.searchParams.get("resourcekey") }] : [], token: null, seenTokens: [] }]
    : [], visited: [], page: null, docIndex: 0, docProcessingHash: null, lastDocHash, noticeParserVersion: 2 };
};
const decode = (value) => {
  const state = JSON.parse(value);
  const validPage = page => !page || Array.isArray(page.files) && page.files.length <= 25 &&
    Number.isSafeInteger(page.index) && page.index>=0 && page.index<=page.files.length && Number.isSafeInteger(page.itemIndex) && page.itemIndex>=0;
  if (state?.version !== 1 || !Array.isArray(state.queue) || !Array.isArray(state.visited) ||
      !Number.isSafeInteger(state.cycle) || state.cycle < 1 ||
      !Number.isSafeInteger(state.docIndex) || state.docIndex < 0 ||
      !validPage(state.page) || state.queue.some(entry=>!validPage(entry.suspendedPage)))
    throw new Error("JUNTAS_CHECKPOINT_INVALID");
  return state;
};
const sourceError = (error) => error instanceof Error &&
  /^JUNTAS_(?:HTTP_\d+|DRIVE_(?:HTTP_\d+|PAGE_INVALID|JSON_INVALID|PAGE_TOKEN_EXPIRED|KEY_REQUIRED)|SOURCE_(?:TIMEOUT|NETWORK)|REQUEST_BUDGET_EXHAUSTED|DOCUMENT_FORMAT_INVALID|NOTICE_(?:FORMAT_UNRECOGNIZED|PRIOR_LIMIT|LEGACY_AMBIGUOUS)|ITEM_TOO_LARGE|CHECKPOINT_TOO_LARGE)$/.test(error.message);

async function claim(db, source, owner, now, exists) {
  const [rootId, category] = source;
  if (!exists) await db.prepare(`INSERT OR IGNORE INTO juntas_import_checkpoint
    (root_id,category,state_json,status) VALUES(?, ?, ?, 'PARTIAL')`)
    .bind(rootId, category, JSON.stringify(initial(source))).run();
  const until = new Date(Date.parse(now) + 120_000).toISOString();
  const result = await db.prepare(`UPDATE juntas_import_checkpoint
    SET lease_owner=?,lease_until=?,last_attempt_at=?
    WHERE root_id=? AND (lease_until IS NULL OR lease_until<=?)`)
    .bind(owner, until, now, rootId, now).run();
  if (changes(result) !== 1) return null;
  return db.prepare("SELECT state_json,status,last_success_at FROM juntas_import_checkpoint WHERE root_id=?")
    .bind(rootId).first();
}
async function save(db, rootId, owner, state, now, complete = false, clock = now) {
  const serialized = JSON.stringify(state);
  const args = [serialized, complete ? "OK" : "PARTIAL", complete ? 1 : 0, now, rootId, owner, clock];
  if (Buffer.byteLength(JSON.stringify({ op: "save", args }), "utf8") > 100_000) throw new Error("JUNTAS_CHECKPOINT_TOO_LARGE");
  const result = await db.prepare(`UPDATE juntas_import_checkpoint
    SET state_json=?,status=?,error_code=NULL,last_success_at=CASE WHEN ? THEN ? ELSE last_success_at END
    WHERE root_id=? AND lease_owner=? AND lease_until>?`)
    .bind(...args).run();
  if (changes(result) !== 1) throw new Error("JUNTAS_CHECKPOINT_LEASE_LOST");
}
async function release(db, rootId, owner) {
  await db.prepare("UPDATE juntas_import_checkpoint SET lease_owner=NULL,lease_until=NULL WHERE root_id=? AND lease_owner=?")
    .bind(rootId, owner).run();
}
async function markPartial(db, rootId, owner, code) {
  await db.prepare("UPDATE juntas_import_checkpoint SET status='PARTIAL',error_code=? WHERE root_id=? AND lease_owner=?")
    .bind(code, rootId, owner).run();
}

function driveReference(source, file, ancestors = []) {
  const [rootId, category, junta] = source;
  const url = new URL(driveEntryUrl({ id: file.id, mimeType: file.mimeType }));
  if (file.resourceKey) url.searchParams.set("resourcekey", file.resourceKey);
  const title = file.name;
  const result = classifyDriveReference({
    id: `drive:${rootId}:${file.id}`, source: "Padrones y Comunicados", externalId: file.id,
    kind: "junta", category, junta, title,
    summary: "Documento público de Junta; consultar la fuente para verificar su vigencia.",
    level: "", area: "", location: "", shift: "", character: "", startsAt: null, endsAt: null,
    status: "Documento público · vigencia no informada", officialUrl: url.toString(),
    metadata: "{}", contentHash: "", sourceUpdatedAt: file.modifiedTime || null,
  }, file.mimeType, ancestors);
  const official = officialMetadata(result);
  official.sourceRootId = `padrones:${rootId}`;
  if(file.md5Checksum)official.facts.documentChecksum={value:file.md5Checksum,precision:'text',status:'reported',evidence:[{id:result.id,source:'Junta',url:result.officialUrl,excerpt:'MD5 informado por Google Drive para esta revisión del archivo.'}]};
  result.metadata = withOfficial(result.metadata, official);
  return result;
}
function rootReference(source, raw) {
  const [rootId, category, junta, officialUrl] = source;
  return documentReference({ id: `padrones:${rootId}`, source: "Padrones y Comunicados",
    externalId: rootId, kind: "junta", category, junta, title: `${category} · ${junta}`,
    summary: plainDocumentText(raw, 1800), level: "", area: "", location: "", shift: "", character: "",
    startsAt: null, endsAt: null, status: "Documento público · vigencia no informada",
    officialUrl, metadata: "{}", contentHash: "", sourceUpdatedAt: null });
}
async function documentText(id, sourceFetch, budget, timeoutMs) {
  if (budget.requests <= 0) return null;
  budget.requests--; budget.usedRequests++;
  let response;
  try { response = await sourceFetch(`https://docs.google.com/document/d/${id}/export?format=txt`,
    { signal: AbortSignal.timeout(timeoutMs) }); }
  catch (error) { if(error?.message==='JUNTAS_REQUEST_BUDGET_EXHAUSTED')throw error;
    throw new Error(error?.name === "TimeoutError" ? "JUNTAS_SOURCE_TIMEOUT" : "JUNTAS_SOURCE_NETWORK"); }
  if (!response.ok) throw new Error(`JUNTAS_HTTP_${response.status}`);
  let text;
  try { text = await response.text(); }
  catch (error) { throw new Error(error?.name === "TimeoutError" ? "JUNTAS_SOURCE_TIMEOUT" : "JUNTAS_SOURCE_NETWORK"); }
  if (Buffer.byteLength(text, "utf8") > 2_000_000) throw new Error("JUNTAS_DOCUMENT_FORMAT_INVALID");
  return text;
}
async function applyItems(items, offset, limit, receiver, metrics, now) {
  let index = offset;
  while (index < items.length && limit.remaining > 0) {
    const row = await prepareJuntaImport(items[index], now);
    const payload = { mode: "batch", items: [row] };
    if (Buffer.byteLength(JSON.stringify(payload), "utf8") > 100_000 || row.summary.length > 8000 || row.metadata.length > 16000)
      throw new Error("JUNTAS_ITEM_TOO_LARGE");
    const response = await receiver.receiverFetch(receiver.endpoint("/api/internal/public-source-import/juntas"),
      { method: "POST", headers: { Authorization: `Bearer ${receiver.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`JUNTAS_RECEIVER_HTTP_${response.status}`);
    const ack = await response.json();
    if (ack.ok !== true || ack.received !== 1 || ack.created + ack.updated + ack.unchanged !== 1)
      throw new Error("JUNTAS_RECEIVER_ACK_INVALID");
    metrics.created += ack.created; metrics.updated += ack.updated; metrics.unchanged += ack.unchanged;
    metrics.rowsRead += ack.rowsRead; metrics.rowsWritten += ack.rowsWritten; metrics.queries += ack.queries;
    index++; limit.remaining--;
  }
  return index;
}
async function advanceDocument(db, source, state, budget, limit, receiver, metrics, sourceFetch, now, timeoutMs, prioritizeRecentNotices = false) {
  if (state.noticeParserVersion !== 2) {
    state.docIndex = 0; state.docProcessingHash = null; state.lastDocHash = null;
    state.noticeParserVersion = 2;
  }
  const orderVersion = prioritizeRecentNotices ? 1 : 0;
  if ((state.noticeOrderVersion || 0) !== orderVersion) {
    state.docIndex = 0; state.docProcessingHash = null; state.lastDocHash = null;
    state.noticeOrderVersion = orderVersion;
  }
  const documentId = new URL(source[3]).pathname.split("/d/")[1]?.split("/")[0];
  if (!documentId) throw new Error("JUNTAS_CHECKPOINT_INVALID");
  const raw = await documentText(documentId, sourceFetch, budget, timeoutMs);
  if (raw === null) return { state, complete: false, progressed: false };
  const hash = digest(raw);
  if (hash === state.lastDocHash && !state.docProcessingHash) return { state, complete: true, progressed: true };
  if (state.docProcessingHash !== hash) { state.docIndex = 0; state.docProcessingHash = hash; }
  const root = rootReference(source, raw);
  const prior = (await db.prepare("SELECT id,CASE WHEN json_valid(metadata) THEN json_extract(metadata,'$.official.noticeKey') END AS notice_key,CASE WHEN json_valid(metadata) AND json_extract(metadata,'$.official.bodyHash') IS NOT NULL THEN '' ELSE summary END AS summary,source_published_at FROM publications WHERE source='Padrones y Comunicados' AND id LIKE 'notice:' || ? || ':%' ORDER BY source_published_at DESC,id LIMIT 1000")
    .bind(source[0]).all()).results.map(row => ({ ...row, noticeKey: row.notice_key, sourcePublishedAt: row.source_published_at }));
  if (prior.length === 1000) throw new Error("JUNTAS_NOTICE_PRIOR_LIMIT");
  let notices;
  try { notices = extractJuntaNotices(root, raw, prior); }
  catch (error) { if (error?.message === "JUNTAS_NOTICE_LEGACY_AMBIGUOUS") throw error; throw new Error("JUNTAS_DOCUMENT_FORMAT_INVALID"); }
  if (!notices.length) throw new Error("JUNTAS_NOTICE_FORMAT_UNRECOGNIZED");
  // The three Superior child documents are linked by the public index. Their
  // first publication slot should expose a notice, not another index card.
  const ordered = prioritizeRecentNotices ? [...notices].sort((a, b) => (b.sourcePublishedAt || '').localeCompare(a.sourcePublishedAt || '')) : notices;
  const items = source[0].startsWith("com-superior-") ? ordered : prioritizeRecentNotices ? [...ordered, root] : [root, ...ordered];
  state.docIndex = await applyItems(items, state.docIndex, limit, receiver, metrics, now);
  if (state.docIndex < items.length) return { state, complete: false, progressed: true };
  state.lastDocHash = hash; state.docProcessingHash = null; state.docIndex = 0;
  return { state, complete: true, progressed: true };
}
async function advanceFolder(db, source, state, budget, limit, receiver, metrics, sourceFetch, driveKey, now, filesOnly = false, rootOnly = false, timeoutMs = 20_000, prioritizePadrones = false) {
  if (prioritizePadrones && source[1] === 'Padrones') prioritizePadronWork(state, now);
  const current = state.queue[0];
  if (!current) return { state, complete: true, progressed: false };
  if (!state.page) {
    if (budget.requests <= 0) return { state, complete: false, progressed: false };
    if (!driveKey) throw new Error("JUNTAS_DRIVE_KEY_REQUIRED");
    budget.requests--; budget.usedRequests++;
    let page;
    try { page = await listDrivePage(current.id, driveKey, current.keys,
      filesOnly ? "" : current.token || "", sourceFetch, filesOnly); }
    catch (error) {
      if (error?.message !== "JUNTAS_DRIVE_PAGE_TOKEN_EXPIRED") throw error;
      current.token = null; current.seenTokens = [];
      return { state, complete: false, progressed: true };
    }
    if (page.nextPageToken && current.seenTokens.includes(page.nextPageToken)) throw new Error("JUNTAS_DRIVE_PAGE_INVALID");
    if (rootOnly) {
      state.rootListingAt = !state.rootListingAt || now < state.rootListingAt ? now : state.rootListingAt;
      state.knownFolders ||= {};
      state.folderUpdates ||= {};
      for (const folder of page.files.filter(file => file.mimeType === folderMime)) {
        const signature = folderSignature(folder);
        if (state.knownFolders[folder.id] !== signature) { metrics.structureChanged = true; state.folderUpdates[folder.id] = folder; }
        state.knownFolders[folder.id] = signature;
      }
    }
    state.page = { files: page.files, nextToken: page.nextPageToken || null, index: 0, itemIndex: 0, filesOnly, fetchedAt: now };
  }
  const page = state.page;
  if (!rootOnly && padronWorkScope(current,now)!=='history') {
    if (!page.fetchedAt) state.currentReadUnknown=true;
    else if (!state.currentReadAt || page.fetchedAt<state.currentReadAt) state.currentReadAt=page.fetchedAt;
  }
  if (prioritizePadrones && source[1] === 'Padrones') prioritizePadronWork(state, now);
  if (rootOnly) metrics.changedFolders = Object.values(state.folderUpdates || {});
  const candidates = page.files.filter((file) => rootOnly || file.mimeType !== folderMime);
  // Revision 4 invalidates cached classifications (e.g. maestros especiales).
  const signatures = candidates.map((file) => [file.id, file.modifiedTime ? digest(JSON.stringify([4, file.name, file.mimeType, file.modifiedTime, file.resourceKey || "", current.ancestors || [],file.md5Checksum||null])) : null]);
  const known = new Map();
  if (candidates.length) {
    const rows = await db.prepare(`SELECT file_id,signature FROM juntas_import_applied WHERE root_id=? AND file_id IN (${candidates.map(() => "?").join(",")})`)
      .bind(source[0], ...candidates.map((file) => file.id)).all();
    for (const row of rows.results) known.set(row.file_id, row.signature);
  }
  while (page.index < page.files.length) {
    const file = page.files[page.index];
    if (file.mimeType === folderMime && !rootOnly) { page.index++; continue; }
    metrics.filesExamined++;
    const signature = signatures[candidates.findIndex((item) => item.id === file.id)]?.[1];
    if (signature && known.get(file.id) === signature && page.itemIndex === 0) {
      metrics.skippedUnchanged++; page.index++; continue;
    }
    if (limit.remaining <= 0) break;
    const ref = driveReference(source, file, current.ancestors || []);
    let items = [ref];
    // Padrones are documents, not collections of news. Preserve an old partial
    // document's item cursor, but never parse a new teacher roster as notices.
    if (file.mimeType === docMime && (source[1] !== 'Padrones' || page.itemIndex > 0)) {
      const raw = await documentText(file.id, sourceFetch, budget, timeoutMs);
      if (raw === null) break;
      const processingHash = digest(raw);
      if (page.processingHash && page.processingHash !== processingHash) page.itemIndex = 0;
      page.processingHash = processingHash;
      try { items = [ref, ...extractJuntaNotices(ref, raw)]; }
      catch { throw new Error("JUNTAS_DOCUMENT_FORMAT_INVALID"); }
    }
    page.itemIndex = await applyItems(items, page.itemIndex, limit, receiver, metrics, now);
    if (page.itemIndex < items.length) break;
    if (signature) await db.prepare(`INSERT INTO juntas_import_applied(root_id,file_id,signature) VALUES(?,?,?)
      ON CONFLICT(root_id,file_id) DO UPDATE SET signature=excluded.signature WHERE signature<>excluded.signature`)
      .bind(source[0], file.id, signature).run();
    page.index++; page.itemIndex = 0; page.processingHash = null;
  }
  if (page.index < page.files.length) return { state, complete: false, progressed: true };
  if (page.filesOnly) {
    // A filtered probe never proves the folder's subfolders were traversed.
    state.page = null;
    return { state, complete: false, progressed: true };
  }
  for (const folder of rootOnly ? [] : page.files.filter((file) => file.mimeType === folderMime)) {
    if (!(current.refresh ? state.refreshVisited || [] : state.visited).includes(folder.id) && !state.queue.some((entry) => entry.id === folder.id))
      state.queue.push({ id: folder.id, refresh: Boolean(current.refresh), ancestors: [...(current.ancestors || []), { id: folder.id, name: folder.name,
        url: driveEntryUrl({ id: folder.id, mimeType: folderMime }) + (folder.resourceKey ? `?resourcekey=${encodeURIComponent(folder.resourceKey)}` : "") }], keys: [...current.keys,
        ...(folder.resourceKey ? [{ id: folder.id, key: folder.resourceKey }] : [])], token: null, seenTokens: [] });
  }
  if (page.nextToken) {
    current.seenTokens.push(page.nextToken);
    current.token = page.nextToken;
  } else {
    state.visited.push(current.id);
    if (current.refresh) { state.refreshVisited ||= []; state.refreshVisited.push(current.id); }
    state.queue.shift();
  }
  state.page = null;
  if (!rootOnly && padronWorkScope(current,now)!=='history' && !state.queue.some(entry=>padronWorkScope(entry,now)!=='history'))
    state.currentSweepAt=state.currentReadUnknown?null:state.currentReadAt;
  return { state, complete: state.queue.length === 0, progressed: true };
}

export async function runJuntasCheckpoint({ db, driveKey, sourceFetch = fetch, sources = JUNTA_EXTERNAL_SOURCES,
  now = new Date(), maxRequests = 25, maxPublicationWrites = 20, maxSteps = 100, refreshAfterMs = day,
  focusFolderId = null, focusFilesOnly = false, receiverOverride = null, rootOnly = false, folderUpdates = [], clock = () => now,
  documentTimeoutMs = 20_000, prioritizePadrones = false, prioritizeRecentNotices = false, refreshCurrentFolders = false }) {
  if (!db || !Array.isArray(sources) || !sources.length || !Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 100 ||
      !Number.isInteger(maxPublicationWrites) || maxPublicationWrites < 1 || maxPublicationWrites > 50 ||
      !Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 200 || refreshAfterMs < 0 ||
      !Number.isInteger(documentTimeoutMs) || documentTimeoutMs < 1000 || documentTimeoutMs > 45_000 ||
      (focusFolderId !== null && (sources.length !== 1 || !/^[A-Za-z0-9_-]{10,}$/.test(focusFolderId))) ||
      (focusFilesOnly && !focusFolderId) || rootOnly && sources.some(source => source[1] !== "Padrones" || !source[3].includes("drive.google.com/drive/folders/")))
    throw new Error("JUNTAS_BUDGET_INVALID");
  const instant = now.toISOString(), budget = { requests: maxRequests, usedRequests: 0 };
  const limit = { remaining: maxPublicationWrites };
  const before = db.metrics?.();
  const metrics = { sourceRequests: 0, filesExamined: 0, created: 0, updated: 0, unchanged: 0, skippedUnchanged: 0,
    queries: 0, rowsRead: 0, rowsWritten: 0, failures: [], structureChanged: false, changedFolders: [] };
  const transport = receiverOverride || createDirectD1ReceiverFetch(db);
  let leaseUntil = 0;
  const receiver = { ...transport, receiverFetch: (input, init) => {
    if (clock().getTime() + 20_000 >= leaseUntil) throw new Error("JUNTAS_CHECKPOINT_LEASE_LOST");
    return transport.receiverFetch(input, init);
  } };
  const finished = new Set();
  for (let step = 0; step < maxSteps && budget.requests > 0 && limit.remaining > 0; step++) {
    if (finished.size === sources.length) break;
    const source = sources[step % sources.length];
    const category = source[1], rootId = rootOnly ? `probe:${source[0]}` : source[0];
    if (finished.has(rootId)) continue;
    const previous = await db.prepare("SELECT status,last_success_at FROM juntas_import_checkpoint WHERE root_id=?").bind(rootId).first();
    let changedFolders = folderUpdates || [];
    if (!rootOnly && changedFolders.length && previous) {
      const stored = await db.prepare("SELECT state_json,status,last_success_at FROM juntas_import_checkpoint WHERE root_id=?").bind(rootId).first();
      const known = decode(stored.state_json).folderVersions || {};
      changedFolders = changedFolders.filter(folder => known[folder.id] !== folderSignature(folder) || refreshCurrentFolders && padronWorkScope(folder,now)!=='history');
    }
    if (previous?.status === "OK" && !changedFolders.length && Date.parse(previous.last_success_at || "") + refreshAfterMs > now.getTime()) {
      if (rootOnly) {
        const stored = await db.prepare("SELECT state_json,status,last_success_at FROM juntas_import_checkpoint WHERE root_id=?").bind(rootId).first();
        metrics.changedFolders = Object.values(decode(stored.state_json).folderUpdates || {});
      }
      finished.add(rootId); continue;
    }
    const checkpointSource = [rootId, ...source.slice(1)];
    const leaseInstant = clock().toISOString();
    const owner = randomUUID(), claimed = await claim(db, checkpointSource, owner, leaseInstant, Boolean(previous));
    if (!claimed) { finished.add(rootId); continue; }
    leaseUntil = Date.parse(leaseInstant) + 120_000;
    try {
      let state = decode(claimed.state_json);
      if (claimed.status === "OK") {
        state = { ...initial(source, state.cycle + 1, state.noticeParserVersion === 2 ? state.lastDocHash : null), folderVersions: state.folderVersions || {},
          ...(source[1] === 'Comunicados' ? { noticeOrderVersion: state.noticeOrderVersion || 0 } : {}),
          ...(rootOnly ? { knownFolders: state.knownFolders || {}, folderUpdates: state.folderUpdates || {} } : {}) };
        await save(db, rootId, owner, state, instant, false, clock().toISOString());
      }
      if (!rootOnly && changedFolders.length) {
        const rootEntry = initial(source).queue[0];
        state.folderVersions ||= {};
        state.refreshVisited = [];
        state.currentSweepAt=null;
        state.currentReadAt=null;state.currentReadUnknown=false;
        for (const folder of changedFolders) {
          const ancestor = { id: folder.id, name: folder.name, url: driveEntryUrl({ id: folder.id, mimeType: folderMime }) +
            (folder.resourceKey ? `?resourcekey=${encodeURIComponent(folder.resourceKey)}` : "") };
          state.folderVersions[folder.id] = folderSignature(folder);
          for (const entry of state.queue) {
            if ((entry.ancestors || []).some(old => old.id === folder.id)) {
              entry.ancestors = entry.ancestors.map(old => old.id === folder.id ? ancestor : old);
              entry.keys = [...entry.keys.filter(key => key.id !== folder.id), ...(folder.resourceKey ? [{ id: folder.id, key: folder.resourceKey }] : [])];
              entry.refresh = true; entry.token = null; entry.seenTokens = [];
              delete entry.suspendedPage;
              if (entry === state.queue[0]) state.page = null;
            }
          }
          if (!state.queue.some(entry => entry.id === folder.id)) {
            state.visited = state.visited.filter(id => id !== folder.id);
            state.queue.splice(1, 0, { id: folder.id, refresh: true, ancestors: [ancestor], keys: [...rootEntry.keys,
              ...(folder.resourceKey ? [{ id: folder.id, key: folder.resourceKey }] : [])], token: null, seenTokens: [] });
          }
        }
        await save(db, rootId, owner, state, instant, false, clock().toISOString());
      }
      if (focusFolderId && state.queue[0]?.id !== focusFolderId) {
        if (state.page) throw new Error("JUNTAS_FOCUS_PAGE_IN_PROGRESS");
        const index = state.queue.findIndex((entry) => entry.id === focusFolderId);
        if (index < 0) throw new Error("JUNTAS_FOCUS_NOT_PENDING");
        state.queue.unshift(...state.queue.splice(index, 1));
        await save(db, rootId, owner, state, instant, false, clock().toISOString());
      }
      const output = source[3].includes("docs.google.com/document/")
        ? await advanceDocument(db, source, state, budget, limit, receiver, metrics, sourceFetch, now, documentTimeoutMs, prioritizeRecentNotices)
        : await advanceFolder(db, source, state, budget, limit, receiver, metrics, sourceFetch, driveKey, instant, focusFilesOnly, rootOnly, documentTimeoutMs, prioritizePadrones && !focusFolderId);
      if (output.progressed) await save(db, rootId, owner, output.state, instant, output.complete, clock().toISOString());
      if (output.complete || !output.progressed) finished.add(rootId);
    } catch (error) {
      if (!sourceError(error)) throw error;
      await markPartial(db, rootId, owner, error.message);
      metrics.failures.push({ rootId, category, code: error.message });
      finished.add(rootId);
    } finally { await release(db, rootId, owner); }
  }
  metrics.sourceRequests = budget.usedRequests;
  const health = (await db.prepare("SELECT root_id,category,status,last_success_at,error_code FROM juntas_import_checkpoint ORDER BY root_id").bind().all()).results;
  const expectedSources = sources.every(([id]) => JUNTA_EXTERNAL_SOURCES.some(([officialId]) => officialId === id))
    ? JUNTA_EXTERNAL_SOURCES : sources;
  const categoryHealth = [...new Set(sources.map((source) => source[1]))].map((category) => {
    const expected = expectedSources.filter((source) => source[1] === category).length;
    const roots = health.filter((row) => row.category === category && expectedSources.some((source) => source[0] === row.root_id));
    const complete = roots.length === expected && roots.every((row) => row.status === "OK");
    const everComplete = roots.length === expected && roots.every((row) => row.last_success_at);
    return { category, status: complete ? "OK" : "PARTIAL",
      lastCompleteAt: everComplete ? roots.map((row) => row.last_success_at).sort()[0] : null,
      failures: roots.filter((row) => row.error_code).map((row) => ({ rootId: row.root_id, code: row.error_code })) };
  });
  const existingHealth = (await db.prepare("SELECT source,sync_status,last_successful_sync_at,error_code FROM sync_state WHERE source IN ('Padrones','Comunicados','Llamados abiertos')").bind().all()).results;
  for (const item of categoryHealth) {
    const old = existingHealth.find((row) => row.source === item.category);
    const errorCode = item.failures.length ? "JUNTAS_PARTIAL_SOURCE" : null;
    const successAt = item.status === "OK" ? item.lastCompleteAt : old?.last_successful_sync_at || null;
    if (old?.sync_status === item.status && (old?.last_successful_sync_at || null) === successAt &&
        (old?.error_code || null) === errorCode) continue;
    await db.prepare(`INSERT INTO sync_state(source,synced_at,item_count,last_attempt_at,last_successful_sync_at,sync_status,error_code)
      VALUES(?,'',0,?,?,?,?) ON CONFLICT(source) DO UPDATE SET
      last_attempt_at=excluded.last_attempt_at,last_successful_sync_at=excluded.last_successful_sync_at,
      sync_status=excluded.sync_status,error_code=excluded.error_code`)
      .bind(item.category, instant, successAt, item.status, errorCode).run();
  }
  const after = db.metrics?.();
  const d1 = before && after ? { queries: after.queries - before.queries,
    rowsRead: after.rowsRead - before.rowsRead, rowsWritten: after.rowsWritten - before.rowsWritten } : null;
  return { ...metrics, d1, health, categoryHealth, completed: !rootOnly && categoryHealth.every((item) => item.status === "OK"),
    ...(rootOnly ? { rootProbeComplete: sources.every(source => health.some(row => row.root_id === `probe:${source[0]}` && row.status === "OK")) } : {}),
    publicationAttempts: maxPublicationWrites - limit.remaining };
}
