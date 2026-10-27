import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { resolveExternalPushConfig, runExternalPushDispatch } from "../scripts/dispatch-push-external.mjs";
import { createD1Rest } from "../scripts/d1-rest.mjs";
import { verifyDirectD1Identity } from "../scripts/import-direct-d1.mjs";

const now = new Date("2026-10-27T12:00:00Z");
const environment = { VAPID_PUBLIC_KEY: "synthetic", VAPID_PRIVATE_KEY: "synthetic",
  VAPID_SUBJECT: "mailto:test@example.invalid" };
const require = createRequire(import.meta.url);

test("Node despacha dos avisos ficticios en D1 canary efímera y repetir no duplica entregas", async () => {
  const { Miniflare } = require("../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare");
  const mf = new Miniflare({ modules: true,
    script: "export default { fetch() { return new Response('isolated'); } }", d1Databases: ["DB"] });
  try {
    const raw = await mf.getD1Database("DB");
    const setup = `${readFileSync("scripts/push-canary-schema.sql", "utf8")}
      INSERT INTO publications(id,title) VALUES('p1','Curso ficticio');
      INSERT INTO notifications(id,user_id,publication_id,type,scheduled_at,created_at) VALUES
        (1,'u1','p1','CAPACITACION_NUEVA','2026-10-27T11:00:00Z','2026-10-27T10:00:00Z'),
        (2,'u2','p1','CAPACITACION_NUEVA','2026-10-27T11:00:00Z','2026-10-27T10:00:00Z');
      INSERT INTO push_subscriptions(endpoint,user_id,p256dh,auth,active,created_at) VALUES
        ('https://fcm.googleapis.com/u1','u1','fake','fake',1,'2026-10-26T00:00:00Z'),
        ('https://fcm.googleapis.com/u2','u2','fake','fake',1,'2026-10-26T00:00:00Z');`;
    for (const sql of setup.replace(/^--.*$/gm, "").split(";").map((part) => part.trim()).filter(Boolean))
      await raw.prepare(sql).run();
    const accountId = "a".repeat(32), databaseId = "11111111-1111-1111-1111-111111111111";
    const token = "local_synthetic_token_12345678901234567890";
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      assert.match(url, new RegExp(`^https://api\\.cloudflare\\.com/client/v4/accounts/${accountId}/d1/database/${databaseId}`));
      assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${token}`);
      if (init?.method !== "POST") {
        const marker = await raw.prepare("SELECT marker FROM push_canary_identity").first() as { marker: string } | null;
        assert.equal(marker?.marker, "docentetuc-push-canary-1-2");
        return Response.json({ success: true,
          result: { uuid: databaseId, name: marker.marker } });
      }
      const { sql, params } = JSON.parse(String(init.body)) as { sql: string; params: string[] };
      const statement = raw.prepare(sql).bind(...params);
      const result = /^\s*SELECT\b/i.test(sql) ? await statement.all() : await statement.run();
      return Response.json({ success: true, result: [{ ...result, success: true }] });
    };
    await verifyDirectD1Identity({ accountId, token,
      target: { id: databaseId, name: "docentetuc-push-canary-1-2" }, fetcher });
    const db = createD1Rest({ accountId: "a".repeat(32), databaseId: "11111111-1111-1111-1111-111111111111",
      token, fetcher });
    let sends = 0;
    const provider = { send: async () => { sends++; return new Response(null, { status: 201 }); } };
    const first = await runExternalPushDispatch(db, environment, provider, { now: () => now, maxSteps: 3 });
    const repeated = await runExternalPushDispatch(db, environment, provider, { now: () => now, maxSteps: 3 });
    assert.equal(first.sent, 2);
    assert.equal(first.steps, 2);
    assert.equal(repeated.sent, 0);
    assert.equal(sends, 2);
    assert.ok(db.metrics().requests > 0);
    assert.ok(db.metrics().rowsWritten > 0);
    assert.equal((await raw.prepare("SELECT COUNT(*) n FROM push_deliveries WHERE status='sent'").first() as { n: number } | null)?.n, 2);
  } finally { await mf.dispose(); }
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
