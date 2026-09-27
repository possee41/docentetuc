import application from "./index.js";

const internalRequest = (path, secret) => new Request(`https://docentetuc.internal${path}`, {
  method: "POST",
  headers: { "x-docentetuc-cron": secret },
});

export default {
  fetch(request, environment, context) {
    return application.fetch(request, environment, context);
  },
  async scheduled(_controller, environment, context) {
    if (!environment.CRON_SECRET) throw new Error("CRON_SECRET_NOT_CONFIGURED");
    const sync = await application.fetch(internalRequest("/api/sync", environment.CRON_SECRET), environment, context);
    if (!sync.ok) console.error("scheduled_sync_failed", sync.status, await sync.text());
    const dispatch = await application.fetch(internalRequest("/api/push/dispatch", environment.CRON_SECRET), environment, context);
    if (!dispatch.ok) throw new Error(`PUSH_DISPATCH_${dispatch.status}: ${await dispatch.text()}`);
  },
};
