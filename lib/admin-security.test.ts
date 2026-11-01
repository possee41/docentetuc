import assert from "node:assert/strict";
import test from "node:test";
import type { CommunityDatabase } from "./community.ts";
import { isCommunityAdmin, requireCommunityAdmin } from "./community-admin.ts";
import { adminNewsSummary } from "./admin-data.ts";
import { listNewsSources } from "./news-admin.ts";

function databaseWithPrepare(implementation: (sql: string) => unknown): CommunityDatabase {
  return { prepare: (sql: string) => implementation(sql) } as unknown as CommunityDatabase;
}

test("un usuario sin permisos administrativos no se considera admin", async () => {
  const database = databaseWithPrepare(() => ({ bind: () => ({ first: async () => null }) }));
  assert.equal(await isCommunityAdmin(database, "12345678-1234-4234-8234-123456789abc"), false);
  assert.equal(await isCommunityAdmin(database, "no-es-uuid"), false);
  await assert.rejects(requireCommunityAdmin(database, "12345678-1234-4234-8234-123456789abc"), /MODERATOR_REQUIRED/);
});

test("la ausencia de tablas opcionales no se confunde con un resultado vacío exitoso", async () => {
  const missingTable = databaseWithPrepare(() => ({
    bind: () => ({ all: async () => { throw new Error("no such table: news_items"); } }),
  }));
  assert.deepEqual(await adminNewsSummary(missingTable), { counts: {}, sources: [] });
  assert.deepEqual(await listNewsSources(missingTable), []);

  const realFailure = databaseWithPrepare(() => ({
    bind: () => ({ all: async () => { throw new Error("D1_ERROR: connection lost"); } }),
  }));
  await assert.rejects(adminNewsSummary(realFailure), /D1_ERROR: connection lost/);
  await assert.rejects(listNewsSources(realFailure), /D1_ERROR: connection lost/);
});