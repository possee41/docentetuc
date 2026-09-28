import test from "node:test";
import assert from "node:assert/strict";
import { diffByHash } from "./sync-diff.ts";

test("una segunda sincronización idéntica no vuelve a escribir publicaciones", () => {
  const current = [{ id: "a", source: "SIME", contentHash: "1" }, { id: "b", source: "FDCI", contentHash: "2" }];
  const first = diffByHash(new Map(), current);
  assert.equal(first.writes.length, 2);
  const stored = new Map(current.map((item) => [item.id, { content_hash: item.contentHash }]));
  const second = diffByHash(stored, current);
  assert.equal(second.writes.length, 0);
  assert.equal(second.unchanged.length, 2);
});

test("sólo escribe filas nuevas o cuyo hash cambió", () => {
  const previous = new Map([["same", { content_hash: "1" }], ["changed", { content_hash: "old" }]]);
  const result = diffByHash(previous, [{ id: "same", source: "SIME", contentHash: "1" }, { id: "changed", source: "SIME", contentHash: "new" }, { id: "new", source: "SIME", contentHash: "3" }]);
  assert.deepEqual(result.writes.map((item) => item.id), ["changed", "new"]);
});
