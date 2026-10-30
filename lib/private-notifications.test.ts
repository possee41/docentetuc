import assert from "node:assert/strict";
import test from "node:test";
import { privateNotifications, readPrivateNotification } from "./private-notifications.ts";

test("lector compatible con esquema anterior; no oculta fallos D1 ajenos", async () => {
  const sqls: string[] = [];
  const db = { prepare(sql: string) { sqls.push(sql); return { bind: (...args: (string | number)[]) => ({
    all: async () => {
      assert.ok(args.every(value => value === "owner"));
      if (sqls.length === 1) throw Error("D1_ERROR: no such column: q.internal_read: SQLITE_ERROR");
      return { results: [] };
    }, run: async () => ({}),
  }) }; } };
  assert.deepEqual(await privateNotifications(db, "owner"), { results: [] });
  assert.equal(sqls.length, 2);
  for (const message of ["D1_UNAVAILABLE", "no such table: manual_event_push_queue", "AUTH_DENIED"]) {
    const failed = { prepare: () => { throw Error(message); } } as unknown as Parameters<typeof privateNotifications>[0];
    await assert.rejects(privateNotifications(failed, "owner"), new RegExp(message));
  }
  for (const id of [0, NaN, 1.2, Infinity]) await assert.rejects(readPrivateNotification(db, "owner", id), /INVALID_NOTIFICATION_ID/);
});
