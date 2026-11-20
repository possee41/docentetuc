import assert from "node:assert/strict";
import test from "node:test";
import { fdciSyncStatus } from "./fdci-sync-status.ts";
import { sourceHealth } from "./source-health.ts";

const old = [{ source: "Capacitación Docente", sync_status: "OK", last_successful_sync_at: "2026-10-11T12:00:00Z",
  last_attempt_at: "2026-10-29T05:00:00Z" }, { source: "INFoD / AulaS-TIC", sync_status: "OK", last_successful_sync_at: "2026-11-14T12:00:00Z" }];

test("el ciclo FDCI completado reemplaza la salud antigua sin cambiar INFoD", () => {
  const updated = fdciSyncStatus(old, { upper_key: "", last_cycle_status: "OK", last_completed_at: "2026-11-14T14:00:00Z" });
  assert.equal(sourceHealth(updated.find(row => row.source === "Capacitación Docente"), new Date("2026-11-14T15:00:00Z")), "current");
  assert.deepEqual(updated.find(row => row.source === "INFoD / AulaS-TIC"), old[1]);
});

test("un ciclo FDCI incompleto o viejo nunca habilita alertas por una fecha OK anterior", () => {
  const incomplete = fdciSyncStatus(old, { upper_key: "000000003116:999999999999", last_cycle_status: "OK", last_completed_at: "2026-11-14T14:00:00Z" });
  assert.equal(sourceHealth(incomplete.find(row => row.source === "Capacitación Docente"), new Date("2026-11-14T15:00:00Z")), "failed");
  const stale = fdciSyncStatus(old, { upper_key: "", last_cycle_status: "OK", last_completed_at: "2026-11-01T10:25:46Z" });
  assert.equal(sourceHealth(stale.find(row => row.source === "Capacitación Docente"), new Date("2026-11-14T15:00:00Z")), "stale");
  assert.deepEqual(fdciSyncStatus(old, null), old);
});
