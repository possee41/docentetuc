import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { readSyncHealth } from "./sync-health.ts";

test("el estado de cada fuente conserva último éxito y parcialidad sin escribir en D1", async () => {
  const raw = new DatabaseSync(":memory:");
  try {
    raw.exec(`CREATE TABLE sync_state(source TEXT PRIMARY KEY,sync_status TEXT,
      last_attempt_at TEXT,last_successful_sync_at TEXT);
      INSERT INTO sync_state VALUES('SIME','OK','2026-10-26T12:00:00Z','2026-10-26T12:00:00Z');
      INSERT INTO sync_state VALUES('Comunicados','PARTIAL','2026-10-26T13:00:00Z','2026-10-25T12:00:00Z');`);
    const db = { prepare: (sql: string) => ({ all: async () => ({ results: raw.prepare(sql).all() }) }) };
    const before = raw.prepare("SELECT total_changes() AS count").get()?.count;
    const state = await readSyncHealth(db as never);
    assert.deepEqual(state.map(({ source, sync_status }) => [source, sync_status]),
      [["Comunicados", "PARTIAL"], ["SIME", "OK"]]);
    assert.equal(state[0].last_successful_sync_at, "2026-10-25T12:00:00Z");
    assert.equal(raw.prepare("SELECT total_changes() AS count").get()?.count, before);
  } finally { raw.close(); }
});

test("/api/sync solo lee salud y no importa ningún recolector del Worker", () => {
  const route = readFileSync(new URL("../app/api/sync/route.ts", import.meta.url), "utf8");
  assert.match(route, /readSyncHealth\(getD1\(\)\)/);
  assert.match(route, /external_importers_only/);
  assert.doesNotMatch(route, /runSync|collectSourcePages|SELECT .* FROM publications|INSERT INTO notifications/);
});
