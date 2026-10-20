import type { AppData } from "./types";

export type PrivateAppData = Omit<AppData, "publications" | "sync">;

// Public catalog and source health have one owner: /api/public-app.
export function combineAppData(publicData: AppData | null, privateData: PrivateAppData | null): AppData | null {
  if (!privateData) return publicData;
  return { ...privateData, publications: publicData?.publications ?? [], sync: publicData?.sync ?? [] };
}
