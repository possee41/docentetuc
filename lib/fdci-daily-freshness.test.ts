import test from "node:test";
import assert from "node:assert/strict";
import { fdciDailyCheckOverdue, buildFdciActiveVersion, createFdciVersionedReader, FDCI_RAW_ACTIVE_URL } from "./fdci-static-publication.ts";
import { fdciCatalogMessage } from "./fdci-catalog-integration.ts";
import { buildFdciCatalog } from "./fdci-static-catalog.ts";

test("yesterday's empty catalog becomes uncertain after the daily check grace period", () => {
  const yesterday = "2026-11-08T16:54:09.675Z";
  assert.equal(fdciDailyCheckOverdue(yesterday, Date.parse("2026-11-09T10:36:59Z")), false);
  assert.equal(fdciDailyCheckOverdue(yesterday, Date.parse("2026-11-09T10:37:00Z")), true);
  assert.equal(fdciDailyCheckOverdue("2026-11-09T09:40:00Z", Date.parse("2026-11-09T11:00:00Z")), false);
  assert.equal(fdciDailyCheckOverdue("2026-11-09T02:50:00Z", Date.parse("2026-11-09T11:00:00Z")), true);
  assert.doesNotMatch(fdciCatalogMessage("stale", 0), /No hay inscripciones activas verificadas/);
});

test("real reader validates checksums but does not call yesterday's empty snapshot current", async () => {
  const catalog = await buildFdciCatalog([], "2026-11-08T16:54:09.675Z");
  const pointer = await buildFdciActiveVersion({ generation: 5, stateChecksum: "a".repeat(64),
    stateRevision: "b".repeat(40), codeSha: "c".repeat(40), catalogSha256: catalog.sha256,
    catalogUpdatedAt: catalog.updatedAt, lastAttempt: { at: catalog.updatedAt, status: "complete", error: null } });
  const reader = createFdciVersionedReader(FDCI_RAW_ACTIVE_URL,
    (async input => Response.json(String(input).endsWith("active.json") ? pointer : catalog)) as typeof fetch,
    () => Date.parse("2026-11-09T11:00:00Z"));
  const view = await reader();
  assert.equal(view.status, "stale");
  assert.equal(view.generation, 5);
  assert.equal(view.catalogSha256, catalog.sha256);
  assert.deepEqual(view.items, []);
  assert.equal(view.error, null);
});
