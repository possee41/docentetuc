export type HashedItem = { id: string; contentHash: string; source: string };

export async function hashSourceSnapshot(sourceData: unknown, derivedMetadata: unknown) {
  const payload = new TextEncoder().encode(JSON.stringify({ sourceData, derivedMetadata }));
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function diffByHash<T extends HashedItem>(previous: Map<string, { content_hash: string }>, current: T[]) {
  const fresh = current.filter((item) => !previous.has(item.id));
  const changed = current.filter((item) => previous.has(item.id) && previous.get(item.id)?.content_hash !== item.contentHash);
  const writeIds = new Set([...fresh, ...changed].map((item) => item.id));
  return { fresh, changed, unchanged: current.filter((item) => !writeIds.has(item.id)), writes: current.filter((item) => writeIds.has(item.id)) };
}

export type MeaningfulPublicationFields = {
  status?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  title?: unknown;
  summary?: unknown;
  category?: unknown;
  level?: unknown;
  area?: unknown;
  junta?: unknown;
  location?: unknown;
  shift?: unknown;
  character?: unknown;
  sourceUpdatedAt?: unknown;
  circuit?: unknown;
  contentHash?: unknown;
};

const meaningfulFields: (keyof MeaningfulPublicationFields)[] = [
  "status", "startsAt", "endsAt", "title", "summary", "category", "level", "area", "junta", "location", "shift", "character", "sourceUpdatedAt",
];

export function hasMeaningfulPublicationChange(previous: MeaningfulPublicationFields, current: MeaningfulPublicationFields) {
  return meaningfulFields.some((field) => !Object.is(previous[field] ?? null, current[field] ?? null));
}
