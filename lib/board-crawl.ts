import { type DriveFolderPage, type DrivePublicEntry } from "./public-documents.ts";

type FolderTask = { id: string; cursor: string | null; seen: string[]; entryIds: string[] };
const folderTask = (id: string): FolderTask => ({ id, cursor: null, seen: [], entryIds: [] });
export type BoardCrawlState = {
  queue: FolderTask[];
  visited: string[];
  working: DrivePublicEntry[];
  snapshot: DrivePublicEntry[];
  completedAt: string | null;
  pagesProcessed: number;
};

export const initialBoardCrawl = (rootId: string): BoardCrawlState => ({ queue: [folderTask(rootId)], visited: [], working: [], snapshot: [], completedAt: null, pagesProcessed: 0 });

// Version the existing JSON column, not the database schema. Old snapshots may
// have silently stopped at 50: keep their records but require a fresh full scan.
export function restoreBoardCrawl(rootId: string, stored: { queue_json: string; visited_json: string; working_json: string; snapshot_json: string; completed_at: string | null }): BoardCrawlState {
  const queue = JSON.parse(stored.queue_json);
  const snapshot = JSON.parse(stored.snapshot_json) as DrivePublicEntry[], working = JSON.parse(stored.working_json) as DrivePublicEntry[];
  if (queue?.version !== 2) return { ...initialBoardCrawl(rootId), snapshot: [...new Map([...snapshot, ...working].map(entry => [entry.id, entry])).values()] };
  return { queue: queue.pending, pagesProcessed: queue.pagesProcessed, visited: JSON.parse(stored.visited_json), working, snapshot, completedAt: stored.completed_at };
}

export const boardQueueJson = (state: BoardCrawlState) => JSON.stringify({ version: 2, pending: state.queue, pagesProcessed: state.pagesProcessed });

// Start the next continuous scan only after all roots were completed AND their
// snapshot was published by sync. Faster roots must not restart while others
// are still pending. This does not introduce a new refresh interval.
export function boardCrawlReadyForNextCycle(states: BoardCrawlState[], lastSuccessfulAt: string | null) {
  return states.length === 6 && Boolean(lastSuccessfulAt) && states.every(state =>
    !state.queue.length && state.completedAt && Date.parse(lastSuccessfulAt!) >= Date.parse(state.completedAt));
}

export async function advanceBoardCrawl(
  rootId: string,
  state: BoardCrawlState,
  readPage: (id: string, cursor: string | null) => Promise<DriveFolderPage>,
  limit: number,
  now: string,
) {
  if (!rootId) throw new Error("SCHEMA_ERROR Drive root missing");
  const queue = [...state.queue], visited = new Set(state.visited), working = new Map(state.working.map((entry) => [entry.id, entry]));
  let error: string | null = null, pagesProcessed = state.pagesProcessed;
  for (let scanned = 0; queue.length && scanned < limit; scanned++) {
    const task = queue.shift()!;
    if (visited.has(task.id)) { scanned--; continue; }
    try {
      if (task.seen.length >= 100 || pagesProcessed >= 20_000) throw new Error("PARTIAL Drive crawl safety limit reached");
      const page = await readPage(task.id, task.cursor);
      const seen = [...task.seen, task.cursor ?? "first"];
      if (page.nextCursor && seen.includes(page.nextCursor)) throw new Error("PARTIAL Drive repeated pagination cursor");
      if (page.fullListing && task.entryIds.some(id => !page.entries.some(entry => entry.id === id))) throw new Error("PARTIAL Drive full listing inconsistent with first page");
      pagesProcessed++;
      for (const entry of page.entries) {
        const previous = working.get(entry.id);
        working.set(entry.id, { ...entry, updatedAt: entry.updatedAt ?? previous?.updatedAt ?? null });
        if (entry.mimeType === "application/vnd.google-apps.folder" && entry.id !== task.id && !visited.has(entry.id) && !queue.some(pending => pending.id === entry.id)) queue.push(folderTask(entry.id));
      }
      if (page.nextCursor) queue.unshift({ id: task.id, cursor: page.nextCursor, seen, entryIds: [...new Set([...task.entryIds, ...page.entries.map(entry => entry.id)])] });
      else visited.add(task.id);
    } catch (cause) {
      queue.unshift(task);
      error = cause instanceof Error ? cause.message : String(cause);
      break;
    }
  }
  const cycleCompleted = !queue.length && !error;
  const next: BoardCrawlState = {
    queue, visited: [...visited], pagesProcessed,
    working: cycleCompleted ? [] : [...working.values()],
    snapshot: cycleCompleted && state.queue.length ? [...working.values()] : state.snapshot,
    completedAt: cycleCompleted ? state.completedAt && !state.queue.length ? state.completedAt : now : state.completedAt,
  };
  return { state: next, cycleCompleted, error, pagesProcessed, pagesExpectedAtLeast: pagesProcessed + queue.length,
    entries: [...new Map([...next.snapshot, ...next.working].map(entry => [entry.id, entry])).values()] };
}
