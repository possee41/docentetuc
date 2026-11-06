// Independent public-feed prototype. Not wired into app state or private APIs.
export const CATALOG_MAX_BYTES = 2_000_000;
const fields = ["id", "externalId", "title", "summary", "category", "level", "area", "location", "character", "status", "normalizedStatus", "officialUrl", "registrationOpenAt", "registrationCloseAt", "startsAt", "endsAt", "sourceUpdatedAt"] as const;
export type CatalogItem = Record<typeof fields[number], string | null>;
export type CatalogObservation = { checkedAt: string; lastChangedAt: string };
export type FdciCatalog = { schemaVersion: 1 | 2; source: "fdci"; scope: "active"; updatedAt: string; version: string; items: CatalogItem[]; sha256: string; observations?: Record<string, CatalogObservation> };
const fail = () => { throw Error("FDCI_CATALOG_INVALID"); };
const iso = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const exact = (v: object, keys: readonly string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const dates = new Set<string>(["registrationOpenAt", "registrationCloseAt", "startsAt", "endsAt", "sourceUpdatedAt"]);
export async function catalogHash(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), n => n.toString(16).padStart(2, "0")).join("");
}
export function publicCatalogItem(input: Record<string, unknown>): CatalogItem {
  const item = Object.fromEntries(fields.map(k => [k, input[k]])) as CatalogItem;
  for (const key of fields) {
    const v = item[key];
    if (dates.has(key)) { if (v !== null && (typeof v !== "string" || !Number.isFinite(Date.parse(v)))) fail(); }
    else if (typeof v !== "string" || v.length > (key === "summary" ? 2000 : 500) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) fail();
  }
  if (!/^fdci:commission:[1-9]\d{0,11}$/.test(item.id!) || item.id!.split(":").at(-1) !== item.externalId ||
      !item.title || !["ACTIVE", "UPCOMING", "CLOSED", "EXPIRED", "UNKNOWN"].includes(item.normalizedStatus!)) fail();
  const url = new URL(item.officialUrl!);
  if (url.protocol !== "https:" || url.hostname !== "capacitaciondocente.educaciontuc.gov.ar" || url.port || url.username || url.password || url.search || url.hash) fail();
  return item;
}
export async function buildFdciCatalog(inputs: Record<string, unknown>[], updatedAt: string, observations?: Record<string, CatalogObservation>): Promise<FdciCatalog> {
  if (!iso(updatedAt) || inputs.length > 10_000) fail();
  const unique = new Map<string, CatalogItem>();
  for (const input of inputs) {
    const item = publicCatalogItem(input), old = unique.get(item.id!);
    if (old && JSON.stringify(old) !== JSON.stringify(item)) throw Error("FDCI_CATALOG_DUPLICATE_CONFLICT");
    unique.set(item.id!, item);
  }
  const items = [...unique.values()].sort((a, b) => a.id! < b.id! ? -1 : a.id! > b.id! ? 1 : 0);
  if (observations && (!exact(observations, items.map(i => i.id!)) || items.some(i => {
    const o = observations[i.id!];
    return !o || !exact(o, ["checkedAt", "lastChangedAt"]) || !iso(o.checkedAt) || !iso(o.lastChangedAt) || o.lastChangedAt > o.checkedAt || o.checkedAt > updatedAt;
  }))) fail();
  const body = { schemaVersion: observations ? 2 as const : 1 as const, source: "fdci" as const, scope: "active" as const, updatedAt, version: await catalogHash(items), items,
    ...(observations ? { observations: Object.fromEntries(items.map(i => [i.id!, observations[i.id!]])) } : {}) };
  const result = { ...body, sha256: await catalogHash(body) };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > CATALOG_MAX_BYTES) fail();
  return result;
}
export async function validateFdciCatalog(value: unknown): Promise<FdciCatalog> {
  if (!value || typeof value !== "object") fail();
  const v = value as FdciCatalog;
  if (!exact(v, ["schemaVersion", "source", "scope", "updatedAt", "version", "items", "sha256", ...(v.schemaVersion === 2 ? ["observations"] : [])]) ||
      ![1, 2].includes(v.schemaVersion) || v.schemaVersion === 2 && (!v.observations || typeof v.observations !== "object") ||
      v.source !== "fdci" || v.scope !== "active" || !Array.isArray(v.items) ||
      v.items.some(x => !x || !exact(x, fields))) fail();
  const canonical = await buildFdciCatalog(v.items, v.updatedAt, v.observations);
  if (canonical.version !== v.version || canonical.sha256 !== v.sha256 || JSON.stringify(canonical.items) !== JSON.stringify(v.items)) fail();
  return canonical;
}

export function createFdciCatalogReader(url: string, fetcher: typeof fetch = fetch, now = () => Date.now()) {
  const target = new URL(url);
  if (target.origin !== "https://possee41.github.io" || target.username || target.password || target.search || target.hash || !target.pathname.endsWith("/catalog.json"))
    throw Error("FDCI_CATALOG_ORIGIN_FORBIDDEN");
  let lastGood: FdciCatalog | undefined;
  return async () => {
    let error: string | undefined;
    try {
      const response = await fetcher(target.href, { credentials: "omit", redirect: "error", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
      if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw Error();
      const reader = response.body?.getReader(); if (!reader) throw Error();
      let text = "", size = 0; const decoder = new TextDecoder("utf-8", { fatal: true });
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > CATALOG_MAX_BYTES) { await reader.cancel(); throw Error(); }
        text += decoder.decode(value, { stream: true });
      }
      const next = await validateFdciCatalog(JSON.parse(text + decoder.decode()));
      if (Date.parse(next.updatedAt) > now() + 300_000 || lastGood &&
          (next.updatedAt < lastGood.updatedAt || next.updatedAt === lastGood.updatedAt && next.sha256 !== lastGood.sha256)) throw Error();
      lastGood = next;
    } catch { error = "FDCI_CATALOG_UNAVAILABLE"; }
    const age = lastGood ? now() - Date.parse(lastGood.updatedAt) : Infinity;
    return { status: !lastGood ? "unavailable" : error || age > 86_400_000 ? "stale" : "ready",
      catalog: lastGood ? structuredClone(lastGood) : null,
      updatedAt: lastGood?.updatedAt ?? null, version: lastGood?.version ?? null,
      observations: structuredClone(lastGood?.observations ?? {}),
      // Return detached public DTOs; caller cannot corrupt last-known-good state.
      items: lastGood ? structuredClone(lastGood.items) : [], error };
  };
}
