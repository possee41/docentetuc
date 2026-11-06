// Local prototype only: no D1, gateway, environment secrets or default network.
import { collectFdci } from "./import-fdci.mjs";
import { buildFdciCatalog, validateFdciCatalog } from "../lib/fdci-static-catalog.ts";
import { mkdir, open, readFile, writeFile, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

export async function generateFdciCatalog(fetcher, updatedAt, pause = ms => new Promise(r => setTimeout(r, ms))) {
  if (typeof fetcher !== "function") throw Error("FDCI_EXPLICIT_SOURCE_REQUIRED");
  let requests = 0;
  const collected = await collectFdci(async (url, options) => {
    if (++requests > 6) throw Error("FDCI_PROBE_REQUEST_LIMIT");
    const u = new URL(url);
    if (u.origin !== "https://apicapacitaciones.educaciontuc.edu.ar" || u.search ||
        !["/api/gestionCapas/getCapaActivas", "/api/gestionCapas/getRestoCapas", "/api/capa/getCupo"].includes(u.pathname)) throw Error("FDCI_SOURCE_FORBIDDEN");
    if (requests > 1) await pause(400);
    return fetcher(url, { ...options, redirect: "error", credentials: "omit" });
  }, undefined, "active");
  // Never replace a complete snapshot with a partial collection, even if some
  // details were successfully fetched before a failure/request budget stop.
  if (collected.failures || !Number.isSafeInteger(collected.activeCommissions) ||
      new Set(collected.items.map(x => x.id)).size !== collected.activeCommissions)
    throw Error("FDCI_CATALOG_INCOMPLETE");
  return { catalog: await buildFdciCatalog(collected.items, updatedAt), requests };
}

export async function publishLocalCatalog(catalog, directory, promote = rename) {
  const valid = await validateFdciCatalog(catalog);
  const dir = resolve(directory), versions = join(dir, "versions");
  await mkdir(versions, { recursive: true });
  const lockPath = join(dir, ".publish.lock"), lock = await open(lockPath, "wx");
  const tmp = join(dir, `.catalog-${randomUUID()}.tmp`);
  try {
    let previous;
    try { previous = await validateFdciCatalog(JSON.parse(await readFile(join(dir, "catalog.json"), "utf8"))); }
    catch (e) { if (e.code !== "ENOENT") throw e; }
    if (previous && previous.updatedAt > valid.updatedAt) throw Error("FDCI_CATALOG_OLDER_THAN_CURRENT");
    if (previous?.updatedAt === valid.updatedAt && previous.sha256 !== valid.sha256) throw Error("FDCI_CATALOG_SAME_TIME_CONFLICT");
    const bytes = JSON.stringify(valid) + "\n", versionFile = join(versions, `${valid.sha256}.json`);
    await writeFile(tmp, bytes, { flag: "wx" });
    // Immutable snapshots are retained for explicit rollback. Readers use only
    // catalog.json, replaced by one same-filesystem rename, never by truncate.
    try { await writeFile(versionFile, bytes, { flag: "wx" }); }
    catch (e) { if (e.code !== "EEXIST" || await readFile(versionFile, "utf8") !== bytes) throw e; }
    await promote(tmp, join(dir, "catalog.json"));
    return { version: valid.version, sha256: valid.sha256, items: valid.items.length };
  } finally { await rm(tmp, { force: true }); await lock.close(); await rm(lockPath); }
}

// Reproducible review artifact: only synthetic source responses, never live APIs.
export async function syntheticFdciFetch(url) {
  const commissions = [9000, 9001].map(id => ({ id, capacitacion_id: 100,
    fecha_apertura_preinscripcion: "2026-01-01 08:00:00", fecha_cierre_preinscripcion: "2099-12-01 08:00:00" }));
  return Response.json(String(url).endsWith("getCapaActivas") ? commissions : String(url).endsWith("getRestoCapas")
    ? [{ capacitacion_id: 100, nombre: "DEMO SINTÉTICA — NO OFICIAL", token: "synthetic", slug: "synthetic" }] : { comisiones: commissions });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] !== "--demo" || !process.argv[3]) throw Error("USE_DEMO_AND_LOCAL_OUTPUT_DIRECTORY");
  const { catalog, requests } = await generateFdciCatalog(syntheticFdciFetch, "2026-11-05T12:00:00.000Z");
  console.log(JSON.stringify({ ...(await publishLocalCatalog(catalog, process.argv[3])), requests, synthetic: true }));
}
