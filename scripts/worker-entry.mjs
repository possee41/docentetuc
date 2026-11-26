import application from "./index.js";
import { runScheduledTask } from "./scheduled-task.mjs";
import documents from "./juntas-shell.mjs";
import { juntasDocument } from "./juntas-document.mjs";
import { juntasPublicApi } from "./juntas-public-api.mjs";
import { publicAppApi } from "./public-app-api.mjs";

const worker = {
  fetch(request, environment, context) {
    const document = juntasDocument(request, documents);
    if (document) return document;
    const database = () => {
        if (!environment.DB) throw new Error("La base de datos no está disponible.");
        return environment.DB;
      };
    return publicAppApi(request, database, environment) || juntasPublicApi(request, database)
      || application.fetch(request, environment, context);
  },
  async scheduled(controller, environment, context) {
    await runScheduledTask(controller.cron, environment.CRON_SECRET,
      (request) => application.fetch(request, environment, context),
      environment.LEGACY_SYNC_PAUSED === "true", environment.PUSH_DISPATCH_MODE);
  },
};

export default worker;
