// Portable state for fresh Actions runners. No GitHub/Cloudflare client or tokens.
import { readFile, writeFile, mkdir, rename, rm, access } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { catalogHash, buildFdciCatalog, validateFdciCatalog, publicCatalogItem } from "../lib/fdci-static-catalog.ts";
import { publishLocalCatalog } from "./fdci-static-catalog.mjs";
import { runFdciStaticCycle } from "./fdci-static-cycle.mjs";
const exact = (o, keys) => o && typeof o === "object" && Object.keys(o).length === keys.length && keys.every(k => Object.hasOwn(o, k));
const id = /^fdci:commission:[1-9]\d{0,11}$/, hash = /^[a-f0-9]{64}$/;
export const FDCI_STATE_ARTIFACT = "fdci-static-synthetic-state-v2";
const localOrigin = { dataset: "synthetic", repository: "local", workflowId: 0, runId: 0, runAttempt: 0, sha: "0".repeat(40), branch: "local" };
function validateOrigin(origin) {
  if (!exact(origin, Object.keys(localOrigin)) || origin.dataset !== "synthetic" || !/^[a-f0-9]{40}$/.test(origin.sha) ||
      typeof origin.branch !== "string" || !origin.branch || ![origin.workflowId, origin.runId, origin.runAttempt].every(Number.isSafeInteger)) throw Error("STATIC_ORIGIN_INVALID");
  if (origin.repository === "local") {
    if (JSON.stringify(origin) !== JSON.stringify(localOrigin)) throw Error("STATIC_ORIGIN_INVALID");
  } else if (origin.repository !== "possee41/docentetuc" || origin.workflowId <= 0 || origin.runId <= 0 || origin.runAttempt !== 1) throw Error("STATIC_ORIGIN_INVALID");
  return origin;
}
export async function validateFdciCheckpoint(envelope) {
  const d = envelope?.data;
  if (!exact(envelope, ["data", "sha256"]) || await catalogHash(d) !== envelope.sha256 ||
      !exact(d, ["schemaVersion", "activeKey", "state", "items", "observations", "history", "lastCheckAt"]) || d.schemaVersion !== 1 ||
      d.activeKey !== null && !hash.test(d.activeKey) || !exact(d.state, ["detail_after", "detail_upper", "detail_cycle"]) ||
      ![d.state.detail_after, d.state.detail_upper].every(x => typeof x === "string" && /^(\d{12})?$/.test(x)) ||
      d.state.detail_after > d.state.detail_upper || !Number.isSafeInteger(d.state.detail_cycle) || d.state.detail_cycle < 1 ||
      !d.history || typeof d.history !== "object") throw Error("STATIC_CHECKPOINT_INVALID");
  if (!Array.isArray(d.items) || d.items.some(i => !exact(i, Object.keys(publicCatalogItem(i))))) throw Error("STATIC_CHECKPOINT_FIELDS_INVALID");
  await buildFdciCatalog(d.items, d.lastCheckAt, d.observations);
  for (const [key, value] of Object.entries(d.history)) {
    if (!id.test(key) || !exact(value, ["hash", "lastChangedAt"]) || !hash.test(value.hash) ||
        new Date(value.lastChangedAt).toISOString() !== value.lastChangedAt || value.lastChangedAt > d.lastCheckAt) throw Error("STATIC_HISTORY_INVALID");
  }
  return envelope;
}
export async function exportFdciArtifact(root, output, origin = localOrigin) {
  validateOrigin(origin);
  const checkpoint = await validateFdciCheckpoint(JSON.parse(await readFile(join(root, "private/checkpoint.json"), "utf8")));
  let catalog = null;
  try { catalog = await validateFdciCatalog(JSON.parse(await readFile(join(root, "public/catalog.json"), "utf8"))); }
  catch (e) { if (e.code !== "ENOENT") throw e; }
  const data = { format: 2, origin, checkpoint, catalog }, text = JSON.stringify({ data, sha256: await catalogHash(data) }) + "\n";
  if (Buffer.byteLength(text) > 8_000_000) throw Error("STATIC_ARTIFACT_TOO_LARGE");
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(output, text, { flag: "wx" });
}
export async function restoreFdciArtifact(input, destination, selected) {
  const bytes = await readFile(input); if (bytes.length > 8_000_000) throw Error("STATIC_ARTIFACT_TOO_LARGE");
  const value = JSON.parse(bytes);
  if (!exact(value, ["data", "sha256"]) || !exact(value.data, ["format", "origin", "checkpoint", "catalog"]) ||
      value.data.format !== 2 || await catalogHash(value.data) !== value.sha256) throw Error("STATIC_ARTIFACT_INVALID");
  const origin = validateOrigin(value.data.origin);
  if (origin.repository !== "local" && !selected) throw Error("STATIC_SELECTED_ARTIFACT_REQUIRED");
  if (selected && (!Object.keys(localOrigin).every(k => selected[k] === origin[k]) ||
      !Number.isSafeInteger(selected.artifactId) || !Number.isFinite(Date.parse(selected.expiresAt)) || Date.parse(selected.expiresAt) <= Date.now())) throw Error("STATIC_ARTIFACT_PROVENANCE_MISMATCH");
  await validateFdciCheckpoint(value.data.checkpoint);
  if (value.data.catalog) await validateFdciCatalog(value.data.catalog);
  const root = resolve(destination), stage = root + ".restore-" + randomUUID();
  try { await access(root); throw Error("STATIC_RESTORE_TARGET_EXISTS"); } catch (e) { if (e.code !== "ENOENT") throw e; }
  await mkdir(join(stage, "private"), { recursive: true });
  try {
    await writeFile(join(stage, "private/checkpoint.json"), JSON.stringify(value.data.checkpoint));
    if (value.data.catalog) await publishLocalCatalog(value.data.catalog, join(stage, "public"));
    await rename(stage, root); // Restore becomes visible only after all validation/writes.
  } catch (e) {
    // Fixed sibling just created above; never recursively remove the caller target.
    if (dirname(stage) !== dirname(root) || !stage.startsWith(root + ".restore-")) throw Error("RESTORE_CLEANUP_PATH_INVALID");
    await rm(stage, { recursive: true, force: true }); throw e;
  }
}
export function selectFdciArtifact(artifacts, runs, { workflowId, sha, branch, currentRunId, repositoryId, now = Date.now() }) {
  if (!/^[a-f0-9]{40}$/.test(sha) || !Number.isSafeInteger(workflowId) || workflowId <= 0 ||
      !Number.isSafeInteger(currentRunId) || currentRunId <= 0 || !Number.isSafeInteger(repositoryId) || repositoryId <= 0 || typeof branch !== "string" || !branch)
    throw Error("STATIC_ARTIFACT_IDENTITY_INVALID");
  const run = runs.filter(r => r.id < currentRunId && r.workflow_id === workflowId &&
    r.head_sha === sha && r.head_branch === branch && r.status === "completed")
    .sort((a, b) => b.id - a.id)[0];
  if (!run) return null;
  const candidates = artifacts.filter(a => a.name === FDCI_STATE_ARTIFACT && a.workflow_run?.id === run.id);
  if (candidates.length !== 1) throw Error("STATIC_ARTIFACT_MISSING_OR_AMBIGUOUS");
  const selected = candidates[0];
  // Do not silently rewind to an older artifact when the latest committed one
  // is expired, malformed or from an unsupported re-run attempt.
  if (selected.expired || Date.parse(selected.expires_at) <= now) throw Error("STATIC_ARTIFACT_EXPIRED");
  if (!Number.isFinite(Date.parse(selected.expires_at)) || !Number.isSafeInteger(selected.id) || selected.id <= 0 ||
      !Number.isSafeInteger(selected.size_in_bytes) || selected.size_in_bytes <= 0 || selected.size_in_bytes > 8_000_000)
    throw Error("STATIC_ARTIFACT_METADATA_INVALID");
  if (run.run_attempt !== 1 || run.event !== "workflow_dispatch" || run.repository?.id !== repositoryId || run.repository?.full_name !== "possee41/docentetuc" ||
      run.head_repository?.id !== repositoryId || selected.workflow_run.repository_id !== repositoryId || selected.workflow_run.head_repository_id !== repositoryId ||
      selected.workflow_run.head_sha !== sha || selected.workflow_run.head_branch !== branch) throw Error("STATIC_ARTIFACT_PROVENANCE_MISMATCH");
  return { artifactId: selected.id, expiresAt: selected.expires_at, dataset: "synthetic", repository: "possee41/docentetuc",
    workflowId, runId: run.id, runAttempt: run.run_attempt, sha, branch };
}
export async function syntheticCycleFetch(url, options) {
  const rows = Array.from({ length: 6 }, (_, i) => ({ id: 9000 + i, capacitacion_id: 100 + i,
    fecha_apertura_preinscripcion: "2026-01-01 08:00:00", fecha_cierre_preinscripcion: "2099-12-01 08:00:00" }));
  return Response.json(url.endsWith("getCapaActivas") ? rows : url.endsWith("getRestoCapas")
    ? rows.map(r => ({ capacitacion_id: r.capacitacion_id, nombre: `SINTÉTICA — FDCI #${r.id}`, token: String(r.capacitacion_id), slug: "demo" }))
    : { comisiones: rows.filter(r => String(r.capacitacion_id) === JSON.parse(options.body).token) });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [op, a, b, selectedFile] = process.argv.slice(2);
  if (op === "export") await exportFdciArtifact(a, b, process.env.GITHUB_ACTIONS === "true" ? {
    dataset: "synthetic", repository: process.env.GITHUB_REPOSITORY, workflowId: Number(process.env.FDCI_STATIC_WORKFLOW_ID),
    runId: Number(process.env.GITHUB_RUN_ID), runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT), sha: process.env.FDCI_STATIC_APPROVED_SHA, branch: process.env.GITHUB_REF_NAME,
  } : localOrigin);
  else if (op === "restore") {
    if (process.env.GITHUB_ACTIONS === "true" && !selectedFile) throw Error("STATIC_SELECTED_ARTIFACT_REQUIRED");
    await restoreFdciArtifact(a, b, selectedFile ? JSON.parse(await readFile(selectedFile, "utf8")) : undefined);
  }
  else if (op === "synthetic-cycle") console.log(JSON.stringify(await runFdciStaticCycle({
    workDirectory: join(a, "private"), publishDirectory: join(a, "public"), fetcher: syntheticCycleFetch, checkedAt: b ?? new Date().toISOString(),
  })));
  else if (op === "select") {
    const artifact = selectFdciArtifact(JSON.parse(await readFile(a, "utf8")), JSON.parse(await readFile(b, "utf8")), {
      workflowId: Number(process.env.FDCI_STATIC_WORKFLOW_ID), sha: process.env.FDCI_STATIC_APPROVED_SHA,
      branch: process.env.GITHUB_REF_NAME, currentRunId: Number(process.env.GITHUB_RUN_ID),
      repositoryId: Number(process.env.GITHUB_REPOSITORY_ID),
    });
    console.log(JSON.stringify(artifact));
  } else throw Error("STATIC_ARTIFACT_OPERATION_INVALID");
}
