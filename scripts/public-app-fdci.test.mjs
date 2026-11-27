import assert from "node:assert/strict";
import test from "node:test";
import { getPublicApp } from "../lib/public-app.ts";

const sync = [
  { source: "Capacitación Docente", sync_status: "OK", last_successful_sync_at: "2026-10-11T12:00:00Z" },
  { source: "INFoD / AulaS-TIC", sync_status: "OK", last_successful_sync_at: "2026-11-27T12:00:00Z" },
];

function source(checkpoint) {
  return () => ({ prepare(sql) {
    if (sql.includes("row_hex")) return { raw: async () => [] };
    if (sql.includes("FROM sync_state")) return { all: async () => ({ results: sync }) };
    if (sql.includes("FROM fdci_import_checkpoint")) return { first: async () => checkpoint };
    throw new Error("UNEXPECTED_SQL");
  } });
}

test("the public snapshot reports the FDCI checkpoint without changing INFoD", async () => {
  const request = new Request("https://local.invalid/api/public-app");
  const settings = { PUBLIC_APP_CACHE_ENABLED: "false" };
  const complete = await getPublicApp(request, source({ upper_key: "", last_cycle_status: "OK",
    last_completed_at: "2026-11-27T14:00:00Z" }), settings);
  assert.equal(complete.status, 200);
  const healthy = (await complete.json()).sync;
  assert.equal(healthy.find(row => row.source === "Capacitación Docente").last_successful_sync_at, "2026-11-27T14:00:00Z");
  assert.deepEqual(healthy.find(row => row.source === "INFoD / AulaS-TIC"), sync[1]);

  const partial = await getPublicApp(request, source({ upper_key: "000000003114:000000006436",
    last_cycle_status: "OK", last_completed_at: "2026-11-27T14:00:00Z" }), settings);
  const stale = (await partial.json()).sync.find(row => row.source === "Capacitación Docente");
  assert.equal(stale.sync_status, "PARTIAL");
  assert.equal(stale.last_successful_sync_at, "2026-11-27T14:00:00Z");
});
