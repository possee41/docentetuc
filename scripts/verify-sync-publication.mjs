// Read-only dependency/configuration check. Never collects a source or instantiates D1.
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stripTypeScriptTypes, isBuiltin } from "node:module";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const production = "baaf5886-0123-4948-96da-aa7106424549";
export async function verifySyncPublication(root = ROOT) {
  const read = path => readFileSync(resolve(root, path), "utf8");
  const config = JSON.parse(read("wrangler.1.2-daily-sources.jsonc"));
  assert.equal(config.name, "docentetuc-sources-canary-1-2");
  assert.equal(config.workers_dev, false); assert.equal(config.preview_urls, false);
  assert.deepEqual(config.routes, []); assert.deepEqual(config.triggers.crons, []);
  assert.equal(config.vars.DAILY_SOURCES_ENABLED, "false");
  assert.equal(config.vars.IMPORT_GATE_ENABLED, "false");
  assert.equal(config.vars.FDCI_EXTERNAL_ENABLED, "false");
  assert.equal(config.d1_databases.length, 1);
  const db = config.d1_databases[0];
  assert.equal(db.database_name, "docentetuc-sources-canary-1-2-local");
  assert.equal(db.database_id, "00000000-0000-4000-8000-000000000012");
  assert.equal(db.remote, false); assert.notEqual(db.database_id, production);
  assert.equal(config.vars.IMPORT_DATABASE_ID, db.database_id);
  assert.equal(config.vars.IMPORT_DATABASE_NAME, db.database_name);
  for (const path of [".github/workflows/daily-public-sources.yml", ".github/workflows/news-discovery.yml"]) {
    const yaml = read(path);
    assert.equal(/^\s*(?:schedule|push|pull_request|workflow_run):/m.test(yaml), false);
    assert.ok(yaml.includes(path.endsWith('news-discovery.yml')?'refs/heads/release/news-canary':"refs/heads/release/daily-sync-358112c"));
    assert.equal(/IMPORT_GATEWAY_TARGET:\s*production|DAILY_PRODUCTION_APPROVED|https:\/\/docentetuc\.com\.ar/.test(yaml), false);
  }
  const manifest = JSON.parse(read("docs/sync-publication-dependencies.json"));
  for (const [path, expected] of Object.entries({ ...manifest.recoveredHashes, ...manifest.unchangedWebHashes }))
    assert.equal(createHash("sha256").update(readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n")).digest("hex"), expected, `UNREVIEWED_FILE ${path}`);
  const entries = ["scripts/daily-sources.mjs", "scripts/news-via-receiver.mjs", "workers/daily-source-gateway.mjs"];
  const queue = entries.map(path => resolve(root, path)), seen = new Set();
  while (queue.length) {
    const file = queue.shift(); if (seen.has(file)) continue; seen.add(file);
    let code = readFileSync(file, "utf8");
    if (file.endsWith(".ts")) code = stripTypeScriptTypes(code);
    for (const m of code.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["']/g)) {
      if (!m[1].startsWith(".")) { assert.ok(isBuiltin(m[1]), `UNDECLARED_PACKAGE ${file} ${m[1]}`); continue; }
      const path = resolve(dirname(file), m[1]);
      const dependency = [path, path + ".ts", path + ".mjs", path + ".js", resolve(path, "index.ts")].find(existsSync);
      assert.ok(dependency, `MISSING_IMPORT ${file} ${m[1]}`); queue.push(dependency);
    }
  }
  const fetcher = globalThis.fetch;
  globalThis.fetch = () => { throw Error("NETWORK_FORBIDDEN_DURING_VALIDATION"); };
  try { for (const path of entries) await import(pathToFileURL(resolve(root, path)).href); }
  finally { globalThis.fetch = fetcher; }
  return { importedEntrypoints: entries, runtimeModules: seen.size, missingImports: 0,
    recoveredDependencies: Object.keys(manifest.recoveredHashes).length, productionBinding: false, networkRequests: 0 };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.GITHUB_ACTIONS === "true") {
    const sha = process.env.DAILY_APPROVED_SHA;
    assert.match(sha ?? "", /^[a-f0-9]{40}$/);
    assert.equal(process.env.GITHUB_REPOSITORY, "possee41/docentetuc");
    assert.equal(process.env.GITHUB_REF, "refs/heads/release/daily-sync-358112c");
    assert.equal(process.env.GITHUB_SHA, sha);
    assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", cwd: ROOT }).trim(), sha);
  }
  console.log(JSON.stringify(await verifySyncPublication()));
}
