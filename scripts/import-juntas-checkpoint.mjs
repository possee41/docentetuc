// Opt-in Node runner. Never invoked by the legacy collector or a scheduled workflow.
import { createHash, randomUUID } from "node:crypto";
import { listDrivePage } from "../lib/junta-external.ts";
import { JUNTA_EXTERNAL_SOURCES } from "../lib/junta-external-sources.ts";
import { classifyDriveReference, documentReference, extractJuntaNotices } from "../lib/junta-notices.ts";
import { driveEntryUrl, plainDocumentText } from "../lib/public-documents.ts";
import { prepareJuntaImport } from "../lib/public-source-import.ts";
import { createDirectD1ReceiverFetch } from "./direct-d1-receiver.mjs";

const folderMime = "application/vnd.google-apps.folder";
const docMime = "application/vnd.google-apps.document";
const day = 24 * 60 * 60 * 1000;
const changes = (result) => Number(result?.meta?.changes ?? result?.meta?.rows_written ?? 0);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const initial = (source, cycle = 1, lastDocHash = null) => {
  const url = new URL(source[3]);
  return { version: 1, cycle, queue: url.hostname === "drive.google.com"
    ? [{ id: url.pathname.split("/").at(-1), keys: url.searchParams.get("resourcekey")
      ? [{ id: url.pathname.split("/").at(-1), key: url.searchParams.get("resourcekey") }] : [], token: null, seenTokens: [] }]
    : [], visited: [], page: null, docIndex: 0, docProcessingHash: null, lastDocHash };
};
const decode = (value) => {
  const state = JSON.parse(value);
  if (state?.version !== 1 || !Array.isArray(state.queue) || !Array.isArray(state.visited) ||
      !Number.isSafeInteger(state.cycle) || state.cycle < 1 ||
      !Number.isSafeInteger(state.docIndex) || state.docIndex < 0 ||
      state.page && (!Array.isArray(state.page.files) || state.page.files.length > 25 ||
        !Number.isSafeInteger(state.page.index) || !Number.isSafeInteger(state.page.itemIndex)))
    throw new Error("JUNTAS_CHECKPOINT_INVALID");
  return state;
};
const sourceError = (error) => error instanceof Error &&
  /^JUNTAS_(?:HTTP_\d+|DRIVE_(?:HTTP_\d+|PAGE_INVALID|JSON_INVALID|PAGE_TOKEN_EXPIRED|KEY_REQUIRED)|SOURCE_(?:TIMEOUT|NETWORK)|DOCUMENT_FORMAT_INVALID|NOTICE_FORMAT_UNRECOGNIZED|ITEM_TOO_LARGE)$/.test(error.message);

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
async function save(db, rootId, owner, state, now, complete = false) {
  const result = await db.prepare(`UPDATE juntas_import_checkpoint
    SET state_json=?,status=?,error_code=NULL,last_success_at=CASE WHEN ? THEN ? ELSE last_success_at END
    WHERE root_id=? AND lease_owner=? AND lease_until>?`)
    .bind(JSON.stringify(state), complete ? "OK" : "PARTIAL", complete ? 1 : 0, now, rootId, owner, now).run();
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

function driveReference(source, file) {
  const [rootId, category, junta] = source;
  const url = new URL(driveEntryUrl({ id: file.id, mimeType: file.mimeType }));
  if (file.resourceKey) url.searchParams.set("resourcekey", file.resourceKey);
  const title = file.name;
  return classifyDriveReference({
    id: `drive:${rootId}:${file.id}`, source: "Padrones y Comunicados", externalId: file.id,
    kind: "junta", category, junta, title,
    summary: "Documento público de Junta; consultar la fuente para verificar su vigencia.",
    level: "", area: "", location: "", shift: "", character: "", startsAt: null, endsAt: null,
    status: "Documento público · vigencia no informada", officialUrl: url.toString(),
    metadata: "{}", contentHash: "", sourceUpdatedAt: file.modifiedTime || null,
  }, file.mimeType);
}
function rootReference(source, raw) {
  const [rootId, category, junta, officialUrl] = source;
  return documentReference({ id: `padrones:${rootId}`, source: "Padrones y Comunicados",
    externalId: rootId, kind: "junta", category, junta, title: `${category} · ${junta}`,
    summary: plainDocumentText(raw, 1800), level: "", area: "", location: "", shift: "", character: "",
    startsAt: null, endsAt: null, status: "Documento público · vigencia no informada",
    officialUrl, metadata: "{}", contentHash: "", sourceUpdatedAt: null });
}
async function documentText(id, sourceFetch, budget) {
  if (budget.requests <= 0) return null;
  budget.requests--; budget.usedRequests++;
  let response;
  try { response = await sourceFetch(`https://docs.google.com/document/d/${id}/export?format=txt`,
    { signal: AbortSignal.timeout(20_000) }); }
  catch (error) { throw new Error(error?.name === "TimeoutError" ? "JUNTAS_SOURCE_TIMEOUT" : "JUNTAS_SOURCE_NETWORK"); }
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
        body: JSON.stringify(payload) });
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
async function advanceDocument(db, source, state, budget, limit, receiver, metrics, sourceFetch, now) {
  const documentId = new URL(source[3]).pathname.split("/d/")[1]?.split("/")[0];
  if (!documentId) throw new Error("JUNTAS_CHECKPOINT_INVALID");
  const raw = await documentText(documentId, sourceFetch, budget);
  if (raw === null) return { state, complete: false, progressed: false };
  const hash = digest(raw);
  if (hash === state.lastDocHash && !state.docProcessingHash) return { state, complete: true, progressed: true };
  if (state.docProcessingHash !== hash) { state.docIndex = 0; state.docProcessingHash = hash; }
  const root = rootReference(source, raw);
  let notices;
  try { notices = extractJuntaNotices(root, raw); }
  catch { throw new Error("JUNTAS_DOCUMENT_FORMAT_INVALID"); }
  if (!notices.length) throw new Error("JUNTAS_NOTICE_FORMAT_UNRECOGNIZED");
  const items = [root, ...notices];
  state.docIndex = await applyItems(items, state.docIndex, limit, receiver, metrics, now);
  if (state.docIndex < items.length) return { state, complete: false, progressed: true };
  state.lastDocHash = hash; state.docProcessingHash = null; state.docIndex = 0;
  return { state, complete: true, progressed: true };
}
async function advanceFolder(db, source, state, budget, limit, receiver, metrics, sourceFetch, driveKey, now) {
  const current = state.queue[0];
  if (!current) return { state, complete: true, progressed: false };
  if (!state.page) {
    if (budget.requests <= 0) return { state, complete: false, progressed: false };
    if (!driveKey) throw new Error("JUNTAS_DRIVE_KEY_REQUIRED");
    budget.requests--; budget.usedRequests++;
    let page;
    try { page = await listDrivePage(current.id, driveKey, current.keys, current.token || "", sourceFetch); }
    catch (error) {
      if (error?.message !== "JUNTAS_DRIVE_PAGE_TOKEN_EXPIRED") throw error;
      current.token = null; current.seenTokens = [];
      return { state, complete: false, progressed: true };
    }
    if (page.nextPageToken && current.seenTokens.includes(page.nextPageToken)) throw new Error("JUNTAS_DRIVE_PAGE_INVALID");
    state.page = { files: page.files, nextToken: page.nextPageToken || null, index: 0, itemIndex: 0 };
  }
  const page = state.page;
  const candidates = page.files.filter((file) => file.mimeType !== folderMime);
  const signatures = candidates.map((file) => [file.id, file.modifiedTime ? digest(JSON.stringify([file.name, file.mimeType, file.modifiedTime, file.resourceKey || ""])) : null]);
  const known = new Map();
  if (candidates.length) {
    const rows = await db.prepare(`SELECT file_id,signature FROM juntas_import_applied WHERE root_id=? AND file_id IN (${candidates.map(() => "?").join(",")})`)
      .bind(source[0], ...candidates.map((file) => file.id)).all();
    for (const row of rows.results) known.set(row.file_id, row.signature);
  }
  while (page.index < page.files.length) {
    const file = page.files[page.index];
    if (file.mimeType === folderMime) { page.index++; continue; }
    const signature = signatures[candidates.findIndex((item) => item.id === file.id)]?.[1];
    if (signature && known.get(file.id) === signature && page.itemIndex === 0) {
      metrics.skippedUnchanged++; page.index++; continue;
    }
    if (limit.remaining <= 0) break;
    const ref = driveReference(source, file);
    let items = [ref];
    if (file.mimeType === docMime) {
      const raw = await documentText(file.id, sourceFetch, budget);
      if (raw === null) break;
      try { items = [ref, ...extractJuntaNotices(ref, raw)]; }
      catch { throw new Error("JUNTAS_DOCUMENT_FORMAT_INVALID"); }
    }
    page.itemIndex = await applyItems(items, page.itemIndex, limit, receiver, metrics, now);
    if (page.itemIndex < items.length) break;
    if (signature) await db.prepare(`INSERT INTO juntas_import_applied(root_id,file_id,signature) VALUES(?,?,?)
      ON CONFLICT(root_id,file_id) DO UPDATE SET signature=excluded.signature WHERE signature<>excluded.signature`)
      .bind(source[0], file.id, signature).run();
    page.index++; page.itemIndex = 0;
  }
  if (page.index < page.files.length) return { state, complete: false, progressed: true };
  for (const folder of page.files.filter((file) => file.mimeType === folderMime)) {
    if (!state.visited.includes(folder.id) && !state.queue.some((entry) => entry.id === folder.id))
      state.queue.push({ id: folder.id, keys: [...current.keys,
        ...(folder.resourceKey ? [{ id: folder.id, key: folder.resourceKey }] : [])], token: null, seenTokens: [] });
  }
  if (page.nextToken) {
    current.seenTokens.push(page.nextToken);
    current.token = page.nextToken;
  } else {
    state.visited.push(current.id);
    state.queue.shift();
  }
  state.page = null;
  return { state, complete: state.queue.length === 0, progressed: true };
}

