import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

copyFileSync(fileURLToPath(new URL("./worker-entry.mjs", import.meta.url)), fileURLToPath(new URL("../dist/server/worker-entry.mjs", import.meta.url)));
