import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, access } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { exportFdciArtifact, restoreFdciArtifact, selectFdciArtifact, FDCI_STATE_ARTIFACT } from "./fdci-static-artifact.mjs";
import { catalogHash, buildFdciCatalog } from "../lib/fdci-static-catalog.ts";

test("fresh independent Node runners resume downloaded state rather than their temporary disks", async t => {
  const parent = resolve(tmpdir()), dir = await mkdtemp(join(parent, "fdci-artifact-"));
  t.after(async () => { assert.equal(dirname(dir), parent); await rm(dir, { recursive: true, force: true }); });
  const worker = join(dir, "runner.mjs"), cycle = pathToFileURL(resolve("scripts/fdci-static-cycle.mjs")).href;
  const fixtures = pathToFileURL(resolve("scripts/fdci-static-artifact.mjs")).href;
  await writeFile(worker, `import{runFdciStaticCycle}from ${JSON.stringify(cycle)};import{join}from'node:path';
import{syntheticCycleFetch}from ${JSON.stringify(fixtures)};
const fetcher=process.argv[4]==='interrupt'?async()=>{throw Error('FDCI_CANCELLED')}:syntheticCycleFetch;
console.log(JSON.stringify({pid:process.pid,...await runFdciStaticCycle({workDirectory:join(process.argv[2],'private'),publishDirectory:join(process.argv[2],'public'),checkedAt:process.argv[3],fetcher,pause:async()=>{}})}));`);
  const run = (root, at, mode = "normal") => JSON.parse(execFileSync(process.execPath, ["--experimental-strip-types", worker, root, at, mode], { encoding: "utf8", windowsHide: true, timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] }));
  const root1 = join(dir, "runner1"), root2 = join(dir, "runner2"), artifact = join(dir, "artifact.json");
  const first = run(root1, "2026-11-05T12:00:00.000Z"); assert.equal(first.status, "partial"); assert.equal(first.requests, 6);
  await assert.rejects(access(join(root1, "public/catalog.json"))); // Six requests are not a complete catalog.
  const origin = { dataset: "synthetic", repository: "possee41/docentetuc", workflowId: 55, runId: 1, runAttempt: 1, sha: "a".repeat(40), branch: "pilot" };
  const selected = { ...origin, artifactId: 11, expiresAt: "2099-01-01T00:00:00Z" };
  await exportFdciArtifact(root1, artifact, origin);
  await assert.rejects(restoreFdciArtifact(artifact, root2), /SELECTED_ARTIFACT_REQUIRED/);
  await assert.rejects(restoreFdciArtifact(artifact, root2, { ...selected, runId: 2 }), /PROVENANCE/);
  await assert.rejects(restoreFdciArtifact(artifact, root2, { ...selected, expiresAt: "2020-01-01T00:00:00Z" }), /PROVENANCE/);
  await restoreFdciArtifact(artifact, root2, selected);
  const checkpointBefore = await readFile(join(root2, "private/checkpoint.json"), "utf8");
  assert.throws(() => run(root2, "2026-11-05T12:30:00.000Z", "interrupt"));
  assert.equal(await readFile(join(root2, "private/checkpoint.json"), "utf8"), checkpointBefore);
  const second = run(root2, "2026-11-05T13:00:00.000Z");
  assert.notEqual(first.pid, second.pid); assert.equal(second.status, "complete"); assert.equal(second.requests, 4); assert.equal(second.items, 6);
  const catalog = JSON.parse(await readFile(join(root2, "public/catalog.json"), "utf8")); assert.equal(catalog.items.length, 6);
  assert.equal(new Set(catalog.items.map(i => i.id)).size, 6);
  assert.equal((await buildFdciCatalog([...catalog.items].reverse(), catalog.updatedAt, catalog.observations)).sha256, catalog.sha256);
  assert.equal(catalog.observations[catalog.items[0].id].checkedAt, "2026-11-05T12:00:00.000Z");
  assert.equal(catalog.observations[catalog.items[5].id].checkedAt, "2026-11-05T13:00:00.000Z");
  // A third fresh runner also restores the last complete public catalog, not only cursor.
  const artifact2 = join(dir, "artifact2.json"), root3 = join(dir, "runner3");
  await exportFdciArtifact(root2, artifact2); await restoreFdciArtifact(artifact2, root3);
  assert.equal(JSON.parse(await readFile(join(root3, "public/catalog.json"), "utf8")).sha256, catalog.sha256);
  await assert.rejects(restoreFdciArtifact(artifact2, root3), /TARGET_EXISTS/);
  const corrupt = JSON.parse(await readFile(artifact2, "utf8")); corrupt.data.checkpoint.data.state.detail_cycle = 999;
  const badFile = join(dir, "bad.json"), badRoot = join(dir, "bad-root"); await writeFile(badFile, JSON.stringify(corrupt));
  await assert.rejects(restoreFdciArtifact(badFile, badRoot), /ARTIFACT_INVALID/); await assert.rejects(access(badRoot));
  const extra = JSON.parse(await readFile(artifact, "utf8"));
  extra.data.checkpoint.data.items[0].privateField = "must-not-transfer";
  extra.data.checkpoint.sha256 = await catalogHash(extra.data.checkpoint.data);
  extra.sha256 = await catalogHash(extra.data);
  await writeFile(badFile, JSON.stringify(extra));
  await assert.rejects(restoreFdciArtifact(badFile, badRoot, selected), /CHECKPOINT_FIELDS_INVALID/);
  await assert.rejects(access(badRoot));
});

