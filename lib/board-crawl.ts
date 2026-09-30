import { parsePublicDriveFolder, type DrivePublicEntry } from "./public-documents.ts";

export type BoardCrawlState = {
  queue: string[];
  visited: string[];
  working: DrivePublicEntry[];
  snapshot: DrivePublicEntry[];
  completedAt: string | null;
};

export const initialBoardCrawl = (rootId: string): BoardCrawlState => ({ queue: [rootId], visited: [], working: [], snapshot: [], completedAt: null });

export async function advanceBoardCrawl(
  rootId: string,
  state: BoardCrawlState,
  readFolder: (id: string) => Promise<string>,
  limit: number,
  now: string,
) {
  const queue = [...state.queue], visited = new Set(state.visited), working = new Map(state.working.map((entry) => [entry.id, entry]));
  let error: string | null = null;
  for (let scanned = 0; queue.length && scanned < limit; scanned++) {
    const id = queue.shift()!;
    if (visited.has(id)) { scanned--; continue; }
    try {
      const html = await readFolder(id);
      const entries = parsePublicDriveFolder(html, id);
      visited.add(id);
      for (const entry of entries) {
        working.set(entry.id, entry);
        if (entry.mimeType === "application/vnd.google-apps.folder" && !visited.has(entry.id) && !queue.includes(entry.id)) queue.push(entry.id);
      }
    } catch (cause) {
      queue.unshift(id);
      error = cause instanceof Error ? cause.message : String(cause);
      break;
    }
  }
  const cycleCompleted = !queue.length && !error;
  const next: BoardCrawlState = cycleCompleted
    ? { queue: [rootId], visited: [], working: [], snapshot: [...working.values()], completedAt: now }
    : { queue, visited: [...visited], working: [...working.values()], snapshot: state.snapshot, completedAt: state.completedAt };
  return { state: next, cycleCompleted, error, entries: [...new Map([...next.snapshot, ...next.working].map((entry) => [entry.id, entry])).values()] };
}
