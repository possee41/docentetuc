// Local build inspection only: no credentials, networking or deployment.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const { build } = require("../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild");

export async function checkFdciHybridBoundary() {
  const bundle = (entry, platform) => build({ entryPoints: [entry], bundle: true, format: "esm",
    platform, target: "es2022", write: false, metafile: true, logLevel: "silent" });
  const worker = await bundle("workers/source-import-gateway.mjs", "browser");
  const node = await bundle("scripts/fdci-automation.mjs", "node");
  const inputs = result => Object.keys(result.metafile.inputs).map(path => path.replaceAll("\\", "/"));
  const workerInputs = inputs(worker), nodeInputs = inputs(node);
  const heavy = ["scripts/fdci-incremental.mjs", "scripts/import-fdci.mjs", "lib/fdci-import.ts",
    "lib/training.ts", "lib/circuits.ts", "lib/sync-diff.ts", "lib/publication-lifecycle.ts"];
  for (const path of heavy) {
    assert.ok(nodeInputs.includes(path), `Node must own ${path}`);
    assert.ok(!workerInputs.includes(path), `Heavy processing leaked into Worker: ${path}`);
  }
  // Shared gateway also includes the existing static Juntas source allow-list.
  assert.ok(workerInputs.every(path => path.startsWith("workers/") || path === "lib/junta-external-sources.ts"),
    "Gateway must not import application/collector code");
  assert.ok(!worker.outputFiles[0].text.includes("apicapacitaciones.educaciontuc.edu.ar"), "Official API belongs to Node");
  return { workerInputs, nodeHeavyInputs: heavy, workerBundleBytes: worker.outputFiles[0].contents.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(await checkFdciHybridBoundary(), null, 2));
