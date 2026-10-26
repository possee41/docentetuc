import application from "./index.js";
import { runScheduledTask } from "./scheduled-task.mjs";

const worker = {
  fetch(request, environment, context) {
    return application.fetch(request, environment, context);
  },
  async scheduled(controller, environment, context) {
    await runScheduledTask(controller.cron, environment.CRON_SECRET,
      (request) => application.fetch(request, environment, context), environment.LEGACY_SYNC_PAUSED === "true");
  },
};

export default worker;
