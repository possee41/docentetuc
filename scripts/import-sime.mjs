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

export async function runSimeImport({ endpoint, token, sourceFetch = fetch, receiverFetch = fetch, now = new Date() }) {
  let url;
  try { url = new URL(endpoint); } catch { throw new Error("SIME_IMPORT_CONFIGURATION_INVALID"); }
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "127.0.0.1")) ||
      url.pathname !== "/api/internal/sime-import" || !/^[A-Za-z0-9_-]{32,}$/.test(token)) throw new Error("SIME_IMPORT_CONFIGURATION_INVALID");
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
    const items = [];
    let complete = true;
    for (const juntaId of [1, 2, 3, 4]) {
      try {
        const result = await collectSimePublications(previous, sourceFetch, now, [juntaId]);
        items.push(...result.items);
        complete &&= result.complete;
      } catch { complete = false; }
    }
    // A failed Junta cannot block healthy siblings. Never infer removals from a partial traversal.
    for (const item of items) {
      const row = await prepareSimeImport(item, now);
      const ack = await request(endpoint, token, receiverFetch, { mode: "batch", items: [row] });
      if (ack.received !== 1 || ack.created + ack.updated + ack.unchanged !== 1) throw new Error("SIME_RECEIVER_ACK_INVALID");
      created += ack.created; updated += ack.updated; unchanged += ack.unchanged;
      queries += ack.queries; rowsRead += ack.rowsRead; rowsWritten += ack.rowsWritten;
    }
    if (!complete) throw new Error("SIME_PARTIAL_SOURCE");
    await request(endpoint, token, receiverFetch, { mode: "finish", complete: true, count: items.length });
    return { discovered: items.length, created, updated, unchanged, queries, rowsRead, rowsWritten, completed: true };
  } catch (error) {
    try { await request(endpoint, token, receiverFetch, { mode: "error", code: error?.message === "SIME_PARTIAL_SOURCE" ? "PARTIAL" : sourceErrorCode(error) }); } catch { /* The original failure remains authoritative. */ }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runSimeImport({ endpoint: process.env.SIME_IMPORT_URL || "", token: process.env.SIME_IMPORT_SECRET || "" });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error("SIME_IMPORT_FAILED", sourceErrorCode(error));
    process.exitCode = 1;
  }
}
