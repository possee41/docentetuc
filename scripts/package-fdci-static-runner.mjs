// Local release preparation only; esbuild is already supplied by Vite. No network or deployment.
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join, relative, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const root = resolve(".wrangler/fdci-integrated-package"), script = ".github/pilot/fdci-static-runner.mjs", workflow = ".github/workflows/fdci-static-integrated.yml";
await mkdir(join(root, ".github/pilot"), { recursive: true }); await mkdir(join(root, ".github/workflows"), { recursive: true });
const esbuild = createRequire(import.meta.resolve("vite"))("esbuild");
const built = await esbuild.build({ entryPoints: ["scripts/fdci-static-runner.mjs"], outfile: join(root, script), platform: "node", target: "node24", format: "esm",
  bundle: true, treeShaking: true, metafile: true, plugins: [{ name: "remove-imported-cli", setup(build) {
    build.onLoad({ filter: /(?:import-fdci|fdci-static-catalog|fdci-static-artifact|fdci-static-durable)\.mjs$/ }, async args => {
      const contents = await readFile(args.path, "utf8"), marker = "if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {";
      if (!contents.includes(marker)) throw Error("FDCI_IMPORTED_CLI_MARKER_MISSING");
      return { contents: contents.slice(0, contents.indexOf(marker)), loader: "js" };
    });
  } }] });
const code = await readFile(join(root, script), "utf8");
if (/function sendFdci|IMPORT_SECRET|CLOUDFLARE_API_TOKEN/.test(code)) throw Error("FDCI_PACKAGE_UNEXPECTED_IMPORTER");
await writeFile(join(root, workflow), (await readFile("docs/examples/fdci-static-integrated.yml.example", "utf8"))
  .replace("node scripts/fdci-static-runner.mjs run", `node ${script} run`));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const files = await Promise.all([script, workflow].map(async path => { const bytes = await readFile(join(root, path)); return { path, bytes: bytes.length, sha256: digest(bytes) }; }));
const inputs = await Promise.all(Object.keys(built.metafile.inputs).map(async path => {
  const file = resolve(path), name = relative(process.cwd(), file);
  if (name.startsWith(".." + sep)) throw Error("FDCI_PACKAGE_EXTERNAL_SOURCE");
  return { path: name.split(sep).join("/"), sha256: digest(await readFile(file)) };
}));
const manifest = { repository: "possee41/docentetuc-fdci-catalog-pilot", sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim(),
  mode: "manual-disabled-until-authorized", files, inputs };
await writeFile(join(root, ".github/pilot/integrated-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ directory: root, sourceCommit: manifest.sourceCommit, files }));
