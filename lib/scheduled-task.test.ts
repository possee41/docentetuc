import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runScheduledTask, SCHEDULED_TASKS } from "../scripts/scheduled-task.mjs";

test("retención y push tienen invocaciones distintas; el disparador de sync retirado no escribe", async () => {
  const config = JSON.parse(readFileSync(new URL("../wrangler.cloudflare.jsonc", import.meta.url), "utf8"));
  assert.deepEqual(config.triggers.crons, Object.keys(SCHEDULED_TASKS));
  const paths: string[] = [];
  for (const cron of config.triggers.crons) {
    const name = await runScheduledTask(cron, "synthetic-secret", async (request: Request) => {
      assert.equal(request.headers.get("x-docentetuc-cron"), "synthetic-secret");
      paths.push(new URL(request.url).pathname);
      return Response.json({ ok: true });
    });
    assert.ok(["retention", "push"].includes(name));
  }
  assert.deepEqual(paths, ["/api/community/retention", "/api/push/dispatch"]);
  assert.equal(new Set(paths).size, 2);
  assert.equal(await runScheduledTask("0 * * * *", "synthetic-secret", async () => {
    throw new Error("RETIRED_SYNC_MUST_NOT_FETCH");
  }), "sync-retired");
  await assert.rejects(runScheduledTask("*/5 * * * *", "synthetic-secret", async () => Response.json({ ok: true })), /UNKNOWN_CRON_TRIGGER/);
  const transitionPaths: string[] = [];
  await runScheduledTask("*/5 * * * *", "synthetic-secret", async (request: Request) => {
    transitionPaths.push(new URL(request.url).pathname);
    return Response.json({ ok: true });
  }, true);
  assert.deepEqual(transitionPaths, ["/api/push/dispatch"]);
  await assert.rejects(runScheduledTask(config.triggers.crons[0], "", async () => Response.json({ ok: true })), /CRON_SECRET_NOT_CONFIGURED/);
});

test("un fallo de retención no impide la invocación posterior de push", async () => {
  await assert.rejects(runScheduledTask("1 * * * *", "synthetic-secret", async () => new Response(null, { status: 503 })),
    /SCHEDULED_RETENTION_503/);
  assert.equal(await runScheduledTask("2-57/5 * * * *", "synthetic-secret",
    async () => Response.json({ ok: true })), "push");
});
