import type { AppData, Publication } from "./types";

export type PrivateAppData = Omit<AppData, "publications" | "sync"> & { personalPublications: Publication[] };

// Public catalog and source health have one owner: /api/public-app.
export function combineAppData(publicData: AppData | null, privateData: PrivateAppData | null): AppData | null {
  if (!privateData) return publicData;
  const { personalPublications, ...privateFields } = privateData;
  const publications = [...(publicData?.publications ?? [])];
  const positions = new Map(publications.map((item, index) => [item.id, index]));
  for (const item of personalPublications ?? []) {
    const position = positions.get(item.id);
    if (position === undefined) { positions.set(item.id, publications.length); publications.push(item); }
    else if (item.updated_at > publications[position].updated_at) publications[position] = item;
  }
  return { ...privateFields, publications, sync: publicData?.sync ?? [] };
}
