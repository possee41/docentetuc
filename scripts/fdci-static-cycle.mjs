// Node/local files only. Reuses the bounded collector; no D1 or gateway calls.
import { collectFdciDeltaSlice } from "./collect-fdci-delta.mjs";
import { buildFdciCatalog, catalogHash, publicCatalogItem } from "../lib/fdci-static-catalog.ts";
import { publishLocalCatalog } from "./fdci-static-catalog.mjs";
import { mkdir, open, readFile, writeFile, rename, rm } from "node:fs/promises";
import { resolve, join, relative, isAbsolute, sep } from "node:path";
import { randomUUID } from "node:crypto";
const fresh = history => ({ schemaVersion: 1, activeKey: null, state: { detail_after: "", detail_upper: "", detail_cycle: 1 },
  items: [], observations: {}, history, lastCheckAt: null });
async function saveCheckpoint(path, data) {
  const temp = path + "." + randomUUID() + ".tmp";
  try { await writeFile(temp, JSON.stringify({ data, sha256: await catalogHash(data) }) + "\n", { flag: "wx" }); await rename(temp, path); }
  finally { await rm(temp, { force: true }); }
}
export async function runFdciStaticCycle({ workDirectory, publishDirectory, fetcher, checkedAt, pause = ms => new Promise(r => setTimeout(r, ms)) }) {
  if (typeof fetcher !== "function" || new Date(checkedAt).toISOString() !== checkedAt) throw Error("STATIC_CYCLE_CONFIG_INVALID");
  const work = resolve(workDirectory), output = resolve(publishDirectory), rel = relative(output, work);
  if (!rel || !isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep)) throw Error("CHECKPOINT_MUST_NOT_BE_PUBLIC");
  await mkdir(work, { recursive: true });
  const lockPath = join(work, ".cycle.lock"), lock = await open(lockPath, "wx"), path = join(work, "checkpoint.json");
  let requests = 0;
  try {
    let previous = fresh({});
    try {
      const envelope = JSON.parse(await readFile(path, "utf8"));
      if (await catalogHash(envelope.data) !== envelope.sha256 || envelope.data?.schemaVersion !== 1) throw Error("CHECKPOINT_INVALID");
      previous = envelope.data;
    } catch (e) { if (e.code !== "ENOENT") throw e; }
    if (previous.lastCheckAt && checkedAt <= previous.lastCheckAt) throw Error("CHECKPOINT_TIME_CONFLICT");
    let activeKey, activeCount, membershipChanged = false;
    let slice;
    try {
      slice = await collectFdciDeltaSlice(async (url, options) => {
        const u = new URL(url);
        if (u.origin !== "https://apicapacitaciones.educaciontuc.edu.ar" || u.search ||
            !["/api/gestionCapas/getCapaActivas", "/api/gestionCapas/getRestoCapas", "/api/capa/getCupo"].includes(u.pathname)) throw Error("FDCI_SOURCE_FORBIDDEN");
        if (requests >= 6) throw Error("FDCI_PROBE_REQUEST_LIMIT");
        requests++;
        if (requests > 1) await pause(400);
        const response = await fetcher(url, { ...options, redirect: "error", credentials: "omit" });
        if (u.pathname.endsWith("getCapaActivas") && response.ok) {
          const rows = await response.clone().json();
          if (!Array.isArray(rows)) throw Error("FDCI_SCHEMA_CHANGED");
          const keys = rows.map(x => `${x.capacitacion_id}:${x.id}`).sort();
          if (new Set(keys).size !== keys.length) throw Error("FDCI_SCHEMA_CHANGED");
          activeKey = await catalogHash(keys); activeCount = keys.length;
          if (previous.activeKey && previous.activeKey !== activeKey) { membershipChanged = true; throw Error("FDCI_CANCELLED"); }
        }
        return response;
      }, { state: previous.state, queued: new Map() });
    } catch (e) {
      if (!membershipChanged) throw e;
      // Source membership changed: restart a new local scan, never publish a mix
      // or infer deletion from the unfinished old scan. Last public file stays.
      const restarted = { ...fresh(previous.history), lastCheckAt: checkedAt };
      await saveCheckpoint(path, restarted);
      return { status: "restarted", requests, published: false };
    }
    const items = new Map(previous.items.map(i => [i.id, i]));
    const observations = { ...previous.observations }, history = { ...previous.history };
    for (const row of slice.items) {
      const item = publicCatalogItem(row), hash = await catalogHash(item), old = history[item.id];
      const lastChangedAt = old?.hash === hash ? old.lastChangedAt : checkedAt;
      items.set(item.id, item); observations[item.id] = { checkedAt, lastChangedAt }; history[item.id] = { hash, lastChangedAt };
    }
    const next = { ...previous, activeKey, lastCheckAt: checkedAt, items: [...items.values()], observations, history,
      state: { detail_after: slice.detail.complete ? "" : slice.detail.after, detail_upper: slice.detail.complete ? "" : slice.detail.upper,
        detail_cycle: previous.state.detail_cycle + Number(slice.detail.complete) } };
    if (!slice.detail.complete) {
      await saveCheckpoint(path, next);
      return { status: "partial", requests, published: false, pending: activeCount - items.size, cursor: next.state };
    }
    if (items.size !== activeCount) throw Error("STATIC_CATALOG_INCOMPLETE");
    const catalog = await buildFdciCatalog([...items.values()], checkedAt, observations);
    // Publish first. A lost checkpoint write cannot discard unconfirmed progress:
    // old checkpoint repeats collection safely; no D1/publication mutation exists.
    const result = await publishLocalCatalog(catalog, output);
    await saveCheckpoint(path, { ...fresh(history), lastCheckAt: checkedAt });
    return { status: "complete", requests, published: true, ...result };
  } finally { await lock.close(); await rm(lockPath); }
}