test("prepared workflow is manual, read-only, serialized, synthetic and publishes only complete artifacts", async () => {
  // Reuse ESLint's installed YAML parser; no dependency installation.
  const yaml = createRequire(import.meta.resolve("eslint"))("js-yaml");
  const workflow = yaml.load(await readFile(".github/workflows/fdci-static-catalog-pilot.yml", "utf8"));
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.equal(workflow.on.workflow_dispatch.inputs.bootstrap.default, false);
  assert.deepEqual(workflow.permissions, { contents: "read", actions: "read" });
  assert.deepEqual(workflow.concurrency, { group: FDCI_STATE_ARTIFACT, "cancel-in-progress": false });
  assert.deepEqual(Object.keys(workflow.jobs), ["synthetic"]);
  const job = workflow.jobs.synthetic;
  assert.match(job.if, /FDCI_STATIC_PILOT_ENABLED == 'true'/);
  assert.match(job.if, /github.run_attempt == 1/);
  assert.equal(job.environment, "fdci-static-pilot");
  const steps = job.steps;
  const download = steps.find(s => s.uses === "actions/download-artifact@v4");
  assert.equal(download.with["artifact-ids"], "${{ steps.state.outputs.artifact }}");
  assert.equal(download.with["run-id"], "${{ steps.state.outputs.run }}");
  assert.match(steps.find(s => s.id === "state").run, /--paginate/);
  assert.match(steps.find(s => s.id === "collect").run, /synthetic-cycle/);
  const catalog = steps.find(s => s.with?.name === "fdci-static-synthetic-complete-v2");
  assert.match(catalog.if, /steps.collect.outputs.complete == 'true'/);
  assert.match(catalog.if, /steps.progress.outcome == 'success'/);
  assert.equal(catalog.with.path, ".fdci-runner/public/catalog.json");
  assert.equal(catalog.with["include-hidden-files"], true);
  assert.equal(steps.find(s => s.id === "progress").with["retention-days"], 2);
  assert.ok(steps.every(s => !s.uses || /^actions\/(checkout|setup-node|download-artifact|upload-artifact)@v4$/.test(s.uses)));
});

test("artifact selection binds exact repository, workflow, SHA, branch, attempt and prior manual run", () => {
  const sha = "a".repeat(40), options = { workflowId: 55, sha, branch: "pilot", currentRunId: 10, repositoryId: 7 };
  const run = n => ({ id: n, workflow_id: 55, head_sha: sha, head_branch: "pilot", status: "completed", run_attempt: 1,
    event: "workflow_dispatch", repository: { id: 7, full_name: "possee41/docentetuc" }, head_repository: { id: 7 } });
  const artifact = n => ({ id: n, name: FDCI_STATE_ARTIFACT, expired: false, expires_at: "2099-01-01T00:00:00Z", size_in_bytes: 100,
    workflow_run: { id: n, repository_id: 7, head_repository_id: 7, head_sha: sha, head_branch: "pilot" } });
  const runs = [run(1), { ...run(2), workflow_id: 66 }, { ...run(3), head_sha: "b".repeat(40) }, run(10)];
  assert.equal(selectFdciArtifact([artifact(1), artifact(2), artifact(3), artifact(10)], runs, options).artifactId, 1);
  assert.equal(selectFdciArtifact([], [], options), null);
  assert.equal(selectFdciArtifact([artifact(1)], runs, { ...options, branch: "other" }), null);
  assert.throws(() => selectFdciArtifact([], [], { ...options, sha: "main" }), /IDENTITY/);
  for (const badRun of [{ ...run(1), run_attempt: 2 }, { ...run(1), event: "push" }, { ...run(1), head_repository: { id: 8 } }])
    assert.throws(() => selectFdciArtifact([artifact(1)], [badRun], options), /PROVENANCE/);
  for (const badArtifact of [{ ...artifact(1), size_in_bytes: 9_000_000 }, { ...artifact(1), expires_at: "invalid" }])
    assert.throws(() => selectFdciArtifact([badArtifact], [run(1)], options), /METADATA/);
  // Never silently rewind to run 1 if run 4 lost its committed state.
  assert.throws(() => selectFdciArtifact([artifact(1)], [run(1), run(4)], options), /MISSING/);
  assert.throws(() => selectFdciArtifact([artifact(1), { ...artifact(4), expired: true }], [run(1), run(4)], options), /EXPIRED/);
  assert.throws(() => selectFdciArtifact([{ ...artifact(1), expires_at: "2020-01-01T00:00:00Z" }], [run(1)], options), /EXPIRED/);
  assert.throws(() => selectFdciArtifact([artifact(1), artifact(1)], [run(1)], options), /AMBIGUOUS/);
});
