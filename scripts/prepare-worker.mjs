import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

copyFileSync(fileURLToPath(new URL("./worker-entry.mjs", import.meta.url)), fileURLToPath(new URL("../dist/server/worker-entry.mjs", import.meta.url)));
copyFileSync(fileURLToPath(new URL("./scheduled-task.mjs", import.meta.url)), fileURLToPath(new URL("../dist/server/scheduled-task.mjs", import.meta.url)));
