import { pathToFileURL } from "node:url";
import { collectSimePublications } from "../lib/sime-collector.ts";
import { prepareSimeImport } from "../lib/sime-import.ts";
import { sourceErrorCode } from "../lib/publication-lifecycle.ts";

async function request(url, token, fetcher, body) {
  const response = await fetcher(url, { method: body ? "POST" : "GET", headers: {
    Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}),
  }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`SIME_RECEIVER_HTTP_${response.status}`);
  const result = await response.json();
  if (body && result.ok !== true) throw new Error("SIME_RECEIVER_ACK_INVALID");
  return result;
}

const ALL_JUNTAS = [1, 2, 3, 4];
const MAX_ITEMS_PER_RUN = 50;
export const SIME_CANARY = Object.freeze({
  origin: "https://docentetuc-import-canary-1-2.possee41.workers.dev",
  id: "853e2f5d-89b1-46a3-9c1c-5cbd46784756", name: "docentetuc-web-canary-1-2",
});

function verifyCanaryInvocation(url, execution, now) {
  if (url.origin !== SIME_CANARY.origin && execution === undefined) return; // Non-Canary library callers remain supported.
  const expires = Date.parse(execution?.expiresAt);
  if (url.origin !== SIME_CANARY.origin || url.search || url.hash || url.username || url.password ||
      execution?.target !== "canary" || !/^[a-f0-9]{40}$/.test(execution.approvedSha || "") ||
      execution.codeSha !== execution.approvedSha || !/^[1-9]\d*$/.test(execution.runId || "") ||
      execution.runId !== execution.authorizedRunId || execution.owner !== `sime-canary:${execution.runId}:1` ||
      !Number.isFinite(now.getTime()) || !Number.isFinite(expires) || expires <= now.getTime() || expires > now.getTime() + 600_000)
    throw new Error("SIME_CANARY_AUTHORIZATION_REQUIRED");
}

// A per-Junta checkpoint avoids replaying a faster Junta while another catches up.
export function parseSimeCursor(value = "") {
  const empty = { 1: "", 2: "", 3: "", 4: "" };
  if (typeof value !== "string" || value.length > 500) throw new Error("SIME_CURSOR_INVALID");
  if (!value) return empty;
  // Legacy cursors remain readable; new results always use a versioned vector.
  if (/^sime:\d{1,15}$/.test(value)) return Object.fromEntries(ALL_JUNTAS.map(id => [id, value]));
  let cursor;
  try { cursor = JSON.parse(value); } catch { throw new Error("SIME_CURSOR_INVALID"); }
  if (cursor?.version !== 1 || Object.keys(cursor).sort().join() !== "after,version" ||
      !cursor.after || Object.keys(cursor.after).sort().join() !== "1,2,3,4" ||
      !Object.values(cursor.after).every(id => id === "" || typeof id === "string" && /^sime:\d{1,15}$/.test(id)))
    throw new Error("SIME_CURSOR_INVALID");
  return { ...cursor.after };
}
const serializeCursor = after => JSON.stringify({ version: 1, after });

// The first productive pass runs bounded: a Junta subset, an item limit and a
// resume point taken from the previous run output. Defaults never widen it.
export function parseSimeOptions(config = {}) {
  const rawJuntas = config.SIME_IMPORT_JUNTAS ?? "1,2,3,4";
  const juntas = String(rawJuntas).split(",").map((value) => Number(value.trim()));
  if (!juntas.length || juntas.length > ALL_JUNTAS.length || new Set(juntas).size !== juntas.length ||
      juntas.some((id) => !ALL_JUNTAS.includes(id))) throw new Error("SIME_IMPORT_OPTIONS_INVALID");
  const limit = config.SIME_IMPORT_LIMIT === undefined ? 50 : Number(config.SIME_IMPORT_LIMIT);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ITEMS_PER_RUN) throw new Error("SIME_IMPORT_OPTIONS_INVALID");
  const resumeAfter = config.SIME_IMPORT_RESUME_AFTER ?? "";
  parseSimeCursor(resumeAfter);
  return { juntas: juntas.sort((a, b) => a - b), limit, resumeAfter };
}

