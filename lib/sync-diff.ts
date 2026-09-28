export type HashedItem = { id: string; contentHash: string; source: string };

export function diffByHash<T extends HashedItem>(previous: Map<string, { content_hash: string }>, current: T[]) {
  const fresh = current.filter((item) => !previous.has(item.id));
  const changed = current.filter((item) => previous.has(item.id) && previous.get(item.id)?.content_hash !== item.contentHash);
  const writeIds = new Set([...fresh, ...changed].map((item) => item.id));
  return { fresh, changed, unchanged: current.filter((item) => !writeIds.has(item.id)), writes: current.filter((item) => writeIds.has(item.id)) };
}
