// Node owns collection, full-record hashes and comparison. D1 owns confirmations.
import { collectFdci, sendFdci } from "./import-fdci.mjs";
import { validFdciImport } from "../lib/fdci-import.ts";

export async function deltaRequest(target, owner, payload, fetcher) {
  let response;
  try {
    response = await fetcher(`${target.origin}/api/internal/fdci-delta`, { method: "POST", redirect: "error",
      headers: { authorization: `Bearer ${target.secret}`, "content-type": "application/json", "x-import-gate-owner": owner },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(20_000) });
  } catch { throw new Error("FDCI_DELTA_UNCERTAIN"); }
  if (!response.ok) throw new Error(response.status >= 500 ? "FDCI_DELTA_UNCERTAIN" : `FDCI_DELTA_HTTP_${response.status}`);
  let ack;
  try { ack = await response.json(); } catch { throw new Error("FDCI_DELTA_UNCERTAIN"); }
  if (ack?.ok !== true || (ack.state && (!Number.isSafeInteger(ack.state.revision) || ack.state.revision < 0)) ||
      payload.revision !== undefined && ack.state?.revision !== payload.revision + 1) throw new Error("FDCI_DELTA_ACK_INVALID");
  return ack;
}

export async function runDeltaFdci(target, safety, fetcher, collect = collectFdci) {
  if (!Number.isInteger(safety.maxPublications) || safety.maxPublications < 1 || safety.maxPublications > 2)
    throw new Error("FDCI_DELTA_LIMIT_INVALID");
  const progress = { queued: 0, processed: 0, confirmedFromD1: 0, created: 0, updated: 0, unchanged: 0, batches: 0 };
  try {
    const collected = await collect(fetcher, undefined, "active");
    // No disappearance handling, partial reconciliation or draining stale observations.
    if (collected.failures || !Array.isArray(collected.items)) throw new Error("FDCI_DELTA_COLLECTION_INCOMPLETE");
    const seen = new Set();
    for (const item of collected.items) {
      if (!validFdciImport(item) || seen.has(item.id)) throw new Error("FDCI_DELTA_COLLECTION_INVALID");
      seen.add(item.id);
    }
    const call = payload => deltaRequest(target, safety.owner, payload, fetcher);
    let state = (await call({ op: "state" })).state;
    if (!state) throw new Error("FDCI_DELTA_ACK_INVALID");
    const pageMap = async op => {
      const map = new Map(); let after = "";
      do {
        const ack = await call({ op, after });
        if (!Array.isArray(ack.rows) || ack.rows.length > 200) throw new Error("FDCI_DELTA_ACK_INVALID");
        for (const row of ack.rows) {
          if (typeof row.id !== "string" || row.id <= after || map.has(row.id) ||
              op === "queued" && (!/^[a-f0-9]{64}$/.test(row.content_hash || "") || !Number.isSafeInteger(row.seq) || row.seq < 1))
            throw new Error("FDCI_DELTA_ACK_INVALID");
          after = row.id; map.set(row.id, row);
        }
        if (ack.rows.length < 200) break;
      } while (true);
      return map;
    };
    const confirmed = await pageMap("confirmed"), queued = await pageMap("queued");
    progress.examined = collected.items.length; progress.discovered = collected.items.length; progress.pending = queued.size;
    if ((await call({ op: "state" })).state?.revision !== state.revision) throw new Error("FDCI_DELTA_CONCURRENT_CHANGE");
    const eligible = collected.items.filter(item => item.id !== "fdci:commission:6375" && item.normalizedStatus !== "UNKNOWN" &&
      confirmed.get(item.id)?.normalized_status !== "UNKNOWN");
    const changes = eligible.filter(item => queued.has(item.id)
      ? queued.get(item.id).content_hash !== item.contentHash
      : confirmed.get(item.id)?.content_hash !== item.contentHash || confirmed.get(item.id)?.removed_at !== null);
    changes.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    let pending = queued.size;
    for (let i = 0; i < changes.length; i += 2) {
      const items = changes.slice(i, i + 2);
      state = (await call({ op: "stage", revision: state.revision, items })).state;
      pending += items.filter(item => !queued.has(item.id)).length;
      progress.queued += items.length; progress.pending = pending;
    }
    state = (await call({ op: "scan-complete", revision: state.revision })).state;
    const result = Object.assign(progress, { status: "OK", examined: collected.items.length, queued: changes.length,
      created: 0, updated: 0, unchanged: 0, batches: 0, confirmedFromD1: 0, processed: 0,
      skipped: collected.items.length - eligible.length, discovered: collected.items.length, empty: !collected.items.length,
      pending, cycleComplete: true, failed: false, completed: false });
    const changedIds = new Set(changes.map(item => item.id));
    const pendingItems = eligible.filter(item => queued.has(item.id) || changedIds.has(item.id));
    pendingItems.sort((a, b) => (queued.get(a.id)?.seq ?? Number.MAX_SAFE_INTEGER) -
      (queued.get(b.id)?.seq ?? Number.MAX_SAFE_INTEGER) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const ids = pendingItems.slice(0, safety.maxPublications).map(item => item.id);
    const head = ids.length ? await call({ op: "head", ids }) : { rows: [] };
    if (!Array.isArray(head.rows) || head.rows.length !== ids.length || new Set(head.rows.map(row => row.id)).size !== ids.length ||
        head.rows.some(row => !ids.includes(row.id) || !Number.isSafeInteger(row.version) || row.version < 1))
      throw new Error("FDCI_DELTA_ACK_INVALID");
    for (const row of head.rows.slice(0, safety.maxPublications)) {
      // Absence from active data never authorizes applying an old queued payload.
      const current = eligible.find(item => item.id === row.id);
      if (!current) continue;
      const item = JSON.parse(row.payload);
      if (!validFdciImport(item) || item.id !== row.id || item.contentHash !== row.content_hash || current.contentHash !== row.content_hash)
        throw new Error("FDCI_DELTA_ACK_INVALID");
      if (confirmed.get(row.id)?.content_hash === row.content_hash && confirmed.get(row.id)?.removed_at === null) {
        result.confirmedFromD1++;
      } else {
        const ack = await sendFdci(target.endpoint, target.secret, { mode: "batch", items: [item] }, fetcher, safety.owner);
        result.created += ack.created; result.updated += ack.updated; result.unchanged += ack.unchanged; result.batches++;
      }
      state = (await call({ op: "ack", revision: state.revision, id: row.id, hash: row.content_hash, version: row.version })).state;
      result.processed++; result.pending--;
    }
    return { ...result, cursor: state, status: result.pending ? "PARTIAL" : "OK", progressPending: result.pending > 0 };
  } catch (error) {
    error.result = { ...progress, uncertain: /UNCERTAIN|ACK_INVALID/.test(error.message) ? 1 : 0 };
    throw error;
  }
}
