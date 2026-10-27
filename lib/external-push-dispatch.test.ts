import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { resolveExternalPushConfig, runExternalPushDispatch } from "../scripts/dispatch-push-external.mjs";
import { createD1Rest } from "../scripts/d1-rest.mjs";

const now = new Date("2026-10-27T12:00:00Z");
const environment = { VAPID_PUBLIC_KEY: "synthetic", VAPID_PRIVATE_KEY: "synthetic",
  VAPID_SUBJECT: "mailto:test@example.invalid" };

test("Node despacha dos avisos ficticios y repetir no duplica entregas", async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(readFileSync("scripts/push-canary-schema.sql", "utf8"));
    sqlite.exec(`INSERT INTO publications(id,title) VALUES('p1','Curso ficticio');
      INSERT INTO notifications(id,user_id,publication_id,type,scheduled_at,created_at) VALUES
        (1,'u1','p1','CAPACITACION_NUEVA','2026-10-27T11:00:00Z','2026-10-27T10:00:00Z'),
        (2,'u2','p1','CAPACITACION_NUEVA','2026-10-27T11:00:00Z','2026-10-27T10:00:00Z');
      INSERT INTO push_subscriptions(endpoint,user_id,p256dh,auth,active,created_at) VALUES
        ('https://fcm.googleapis.com/u1','u1','fake','fake',1,'2026-10-26T00:00:00Z'),
        ('https://fcm.googleapis.com/u2','u2','fake','fake',1,'2026-10-26T00:00:00Z');`);
    const db = createD1Rest({ accountId: "a".repeat(32), databaseId: "11111111-1111-1111-1111-111111111111",
      token: "local_synthetic_token_12345678901234567890", fetcher: async (_url: RequestInfo | URL, init?: RequestInit) => {
        const { sql, params } = JSON.parse(String(init?.body)) as { sql: string; params: string[] };
        const statement = sqlite.prepare(sql);
        const read = /^\s*SELECT\b/i.test(sql);
        const result = read ? { results: statement.all(...params), meta: { rows_read: 1, rows_written: 0 } } :
          { results: [], meta: { rows_read: 0, rows_written: Number(statement.run(...params).changes) } };
        return Response.json({ success: true, result: [{ ...result, success: true }] });
      } });
    let sends = 0;
    const provider = { send: async () => { sends++; return new Response(null, { status: 201 }); } };
    const first = await runExternalPushDispatch(db, environment, provider, { now: () => now, maxSteps: 3 });
    const repeated = await runExternalPushDispatch(db, environment, provider, { now: () => now, maxSteps: 3 });
    assert.equal(first.sent, 2);
    assert.equal(first.steps, 2);
    assert.equal(repeated.sent, 0);
    assert.equal(sends, 2);
    assert.ok(db.metrics().requests > 0);
    assert.equal((sqlite.prepare("SELECT COUNT(*) n FROM push_deliveries WHERE status='sent'").get() as { n: number }).n, 2);
  } finally { sqlite.close(); }
});

test("el ejecutor falla cerrado fuera de canary y no habilita envío real por defecto", () => {
  const base = { EXTERNAL_PUSH_ENABLED: "true", DIRECT_D1_WRITE_ENABLED: "true" };
  assert.equal(resolveExternalPushConfig(base).mode, "simulated");
  assert.equal(resolveExternalPushConfig(base).target.name, "docentetuc-fdci-canary-1-1");
  for (const invalid of [
    {}, { ...base, PUSH_SEND_MODE: "real" }, { ...base, DIRECT_D1_TARGET: "production" },
    { ...base, PUSH_SEND_MODE: "real", PUSH_REAL_SEND_ENABLED: "true", PUSH_DISPATCH_MODE: "worker" },
    { ...base, D1_DATABASE_ID: "baaf5886-0123-4948-96da-aa7106424549" },
  ]) assert.throws(() => resolveExternalPushConfig(invalid),
    /EXTERNAL_PUSH_DISABLED|EXTERNAL_PUSH_MODE_INVALID|PRODUCTION_D1_NOT_APPROVED|D1_DATABASE_OVERRIDE_FORBIDDEN/);
  const workflow = readFileSync(".github/workflows/push-dispatch-external.yml", "utf8");
  assert.match(workflow, /^  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+schedule:/m);
  assert.match(workflow, /PUSH_SEND_MODE: simulated/);
  assert.doesNotMatch(workflow, /PUSH_REAL_SEND_ENABLED|DIRECT_D1_TARGET: production/);
});
