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
const MAX_ITEMS_PER_RUN = 1000;

// The first productive pass runs bounded: a Junta subset, an item limit and a
// resume point taken from the previous run output. Defaults never widen it.
export function parseSimeOptions(config = {}) {
  const rawJuntas = config.SIME_IMPORT_JUNTAS ?? "1,2,3,4";
  const juntas = String(rawJuntas).split(",").map((value) => Number(value.trim()));
  if (!juntas.length || juntas.length > ALL_JUNTAS.length || new Set(juntas).size !== juntas.length ||
      juntas.some((id) => !ALL_JUNTAS.includes(id))) throw new Error("SIME_IMPORT_OPTIONS_INVALID");
  const limit = config.SIME_IMPORT_LIMIT === undefined ? 50 : Number(config.SIME_IMPORT_LIMIT);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ITEMS_PER_RUN) throw new Error("SIME_IMPORT_OPTIONS_INVALID");
  const resumeAfter = config.SIME_IMPORT_RESUME_AFTER || "";
  if (resumeAfter && !/^sime:\d+$/.test(resumeAfter)) throw new Error("SIME_IMPORT_OPTIONS_INVALID");
  return { juntas: juntas.sort((a, b) => a - b), limit, resumeAfter };
}

export async function runSimeImport({ endpoint, token, sourceFetch = fetch, receiverFetch = fetch, now = new Date(),
  juntas = ALL_JUNTAS, limit = Number.POSITIVE_INFINITY, resumeAfter = "" }) {
  let url;
  try { url = new URL(endpoint); } catch { throw new Error("SIME_IMPORT_CONFIGURATION_INVALID"); }
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "127.0.0.1")) ||
      url.pathname !== "/api/internal/sime-import" || !/^[A-Za-z0-9_-]{32,}$/.test(token)) throw new Error("SIME_IMPORT_CONFIGURATION_INVALID");
  const selected = [...new Set(juntas)].sort((a, b) => a - b);
  if (!selected.length || selected.some((id) => !ALL_JUNTAS.includes(id)) ||
      !(limit === Number.POSITIVE_INFINITY || Number.isInteger(limit) && limit >= 1 && limit <= MAX_ITEMS_PER_RUN) ||
      (resumeAfter && !/^sime:\d+$/.test(resumeAfter))) throw new Error("SIME_IMPORT_CONFIGURATION_INVALID");
  const previous = new Map();
  let cursor = "";
  do {
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
  try {
    const discovered = new Map();
    let complete = true;
    for (const juntaId of selected) {
      try {
        const result = await collectSimePublications(previous, sourceFetch, now, [juntaId]);
        // A repeated id keeps the last Junta snapshot, as the sequential batches did.
        for (const item of result.items) discovered.set(item.id, item);
        complete &&= result.complete;
      } catch { complete = false; }
    }
    // A failed Junta cannot block healthy siblings. Never infer removals from a partial traversal.
    // Deterministic id order makes the limit and the resume point reproducible.
    const ordered = [...discovered.values()].sort((a, b) => Number(a.id.slice(5)) - Number(b.id.slice(5)));
    const floor = resumeAfter ? Number(resumeAfter.slice(5)) : -1;
    const pending = ordered.filter((item) => Number(item.id.slice(5)) > floor);
    const batch = pending.slice(0, limit);
    const truncated = pending.length > batch.length;
    for (const item of batch) {
      const row = await prepareSimeImport(item, now);
      const ack = await request(endpoint, token, receiverFetch, { mode: "batch", items: [row] });
      if (ack.received !== 1 || ack.created + ack.updated + ack.unchanged !== 1) throw new Error("SIME_RECEIVER_ACK_INVALID");
      created += ack.created; updated += ack.updated; unchanged += ack.unchanged;
      queries += ack.queries; rowsRead += ack.rowsRead; rowsWritten += ack.rowsWritten;
    }
    if (!complete) throw new Error("SIME_PARTIAL_SOURCE");
    const result = { discovered: pending.length, created, updated, unchanged, queries, rowsRead, rowsWritten,
      resumedAfter: resumeAfter || null, nextResumeAfter: truncated ? batch.at(-1).id : "", truncated };
    // Only a full scan of the four Juntas, started from the beginning and without
    // truncation, may advance sync_state to OK. Bounded runs stay PARTIAL so a
    // later run never treats an incomplete catalog as the source of truth.
    if (truncated || resumeAfter || selected.length !== ALL_JUNTAS.length) return { ...result, completed: false };
    await request(endpoint, token, receiverFetch, { mode: "finish", complete: true, count: batch.length });
    return { ...result, completed: true };
  } catch (error) {
    try { await request(endpoint, token, receiverFetch, { mode: "error", code: error?.message === "SIME_PARTIAL_SOURCE" ? "PARTIAL" : sourceErrorCode(error) }); } catch { /* The original failure remains authoritative. */ }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runSimeImport({ endpoint: process.env.SIME_IMPORT_URL || "", token: process.env.SIME_IMPORT_SECRET || "",
      ...parseSimeOptions(process.env) });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error("SIME_IMPORT_FAILED", sourceErrorCode(error));
    process.exitCode = 1;
  }
}
