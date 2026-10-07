import assert from "node:assert/strict";
import test from "node:test";
import { hasAccountIdentitySchema, hasAuthSchema, hasCommunitySavedPostsSchema, hasCommunitySchema, hasInstallationCredentialsSchema } from "./auth-schema.ts";

test("auth D1 schema gate enables auth only when all required tables exist", async () => {
  let boundValues: string[] = [];
  const database = {
    prepare: () => ({
      bind: (...values: string[]) => {
        boundValues = values;
        return { first: async <T>() => ({ count: 4 } as T) };
      },
    }),
  };

  assert.equal(await hasAuthSchema(database), true);
  assert.deepEqual(boundValues, ["user", "session", "account", "verification"]);
});

for (const count of [0, 1, 3, null]) {
  test(`auth D1 schema gate fails closed when only ${count ?? "no"} auth tables exist`, async () => {
    const database = {
      prepare: () => ({
        bind: () => ({ first: async <T>() => count === null ? null : ({ count } as T) }),
      }),
    };
    assert.equal(await hasAuthSchema(database), false);
  });
}

test("auth D1 schema gate fails closed when D1 is unavailable", async () => {
  const database = {
    prepare: () => ({ bind: () => ({ first: async () => { throw new Error("D1 unavailable"); } }) }),
  };
  assert.equal(await hasAuthSchema(database), false);
});

test("Comunidad requiere todas las tablas nuevas antes de habilitar endpoints", async () => {
  let names: string[] = [];
  const database = {
    prepare: (sql: string) => ({
      bind: (...values: string[]) => {
        names = values;
        assert.match(sql, /sqlite_master/u);
        return { first: async <T>() => ({ count: 8 } as T) };
      },
    }),
  };
  assert.equal(await hasCommunitySchema(database), true);
  assert.deepEqual(names, [
    "community_rules_acceptances", "community_moderators", "community_posts", "community_comments",
    "community_reports", "community_blocks", "community_moderation_events", "community_rate_limits",
  ]);
  const partial = { prepare: () => ({ bind: () => ({ first: async <T>() => ({ count: 7 } as T) }) }) };
  assert.equal(await hasCommunitySchema(partial), false);
  const unavailable = { prepare: () => ({ bind: () => ({ first: async () => { throw new Error("D1 unavailable"); } }) }) };
  assert.equal(await hasCommunitySchema(unavailable), false);
});

test("las operaciones de identidad requieren la tabla aditiva de instalaciones", async () => {
  const database = {
    prepare: () => ({ bind: () => ({ first: async <T>() => ({ count: 1 } as T) }) }),
  };
  assert.equal(await hasAccountIdentitySchema(database), true);
  const unavailable = { prepare: () => ({ bind: () => ({ first: async () => { throw new Error("missing schema"); } }) }) };
  assert.equal(await hasAccountIdentitySchema(unavailable), false);
});

test("Guardadas requiere su tabla aditiva sin deshabilitar el esquema base de Comunidad", async () => {
  const database = {
    prepare: () => ({ bind: (name: string) => ({ first: async <T>() => ({ count: name === "community_saved_posts" ? 1 : 0 } as T) }) }),
  };
  assert.equal(await hasCommunitySavedPostsSchema(database), true);
  const partial = { prepare: () => ({ bind: () => ({ first: async <T>() => ({ count: 0 } as T) }) }) };
  assert.equal(await hasCommunitySavedPostsSchema(partial), false);
});

test("credenciales de instalación solo se habilitan con la migración aditiva", async () => {
  const ready = { prepare: () => ({ bind: () => ({ first: async <T>() => ({ count: 1 } as T) }) }) };
  const missing = { prepare: () => ({ bind: () => ({ first: async <T>() => ({ count: 0 } as T) }) }) };
  assert.equal(await hasInstallationCredentialsSchema(ready), true);
  assert.equal(await hasInstallationCredentialsSchema(missing), false);
});
