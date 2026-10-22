import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { CANARY_DATABASE_ID, CANARY_DATABASE_NAME, runCanaryRestProbe } from "../scripts/probe-d1-rest-canary.mjs";

const accountId = "a".repeat(32), token = "synthetic_canary_token_1234567890123456";
test("sonda REST solo apunta a UUID canary y valida identidad antes de escribir", async () => {
  const sqlite = new DatabaseSync(":memory:");
  let writes = 0;
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    assert.ok(url.includes(`/accounts/${accountId}/d1/database/${CANARY_DATABASE_ID}`));
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${token}`);
    if (init?.method !== "POST") return Response.json({ success: true, result: { uuid: CANARY_DATABASE_ID, name: CANARY_DATABASE_NAME } });
    const { sql, params } = JSON.parse(String(init.body)) as { sql: string; params: string[] };
    assert.ok(sql.includes("_codex_rest_probe"));
    try {
      const statement = sqlite.prepare(sql);
      if (/^\s*SELECT/.test(sql)) return Response.json({ success: true, result: [{ success: true, results: statement.all(...params), meta: { rows_read: 1, rows_written: 0 } }] });
      const changed = Number(statement.run(...params).changes);
      writes += changed;
      return Response.json({ success: true, result: [{ success: true, results: [], meta: { rows_read: 0, rows_written: changed } }] });
    } catch { return Response.json({ success: false, result: [{ success: false }] }); }
  };
  const result = await runCanaryRestProbe({ accountId, token, fetcher });
  assert.equal(result.ok, true);
  assert.equal(writes, 2);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM _codex_rest_probe").get()?.n, 1);
  sqlite.close();
});

test("identidad equivocada detiene la sonda antes de cualquier SQL", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return Response.json({ success: true, result: { uuid: "wrong", name: CANARY_DATABASE_NAME } }); };
  await assert.rejects(runCanaryRestProbe({ accountId, token, fetcher }), /CANARY_IDENTITY_MISMATCH/);
  assert.equal(calls, 1);
});
