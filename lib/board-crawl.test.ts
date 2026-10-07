import assert from "node:assert/strict";
import test from "node:test";
import { advanceBoardCrawl, boardCrawlReadyForNextCycle, boardQueueJson, initialBoardCrawl, restoreBoardCrawl } from "./board-crawl.ts";
import { parsePublicDrivePage, type DriveFolderPage, type DrivePublicEntry } from "./public-documents.ts";

const folder = (entries: unknown[]) => `<script>window['_DRIVE_ivd'] = '${JSON.stringify([entries]).replace(/[\[\]"]/g, (char) => `\\x${char.charCodeAt(0).toString(16)}`)}';</script>`;
const child = (id: string, parent: string, mime = "application/pdf") => [id, [parent], `${id}.pdf`, mime];

test("recorre subcarpetas por lotes y conserva identificadores únicos", async () => {
  const pages: Record<string, string> = {
    root: folder([child("sub", "root", "application/vnd.google-apps.folder"), child("a", "root"), child("a", "root")]),
    sub: folder([child("b", "sub")]),
  };
  const read = async (id: string) => parsePublicDrivePage(pages[id], id);
  const first = await advanceBoardCrawl("root", initialBoardCrawl("root"), read, 1, "2026-09-30T10:00:00.000Z");
  assert.equal(first.cycleCompleted, false);
  assert.deepEqual(first.state.queue.map(task => task.id), ["sub"]);
  assert.deepEqual(first.entries.map((entry) => entry.id).sort(), ["a", "sub"]);
  const second = await advanceBoardCrawl("root", first.state, read, 1, "2026-09-30T11:00:00.000Z");
  assert.equal(second.cycleCompleted, true);
  assert.deepEqual(second.entries.map((entry) => entry.id).sort(), ["a", "b", "sub"]);
  assert.equal(second.state.completedAt, "2026-09-30T11:00:00.000Z");
  pages.root = folder([child("b", "root")]);
  const third = await advanceBoardCrawl("root", { ...initialBoardCrawl("root"), snapshot: second.state.snapshot, completedAt: second.state.completedAt }, read, 1, "2026-10-08T12:00:00.000Z");
  assert.equal(third.cycleCompleted, true);
  assert.deepEqual(third.entries.map((entry) => entry.id), ["b"]);
});

test("una carpeta vacía es válida y un fallo no pierde la cola ni la instantánea", async () => {
  const empty = await advanceBoardCrawl("root", initialBoardCrawl("root"), async () => parsePublicDrivePage(folder([]), "root"), 1, "2026-09-30T10:00:00.000Z");
  assert.equal(empty.cycleCompleted, true);
  assert.deepEqual(empty.entries, []);
  const failed = await advanceBoardCrawl("root", { ...initialBoardCrawl("root"), snapshot: empty.state.snapshot, completedAt: empty.state.completedAt }, async () => { throw new Error("TIMEOUT"); }, 1, "2026-10-08T11:00:00.000Z");
  assert.equal(failed.error, "TIMEOUT");
  assert.equal(failed.cycleCompleted, false);
  assert.deepEqual(failed.state.queue.map(task => task.id), ["root"]);
  assert.equal(failed.state.completedAt, empty.state.completedAt);
});

test("si cambia el formato público, no se interpreta como carpeta vacía", async () => {
  const result = await advanceBoardCrawl("root", initialBoardCrawl("root"), async () => parsePublicDrivePage("<html>otro formato</html>", "root"), 1, "2026-09-30T10:00:00.000Z");
  assert.match(result.error || "", /FORMAT_CHANGED/);
  assert.deepEqual(result.state.queue.map(task => task.id), ["root"]);
});

// Synthetic fixtures only: these entries never enter a live D1.
const entries = (start: number, count: number): DrivePublicEntry[] => Array.from({ length: count }, (_, n) => ({ id: `synthetic-${start + n}`, name: `Test ${start + n}`, mimeType: "application/pdf", updatedAt: null }));
const now = "2026-10-06T12:00:00.000Z";
const storedState = (state: ReturnType<typeof initialBoardCrawl>) => ({ queue_json: boardQueueJson(state), visited_json: JSON.stringify(state.visited), working_json: JSON.stringify(state.working), snapshot_json: JSON.stringify(state.snapshot), completed_at: state.completedAt });

test("raíces terminadas esperan al resto y al guardado del conjunto antes del siguiente ciclo", () => {
  const complete = { ...initialBoardCrawl("root"), queue: [], completedAt: now };
  const states = Array.from({ length: 6 }, () => complete);
  assert.equal(boardCrawlReadyForNextCycle(states, null), false);
  assert.equal(boardCrawlReadyForNextCycle(states, "2026-10-05T00:00:00Z"), false);
  assert.equal(boardCrawlReadyForNextCycle([...states.slice(1), initialBoardCrawl("pending")], now), false);
  assert.equal(boardCrawlReadyForNextCycle(states, now), true);
});

