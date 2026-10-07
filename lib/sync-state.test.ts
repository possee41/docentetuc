import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { assessSourceSync, SourceSyncError } from "./publication-lifecycle.ts";

test("el agregador real separa categoría sin datos por error, recuperación parcial y recorrido completo", () => {
  const route = readFileSync(new URL("../app/api/sync/route.ts", import.meta.url), "utf8");
  const block = route.match(/(const health = sourceHealthNames\.map\([\s\S]*?)\n  const sourceHealthByPublication/)![1];
  const evaluate = new Function("sourceHealthNames", "sourceGroup", "collected", "assessSourceSync", `${block}\nreturn health;`);
  const result = evaluate(["Padrones", "Llamados abiertos", "Comunicados"], (category: string) => ({
    source: "Padrones y Comunicados", filter: (item: { category: string }) => item.category === category, oldRows: [],
  }), [{ source: "Padrones y Comunicados", items: [{ category: "Padrones" }, { category: "Comunicados" }], incompleteCategories: ["Padrones", "Llamados abiertos"], categoryErrors: { "Llamados abiertos": new SourceSyncError("HTTP_ERROR", "HTTP_503", "HTTP_503") }, error: null }], assessSourceSync);
  assert.deepEqual(result.map((row: { status: string }) => row.status), ["PARTIAL", "HTTP_ERROR", "OK"]);
});

test("el SQL real de sincronización conserva el último éxito ante fallo/parcialidad y actualiza al recuperarse", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const schema = readFileSync(new URL("../drizzle/0000_docentetuc.sql", import.meta.url), "utf8");
    db.exec(schema.match(/CREATE TABLE `sync_state` \([\s\S]*?\);/)![0]);
    for (const file of ["0009_reliability_lifecycle.sql", "0010_data_freshness.sql"]) {
      const migration = readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8");
      for (const statement of migration.match(/ALTER TABLE sync_state[^;]+;/g) || []) db.exec(statement);
    }
    // Exercise the route's statements, not a separate simulation of its timestamp rules.
    const route = readFileSync(new URL("../app/api/sync/route.ts", import.meta.url), "utf8");
    const attempt = db.prepare(route.match(/`(INSERT INTO sync_state[\s\S]*?)`/)![1]);
    const finish = db.prepare(route.match(/`(UPDATE sync_state SET[\s\S]*?WHERE source=\?)`/)![1]);
    const run = (status: string, at: string, count: number) => {
      attempt.run("synthetic-only", at);
      finish.run(status, at, status, count, status, "safe-test", status, at, status, 0, at, 0, 0, 0, 0, status, status === "OK" ? null : status, status === "OK" ? null : "safe-test", "synthetic-only");
      return db.prepare("SELECT * FROM sync_state WHERE source='synthetic-only'").get()!;
    };
    const first = run("NETWORK_ERROR", "2026-10-01T01:00:00Z", 0);
    assert.equal(first.last_successful_sync_at, null);
    const success = run("OK", "2026-10-01T02:00:00Z", 250);
    assert.equal(success.last_successful_sync_at, success.last_attempt_at);
    const failure = run("TIMEOUT", "2026-10-01T03:00:00Z", 0);
    assert.equal(failure.last_attempt_at, "2026-10-01T03:00:00Z");
    assert.equal(failure.last_successful_sync_at, success.last_successful_sync_at);
    assert.equal(failure.synced_at, success.synced_at);
    assert.equal(failure.item_count, 250);
    assert.equal(run("PARTIAL", "2026-10-01T04:00:00Z", 12).last_successful_sync_at, success.last_successful_sync_at);
    const recovered = run("OK", "2026-10-01T05:00:00Z", 251);
    assert.equal(recovered.last_successful_sync_at, recovered.last_attempt_at);
    assert.equal(recovered.item_count, 251);
    assert.equal(recovered.error, null);
  } finally { db.close(); }
});
