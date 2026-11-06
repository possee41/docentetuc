import { catalogHash, validateFdciCatalog, CATALOG_MAX_BYTES, type FdciCatalog } from "./fdci-static-catalog.ts";
type Attempt = { at: string; status: "complete" | "partial" | "restarted" | "source-error"; error: string | null };
export type FdciActiveVersion = {
  format: 1; source: "fdci"; scope: "active"; generation: number; stateChecksum: string; stateRevision: string; codeSha: string;
  catalogSha256: string; catalogUpdatedAt: string; versionPath: string; lastAttempt: Attempt; sha256: string;
};
const exact = (v: object, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const iso = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
export async function validateFdciActiveVersion(value: unknown): Promise<FdciActiveVersion> {
  if (!value || typeof value !== "object") throw Error("FDCI_ACTIVE_INVALID");
  const v = value as FdciActiveVersion, { sha256, ...body } = v;
  if (!exact(v, ["format", "source", "scope", "generation", "stateChecksum", "stateRevision", "codeSha", "catalogSha256", "catalogUpdatedAt", "versionPath", "lastAttempt", "sha256"]) ||
      v.format !== 1 || v.source !== "fdci" || v.scope !== "active" || !Number.isSafeInteger(v.generation) || v.generation < 1 ||
      !/^[a-f0-9]{64}$/.test(v.stateChecksum) || !/^[a-f0-9]{40}$/.test(v.stateRevision) || !/^[a-f0-9]{40}$/.test(v.codeSha) ||
      !/^[a-f0-9]{64}$/.test(v.catalogSha256) || v.versionPath !== `versions/${v.catalogSha256}.json` || !iso(v.catalogUpdatedAt) ||
      !v.lastAttempt || !exact(v.lastAttempt, ["at", "status", "error"]) || !iso(v.lastAttempt.at) || v.lastAttempt.at < v.catalogUpdatedAt ||
      !["complete", "partial", "restarted", "source-error"].includes(v.lastAttempt.status) ||
      (v.lastAttempt.status === "source-error" ? !/^[A-Z0-9_]{1,100}$/.test(v.lastAttempt.error ?? "") : v.lastAttempt.error !== null) ||
      sha256 !== await catalogHash(body)) throw Error("FDCI_ACTIVE_INVALID");
  return v;
}
export async function buildFdciActiveVersion(input: Omit<FdciActiveVersion, "format" | "source" | "scope" | "sha256" | "versionPath">) {
  const body = { format: 1 as const, source: "fdci" as const, scope: "active" as const, ...input, versionPath: `versions/${input.catalogSha256}.json` };
  return validateFdciActiveVersion({ ...body, sha256: await catalogHash(body) });
}
export const FDCI_RAW_ACTIVE_URL = "https://raw.githubusercontent.com/possee41/docentetuc-fdci-catalog-pilot/main/fdci-catalog/active.json";
async function readPublicJson(url: string, fetcher: typeof fetch, limit: number, immutable = false, raw = false) {
  const response = await fetcher(url, { mode: "cors", credentials: "omit", redirect: "error", cache: immutable ? "force-cache" : "no-store",
    headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || !(type.includes("application/json") || raw && type.startsWith("text/plain"))) throw Error("FDCI_PUBLICATION_UNAVAILABLE");
  const reader = response.body?.getReader(); if (!reader) throw Error("FDCI_PUBLICATION_UNAVAILABLE");
  let size = 0, text = ""; const decoder = new TextDecoder("utf-8", { fatal: true });
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength; if (size > limit) { await reader.cancel(); throw Error("FDCI_PUBLICATION_TOO_LARGE"); }
    text += decoder.decode(value, { stream: true });
  }
  return JSON.parse(text + decoder.decode());
}
export function createFdciVersionedReader(url: string, fetcher: typeof fetch = fetch, now = () => Date.now()) {
  if (![FDCI_RAW_ACTIVE_URL, "https://possee41.github.io/docentetuc-fdci-catalog-pilot/fdci-catalog/active.json"].includes(url)) throw Error("FDCI_PUBLICATION_ORIGIN_FORBIDDEN");
  const raw = url === FDCI_RAW_ACTIVE_URL;
  let last: { pointer: FdciActiveVersion; catalog: FdciCatalog } | null = null;
  return async () => {
    let error: string | null = null;
    try {
      const pointer = await validateFdciActiveVersion(await readPublicJson(url, fetcher, 4096, false, raw));
      const catalog = await validateFdciCatalog(await readPublicJson(new URL(pointer.versionPath, url).href, fetcher, CATALOG_MAX_BYTES, true, raw));
      if (catalog.sha256 !== pointer.catalogSha256 || catalog.updatedAt !== pointer.catalogUpdatedAt) throw Error("FDCI_PUBLICATION_MISMATCH");
      // Check after both awaits too: a slower old response must not replace a newer accepted pair.
      if (Date.parse(pointer.lastAttempt.at) > now() + 300_000 || last && (pointer.generation < last.pointer.generation ||
          pointer.generation === last.pointer.generation && pointer.sha256 !== last.pointer.sha256 || pointer.catalogUpdatedAt < last.catalog.updatedAt)) throw Error("FDCI_PUBLICATION_ROLLBACK");
      // The old public pilot is a DEMO, never an official fallback.
      if (catalog.version === "14ffa0ebd934c43d36757b89be76318ee0053a45352912f758786ee5377c613b" ||
          catalog.items.some(item => /DEMO\s+SINT[ÉE]TICA/i.test(item.title!))) throw Error("FDCI_SYNTHETIC_CATALOG");
      last = { pointer, catalog };
    } catch { error = "FDCI_PUBLICATION_UNAVAILABLE"; }
    const ageMs = last ? Math.max(0, now() - Date.parse(last.catalog.updatedAt)) : null;
    return { status: !last ? "unavailable" : error || last.pointer.lastAttempt.status !== "complete" || ageMs! > 86_400_000 ? "stale" : "ready",
      catalog: last ? structuredClone(last.catalog) : null, items: structuredClone(last?.catalog.items ?? []),
      updatedAt: last?.catalog.updatedAt ?? null, ageMs, generation: last?.pointer.generation ?? null,
      catalogSha256: last?.catalog.sha256 ?? null, lastAttempt: last ? { ...last.pointer.lastAttempt } : null, error };
  };
}