export async function runSimeImport({ endpoint, token, sourceFetch = fetch, receiverFetch = fetch, now = new Date(),
  juntas = ALL_JUNTAS, limit = 50, resumeAfter = "", onProgress = () => {}, execution }) {
  let url;
  try { url = new URL(endpoint); } catch { throw new Error("SIME_IMPORT_CONFIGURATION_INVALID"); }
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "127.0.0.1")) ||
      url.pathname !== "/api/internal/sime-import" || !/^[A-Za-z0-9_-]{32,}$/.test(token)) throw new Error("SIME_IMPORT_CONFIGURATION_INVALID");
  verifyCanaryInvocation(url, execution, now);
  const selected = [...new Set(juntas)].sort((a, b) => a - b);
  if (!selected.length || selected.some((id) => !ALL_JUNTAS.includes(id)) ||
      !(Number.isInteger(limit) && limit >= 1 && limit <= MAX_ITEMS_PER_RUN) ||
      limit < selected.length) throw new Error("SIME_IMPORT_CONFIGURATION_INVALID");
  const after = parseSimeCursor(resumeAfter);
  const previous = new Map();
  const seenCursors = new Set();
  let cursor = "";
  do {
    if (seenCursors.has(cursor)) throw new Error("SIME_PREVIOUS_PAGE_INVALID");
    seenCursors.add(cursor);
    const page = await request(`${endpoint}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, token, receiverFetch);
    if (!Array.isArray(page.items) || page.items.length > 25 || (page.nextCursor && page.nextCursor === cursor)) throw new Error("SIME_PREVIOUS_PAGE_INVALID");
    for (const row of page.items) {
      if (!/^sime:\d+$/.test(row.id) || typeof row.metadata !== "string") throw new Error("SIME_PREVIOUS_ROW_INVALID");
      previous.set(row.id, { metadata: row.metadata });
    }
    cursor = page.nextCursor || "";
  } while (cursor);
  await request(endpoint, token, receiverFetch, { mode: "start" });
  let created = 0, updated = 0, unchanged = 0, queries = 0, rowsRead = 0, rowsWritten = 0;
  const processedByJunta = Object.fromEntries(ALL_JUNTAS.map(id => [id, 0]));
  const byJunta = Object.fromEntries(ALL_JUNTAS.map(id => [id, { created: 0, updated: 0, unchanged: 0 }]));
  try {
    const discovered = new Map();
    for (const juntaId of selected) {
      try {
        const result = await collectSimePublications(previous, sourceFetch, now, [juntaId]);
        if (!result.complete) throw new Error("SIME_PARTIAL_SOURCE");
        // A repeated id keeps the last Junta snapshot, as the sequential batches did.
        for (const item of result.items) discovered.set(item.id, item);
      } catch { throw new Error("SIME_PARTIAL_SOURCE"); }
    }
    // Deterministic id order makes the limit and the resume point reproducible.
    const labels = ["Inicial y Primaria", "Secundaria", "Técnica, Agrotécnica y No Formal", "Superior, Especial y Artística"];
    const quota = Math.floor(limit / selected.length);
    const pending = [], batch = [], board = new Map();
    for (const junta of selected) {
      const floor = after[junta] ? Number(after[junta].slice(5)) : -1;
      const rows = [...discovered.values()].filter(item => item.junta === labels[junta - 1] && Number(item.id.slice(5)) > floor)
        .sort((a, b) => Number(a.id.slice(5)) - Number(b.id.slice(5)));
      pending.push(...rows);
      for (const item of rows.slice(0, quota)) { batch.push(item); board.set(item.id, junta); }
    }
    const truncated = pending.length > batch.length;
    for (const item of batch) {
      const row = await prepareSimeImport(item, now);
      const ack = await request(endpoint, token, receiverFetch, { mode: "batch", items: [row] });
      if (ack.received !== 1 || ![ack.created, ack.updated, ack.unchanged, ack.queries, ack.rowsRead, ack.rowsWritten]
        .every(n => Number.isSafeInteger(n) && n >= 0) || ack.created + ack.updated + ack.unchanged !== 1)
        throw new Error("SIME_RECEIVER_ACK_INVALID");
      created += ack.created; updated += ack.updated; unchanged += ack.unchanged;
      queries += ack.queries; rowsRead += ack.rowsRead; rowsWritten += ack.rowsWritten;
      after[board.get(item.id)] = item.id;
      processedByJunta[board.get(item.id)]++;
      for (const key of ["created", "updated", "unchanged"]) byJunta[board.get(item.id)][key] += ack[key];
      await onProgress({ created, updated, unchanged, queries, rowsRead, rowsWritten,
        nextResumeAfter: serializeCursor(after), processedByJunta, byJunta, completed: false });
    }
    const result = { discovered: pending.length, created, updated, unchanged, queries, rowsRead, rowsWritten,
      resumedAfter: resumeAfter || null, nextResumeAfter: serializeCursor(after), processedByJunta, byJunta, truncated };
    // Only a full scan of the four Juntas, started from the beginning and without
    // truncation, may advance sync_state to OK. Bounded runs stay PARTIAL so a
    // later run never treats an incomplete catalog as the source of truth.
    if (truncated || resumeAfter || selected.length !== ALL_JUNTAS.length) return { ...result, completed: false };
    await request(endpoint, token, receiverFetch, { mode: "finish", complete: true, count: batch.length });
    return { ...result, completed: true };
  } catch (error) {
    error.result = { created, updated, unchanged, queries, rowsRead, rowsWritten,
      nextResumeAfter: serializeCursor(after), processedByJunta, byJunta, completed: false };
    try { await request(endpoint, token, receiverFetch, { mode: "error", code: error?.message === "SIME_PARTIAL_SOURCE" ? "PARTIAL" : sourceErrorCode(error) }); } catch { /* The original failure remains authoritative. */ }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Keep the library API for local/legacy callers, never a second Canary executable.
  console.error("SIME_PROTECTED_ENTRYPOINT_REQUIRED");
  process.exitCode = 1;
}
