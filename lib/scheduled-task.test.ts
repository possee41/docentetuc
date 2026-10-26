import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runScheduledTask, SCHEDULED_TASKS } from "../scripts/scheduled-task.mjs";

test("los tres Cron Triggers tienen expresiones distintas y una sola ruta por invocación", async () => {
  const config = JSON.parse(readFileSync(new URL("../wrangler.cloudflare.jsonc", import.meta.url), "utf8"));
  assert.deepEqual(config.triggers.crons, Object.keys(SCHEDULED_TASKS));
  const paths: string[] = [];
  for (const cron of config.triggers.crons) {
    const name = await runScheduledTask(cron, "synthetic-secret", async (request: Request) => {
      assert.equal(request.headers.get("x-docentetuc-cron"), "synthetic-secret");
      paths.push(new URL(request.url).pathname);
      return Response.json({ ok: true });
    });
    assert.ok(["sync", "retention", "push"].includes(name));
  }
  assert.deepEqual(paths, ["/api/sync", "/api/community/retention", "/api/push/dispatch"]);
  assert.equal(new Set(paths).size, 3);
  await assert.rejects(runScheduledTask("*/5 * * * *", "synthetic-secret", async () => Response.json({ ok: true })), /UNKNOWN_CRON_TRIGGER/);
  const transitionPaths: string[] = [];
  await runScheduledTask("*/5 * * * *", "synthetic-secret", async (request: Request) => {
    transitionPaths.push(new URL(request.url).pathname);
    return Response.json({ ok: true });
  }, true);
  assert.deepEqual(transitionPaths, ["/api/push/dispatch"]);
  await assert.rejects(runScheduledTask(config.triggers.crons[0], "", async () => Response.json({ ok: true })), /CRON_SECRET_NOT_CONFIGURED/);
});

test("el fallo de sync queda en su invocación; retención y push pueden ejecutarse después", async () => {
  await assert.rejects(runScheduledTask("0 * * * *", "synthetic-secret", async () => new Response(null, { status: 503 })),
    /SCHEDULED_SYNC_503/);
  const completed = await Promise.all([
    runScheduledTask("1 * * * *", "synthetic-secret", async () => Response.json({ ok: true })),
    runScheduledTask("2-57/5 * * * *", "synthetic-secret", async () => Response.json({ ok: true })),
  ]);
  assert.deepEqual(completed, ["retention", "push"]);
});
