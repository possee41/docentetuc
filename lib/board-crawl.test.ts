import assert from "node:assert/strict";
import test from "node:test";
import { advanceBoardCrawl, initialBoardCrawl } from "./board-crawl.ts";

const folder = (entries: unknown[]) => `<script>window['_DRIVE_ivd'] = '${JSON.stringify([entries]).replace(/[\[\]"]/g, (char) => `\\x${char.charCodeAt(0).toString(16)}`)}';</script>`;
const child = (id: string, parent: string, mime = "application/pdf") => [id, [parent], `${id}.pdf`, mime];

test("recorre subcarpetas por lotes y conserva identificadores únicos", async () => {
  const pages: Record<string, string> = {
    root: folder([child("sub", "root", "application/vnd.google-apps.folder"), child("a", "root"), child("a", "root")]),
    sub: folder([child("b", "sub")]),
  };
  const first = await advanceBoardCrawl("root", initialBoardCrawl("root"), async (id) => pages[id], 1, "2026-09-30T10:00:00.000Z");
  assert.equal(first.cycleCompleted, false);
  assert.deepEqual(first.state.queue, ["sub"]);
  assert.deepEqual(first.entries.map((entry) => entry.id).sort(), ["a", "sub"]);
  const second = await advanceBoardCrawl("root", first.state, async (id) => pages[id], 1, "2026-09-30T11:00:00.000Z");
  assert.equal(second.cycleCompleted, true);
  assert.deepEqual(second.entries.map((entry) => entry.id).sort(), ["a", "b", "sub"]);
  assert.equal(second.state.completedAt, "2026-09-30T11:00:00.000Z");
  pages.root = folder([child("b", "root")]);
  const third = await advanceBoardCrawl("root", second.state, async (id) => pages[id], 1, "2026-09-30T12:00:00.000Z");
  assert.equal(third.cycleCompleted, true);
  assert.deepEqual(third.entries.map((entry) => entry.id), ["b"]);
});

test("una carpeta vacía es válida y un fallo no pierde la cola ni la instantánea", async () => {
  const empty = await advanceBoardCrawl("root", initialBoardCrawl("root"), async () => folder([]), 1, "2026-09-30T10:00:00.000Z");
  assert.equal(empty.cycleCompleted, true);
  assert.deepEqual(empty.entries, []);
  const failed = await advanceBoardCrawl("root", empty.state, async () => { throw new Error("TIMEOUT"); }, 1, "2026-09-30T11:00:00.000Z");
  assert.equal(failed.error, "TIMEOUT");
  assert.equal(failed.cycleCompleted, false);
  assert.deepEqual(failed.state.queue, ["root"]);
  assert.equal(failed.state.completedAt, empty.state.completedAt);
});

test("si cambia el formato público, no se interpreta como carpeta vacía", async () => {
  const result = await advanceBoardCrawl("root", initialBoardCrawl("root"), async () => "<html>otro formato</html>", 1, "2026-09-30T10:00:00.000Z");
  assert.match(result.error || "", /FORMAT_CHANGED/);
  assert.deepEqual(result.state.queue, ["root"]);
});
