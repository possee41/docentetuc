import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { prepareJuntasShell } from "./prepare-juntas-shell.mjs";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";

const require = createRequire(realpathSync("node_modules/wrangler/package.json"));
await require("esbuild").build({ entryPoints: ["lib/juntas-public-api.ts"],
  outfile: "dist/server/juntas-public-api.mjs", bundle: true, format: "esm", platform: "browser", target: "es2022" });

await prepareJuntasShell();

copyFileSync(fileURLToPath(new URL("./worker-entry.mjs", import.meta.url)), fileURLToPath(new URL("../dist/server/worker-entry.mjs", import.meta.url)));
copyFileSync(fileURLToPath(new URL("./scheduled-task.mjs", import.meta.url)), fileURLToPath(new URL("../dist/server/scheduled-task.mjs", import.meta.url)));
copyFileSync(fileURLToPath(new URL("./juntas-document.mjs", import.meta.url)), fileURLToPath(new URL("../dist/server/juntas-document.mjs", import.meta.url)));
