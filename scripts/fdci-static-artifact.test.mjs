import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, access } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { exportFdciArtifact, restoreFdciArtifact, selectFdciArtifact } from "./fdci-static-artifact.mjs";
import { catalogHash } from "../lib/fdci-static-catalog.ts";

test("fresh independent Node runners resume downloaded state rather than their temporary disks", async t => {
  const parent = resolve(tmpdir()), dir = await mkdtemp(join(parent, "fdci-artifact-"));
  t.after(async () => { assert.equal(dirname(dir), parent); await rm(dir, { recursive: true, force: true }); });
  const worker = join(dir, "runner.mjs"), cycle = pathToFileURL(resolve("scripts/fdci-static-cycle.mjs")).href;
  await writeFile(worker, `import{runFdciStaticCycle}from ${JSON.stringify(cycle)};import{join}from'node:path';
const rows=Array.from({length:6},(_,i)=>({id:9000+i,capacitacion_id:100+i,fecha_cierre_preinscripcion:'2099-12-01 08:00:00'}));
const fetcher=async(u,init)=>Response.json(u.endsWith('getCapaActivas')?rows:u.endsWith('getRestoCapas')?rows.map(r=>({capacitacion_id:r.capacitacion_id,nombre:'SINTÉTICO',token:String(r.capacitacion_id),slug:'demo'})):{comisiones:rows.filter(r=>String(r.capacitacion_id)===JSON.parse(init.body).token)});
console.log(JSON.stringify({pid:process.pid,...await runFdciStaticCycle({workDirectory:join(process.argv[2],'private'),publishDirectory:join(process.argv[2],'public'),checkedAt:process.argv[3],fetcher,pause:async()=>{}})}));`);
  const run = (root, at) => JSON.parse(execFileSync(process.execPath, ["--experimental-strip-types", worker, root, at], { encoding: "utf8", windowsHide: true, timeout: 30_000 }));
  const root1 = join(dir, "runner1"), root2 = join(dir, "runner2"), artifact = join(dir, "artifact.json");
  const first = run(root1, "2026-11-05T12:00:00.000Z"); assert.equal(first.status, "partial"); assert.equal(first.requests, 6);
  await exportFdciArtifact(root1, artifact); await restoreFdciArtifact(artifact, root2);
  const second = run(root2, "2026-11-05T13:00:00.000Z");
  assert.notEqual(first.pid, second.pid); assert.equal(second.status, "complete"); assert.equal(second.requests, 4); assert.equal(second.items, 6);
  const catalog = JSON.parse(await readFile(join(root2, "public/catalog.json"), "utf8")); assert.equal(catalog.items.length, 6);
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
  await assert.rejects(restoreFdciArtifact(badFile, badRoot), /CHECKPOINT_FIELDS_INVALID/);
  await assert.rejects(access(badRoot));
});

test("artifact selection is confined to workflow, SHA, branch, completed prior runs and nonexpired artifact", () => {
  const sha = "a".repeat(40), options = { workflowId: 55, sha, branch: "pilot", currentRunId: 10 };
  const runs = [{ id: 1, workflow_id: 55, head_sha: sha, head_branch: "pilot", status: "completed" },
    { id: 2, workflow_id: 66, head_sha: sha, head_branch: "pilot", status: "completed" },
    { id: 3, workflow_id: 55, head_sha: "b".repeat(40), head_branch: "pilot", status: "completed" }];
  const artifact = n => ({ id: n, name: "fdci-static-state-v1", expired: false, size_in_bytes: 100, workflow_run: { id: n } });
  assert.equal(selectFdciArtifact([artifact(1), artifact(2), artifact(3)], runs, options).id, 1);
  assert.equal(selectFdciArtifact([{ ...artifact(1), expired: true }], runs, options), null);
  assert.equal(selectFdciArtifact([artifact(1)], runs, { ...options, branch: "other" }), null);
  assert.throws(() => selectFdciArtifact([], [], { ...options, sha: "main" }), /IDENTITY/);
});
