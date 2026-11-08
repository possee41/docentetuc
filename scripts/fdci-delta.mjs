// Node owns collection, full-record hashes and comparison. D1 owns confirmations.
import { sendFdci } from "./import-fdci.mjs";
import { collectFdciDeltaSlice } from "./collect-fdci-delta.mjs";
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

export async function runDeltaFdci(target, safety, fetcher, collect = collectFdciDeltaSlice) {
  if (!Number.isInteger(safety.maxPublications) || safety.maxPublications < 1 || safety.maxPublications > 2)
    throw new Error("FDCI_DELTA_LIMIT_INVALID");
  const progress = { queued: 0, processed: 0, confirmedFromD1: 0, created: 0, updated: 0, unchanged: 0, batches: 0 };
  try {
    const call = payload => deltaRequest(target, safety.owner, payload, fetcher);
    let state, after = "", queuedAfter = "";
    const confirmed = new Map(), queued = new Map();
    do {
      const ack = await call({ op: "snapshot", after, queuedAfter });
      if (!ack.state || state && ack.state.revision !== state.revision) throw new Error("FDCI_DELTA_CONCURRENT_CHANGE");
      if (!Array.isArray(ack.confirmed) || !Array.isArray(ack.queued) || ack.confirmed.length + ack.queued.length > 200 ||
          (ack.confirmedMore || ack.queuedMore) && ack.confirmed.length + ack.queued.length === 0)
        throw new Error("FDCI_DELTA_ACK_INVALID");
      state = ack.state;
      for (const [key, map, cursor, more] of [["confirmed", confirmed, after, ack.confirmedMore], ["queued", queued, queuedAfter, ack.queuedMore]]) {
        const rows = ack[key];
        if (!Array.isArray(rows) || rows.length > 200 || typeof more !== "boolean" ||
            cursor === null && (rows.length || more)) throw new Error("FDCI_DELTA_ACK_INVALID");
        let previous = cursor || "";
        for (const row of rows) {
          if (typeof row.id !== "string" || row.id <= previous || map.has(row.id) ||
              key === "queued" && (!/^[a-f0-9]{64}$/.test(row.content_hash || "") || !Number.isSafeInteger(row.seq) || row.seq < 1))
            throw new Error("FDCI_DELTA_ACK_INVALID");
          previous = row.id; map.set(row.id, row);
        }
        if (key === "confirmed") after = more ? previous : null;
        else queuedAfter = more ? previous : null;
      }
    } while (after !== null || queuedAfter !== null);
    // Observe D1 BEFORE contacting the source: a stale concurrent collector cannot
    // adopt a newer revision after collection and overwrite newer pending content.
    const collected = await collect(fetcher, { state, queued }, "active");
    if (collected.failures || !Array.isArray(collected.items)) throw new Error("FDCI_DELTA_COLLECTION_INCOMPLETE");
    const seen = new Set();
    for (const item of collected.items) {
      if (!validFdciImport(item) || seen.has(item.id)) throw new Error("FDCI_DELTA_COLLECTION_INVALID");
      seen.add(item.id);
    }
    progress.examined = collected.items.length; progress.discovered = collected.items.length; progress.pending = queued.size;
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
    state = (await call({ op: "scan-complete", revision: state.revision,
      ...(collected.detail ? { detail: collected.detail } : {}) })).state;
    const cycleComplete = collected.detail?.complete ?? true;
    const result = Object.assign(progress, { status: "OK", examined: collected.items.length, queued: changes.length,
      created: 0, updated: 0, unchanged: 0, batches: 0, confirmedFromD1: 0, processed: 0,
      skipped: collected.items.length - eligible.length, discovered: collected.activeCommissions ?? collected.items.length,
      empty: (collected.activeCommissions ?? collected.items.length) === 0,
      pending, cycleComplete, failed: false, completed: false });
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
        const ack = await sendFdci(target.endpoint, target.secret, { mode: "batch", items: [item],
          delta: { version: row.version, revision: state.revision } }, fetcher, safety.owner);
        result.created += ack.created; result.updated += ack.updated; result.unchanged += ack.unchanged; result.batches++;
      }
      state = (await call({ op: "ack", revision: state.revision, id: row.id, hash: row.content_hash, version: row.version })).state;
      result.processed++; result.pending--;
    }
    return { ...result, cursor: state, status: result.pending || !cycleComplete ? "PARTIAL" : "OK",
      progressPending: result.pending > 0 || !cycleComplete };
  } catch (error) {
    error.result = { ...progress, uncertain: /UNCERTAIN|ACK_INVALID/.test(error.message) ? 1 : 0 };
    throw error;
  }
}