export async function runJuntasCheckpoint({ db, driveKey, sourceFetch = fetch, sources = JUNTA_EXTERNAL_SOURCES,
  now = new Date(), maxRequests = 25, maxPublicationWrites = 20, maxSteps = 100, refreshAfterMs = day }) {
  if (!db || !Array.isArray(sources) || !sources.length || !Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 100 ||
      !Number.isInteger(maxPublicationWrites) || maxPublicationWrites < 1 || maxPublicationWrites > 50 ||
      !Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 200 || refreshAfterMs < 0)
    throw new Error("JUNTAS_BUDGET_INVALID");
  const instant = now.toISOString(), budget = { requests: maxRequests, usedRequests: 0 };
  const limit = { remaining: maxPublicationWrites };
  const before = db.metrics?.();
  const metrics = { sourceRequests: 0, created: 0, updated: 0, unchanged: 0, skippedUnchanged: 0,
    queries: 0, rowsRead: 0, rowsWritten: 0, failures: [] };
  const receiver = createDirectD1ReceiverFetch(db);
  const finished = new Set();
  for (let step = 0; step < maxSteps && budget.requests > 0 && limit.remaining > 0; step++) {
    if (finished.size === sources.length) break;
    const source = sources[step % sources.length];
    const [rootId, category] = source;
    if (finished.has(rootId)) continue;
    const previous = await db.prepare("SELECT status,last_success_at FROM juntas_import_checkpoint WHERE root_id=?").bind(rootId).first();
    if (previous?.status === "OK" && Date.parse(previous.last_success_at || "") + refreshAfterMs > now.getTime()) {
      finished.add(rootId); continue;
    }
    const owner = randomUUID(), claimed = await claim(db, source, owner, instant, Boolean(previous));
    if (!claimed) { finished.add(rootId); continue; }
    try {
      let state = decode(claimed.state_json);
      if (claimed.status === "OK") {
        state = initial(source, state.cycle + 1, state.lastDocHash);
        await save(db, rootId, owner, state, instant);
      }
      const output = source[3].includes("docs.google.com/document/")
        ? await advanceDocument(db, source, state, budget, limit, receiver, metrics, sourceFetch, now)
        : await advanceFolder(db, source, state, budget, limit, receiver, metrics, sourceFetch, driveKey, instant);
      if (output.progressed) await save(db, rootId, owner, output.state, instant, output.complete);
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
  return { ...metrics, d1, health, categoryHealth, completed: categoryHealth.every((item) => item.status === "OK"),
    publicationAttempts: maxPublicationWrites - limit.remaining };
}