test("50 + 30 entradas paginadas son 80 únicas y la continuación persiste entre ejecuciones", async () => {
  const read = async (_id: string, cursor: string | null): Promise<DriveFolderPage> => cursor ? { entries: entries(50, 30), nextCursor: null } : { entries: entries(0, 50), nextCursor: "page2" };
  const first = await advanceBoardCrawl("root", initialBoardCrawl("root"), read, 1, now);
  assert.equal(first.cycleCompleted, false);
  assert.equal(first.pagesProcessed, 1);
  assert.equal(first.pagesExpectedAtLeast, 2);
  assert.equal(first.state.visited.length, 0);
  const second = await advanceBoardCrawl("root", restoreBoardCrawl("root", storedState(first.state)), read, 1, now);
  assert.equal(second.cycleCompleted, true);
  assert.equal(second.entries.length, 80);
  assert.equal(second.pagesProcessed, 2);
  assert.equal(second.pagesExpectedAtLeast, 2);
});

test("deduplica páginas superpuestas, conserva fecha exacta y termina también con última página vacía", async () => {
  let calls = 0;
  const result = await advanceBoardCrawl("root", initialBoardCrawl("root"), async (_id, cursor) => {
    calls++;
    return !cursor ? { entries: entries(0, 50), nextCursor: "page2" } : cursor === "page2" ? { entries: entries(40, 40), nextCursor: "end" } : { entries: [], nextCursor: null };
  }, 3, now);
  assert.equal(result.cycleCompleted, true);
  assert.equal(result.entries.length, 80);
  assert.equal(calls, 3);
});

test("fallo de segunda página retiene el último conjunto y luego permite completar sin duplicar", async () => {
  const state = { ...initialBoardCrawl("root"), snapshot: entries(90, 1), completedAt: "2026-09-01T00:00:00Z" };
  const first = await advanceBoardCrawl("root", state, async (_id, cursor) => {
    if (cursor) throw new Error("HTTP_503");
    return { entries: entries(0, 50), nextCursor: "page2" };
  }, 2, now);
  assert.equal(first.cycleCompleted, false);
  assert.equal(first.error, "HTTP_503");
  assert.equal(first.entries.length, 51);
  assert.equal(first.state.completedAt, state.completedAt);
  const recovered = await advanceBoardCrawl("root", first.state, async () => ({ entries: entries(50, 30), nextCursor: null }), 1, now);
  assert.equal(recovered.cycleCompleted, true);
  assert.equal(recovered.entries.length, 80);
});

test("rechaza cursor repetido y ciclos de carpetas sin entrar en loops ni declarar OK", async () => {
  let calls = 0;
  const result = await advanceBoardCrawl("root", initialBoardCrawl("root"), async () => {
    calls++;
    return { entries: entries(0, 50), nextCursor: "same" };
  }, 20, now);
  assert.equal(calls, 2);
  assert.match(result.error || "", /repeated pagination cursor/);
  assert.equal(result.cycleCompleted, false);
  const cyclic = await advanceBoardCrawl("root", initialBoardCrawl("root"), async () => ({ entries: [{ ...entries(0, 1)[0], id: "root", mimeType: "application/vnd.google-apps.folder" }], nextCursor: null }), 20, now);
  assert.equal(cyclic.cycleCompleted, true);
  assert.equal(cyclic.pagesProcessed, 1);
});

test("una instantánea del conector antiguo se conserva pero deja de contar como completa", () => {
  const state = restoreBoardCrawl("root", { queue_json: '["root"]', visited_json: '[]', working_json: JSON.stringify(entries(0, 10)), snapshot_json: JSON.stringify(entries(0, 50)), completed_at: now });
  assert.equal(state.completedAt, null);
  assert.equal(state.snapshot.length, 50);
  assert.equal(state.queue[0].id, "root");
});

test("vista completa debe contener la primera página y conserva sus fechas exactas", async () => {
  const initial = entries(0, 50);
  initial[0].updatedAt = now;
  const first = await advanceBoardCrawl("root", initialBoardCrawl("root"), async () => ({ entries: initial, nextCursor: "embedded" }), 1, now);
  const failed = await advanceBoardCrawl("root", first.state, async () => ({ entries: [], nextCursor: null, fullListing: true }), 1, now);
  assert.equal(failed.cycleCompleted, false);
  assert.match(failed.error || "", /inconsistent/);
  const complete = await advanceBoardCrawl("root", first.state, async () => ({ entries: entries(0, 80), nextCursor: null, fullListing: true }), 1, now);
  assert.equal(complete.entries.length, 80);
  assert.equal(complete.entries[0].updatedAt, now);
  const cached = await advanceBoardCrawl("root", complete.state, async () => { throw new Error("Should not fetch"); }, 2, now);
  assert.equal(cached.cycleCompleted, true);
  assert.equal(cached.entries.length, 80);
});
