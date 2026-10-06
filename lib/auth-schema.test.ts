import assert from "node:assert/strict";
import test from "node:test";
import { hasAccountIdentitySchema, hasAuthSchema } from "./auth-schema.ts";

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

test("las operaciones de identidad requieren la tabla aditiva de instalaciones", async () => {
  const database = {
    prepare: () => ({ bind: () => ({ first: async <T>() => ({ count: 1 } as T) }) }),
  };
  assert.equal(await hasAccountIdentitySchema(database), true);
  const unavailable = { prepare: () => ({ bind: () => ({ first: async () => { throw new Error("missing schema"); } }) }) };
  assert.equal(await hasAccountIdentitySchema(unavailable), false);
});
