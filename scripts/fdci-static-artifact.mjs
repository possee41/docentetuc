// Portable state for fresh Actions runners. No GitHub/Cloudflare client or tokens.
import { readFile, writeFile, mkdir, rename, rm, access } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { catalogHash, buildFdciCatalog, validateFdciCatalog, publicCatalogItem } from "../lib/fdci-static-catalog.ts";
import { publishLocalCatalog, syntheticFdciFetch } from "./fdci-static-catalog.mjs";
import { runFdciStaticCycle } from "./fdci-static-cycle.mjs";
const exact = (o, keys) => o && typeof o === "object" && Object.keys(o).length === keys.length && keys.every(k => Object.hasOwn(o, k));
const id = /^fdci:commission:[1-9]\d{0,11}$/, hash = /^[a-f0-9]{64}$/;
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
export async function exportFdciArtifact(root, output) {
  const checkpoint = await validateFdciCheckpoint(JSON.parse(await readFile(join(root, "private/checkpoint.json"), "utf8")));
  let catalog = null;
  try { catalog = await validateFdciCatalog(JSON.parse(await readFile(join(root, "public/catalog.json"), "utf8"))); }
  catch (e) { if (e.code !== "ENOENT") throw e; }
  const data = { format: 1, checkpoint, catalog }, text = JSON.stringify({ data, sha256: await catalogHash(data) }) + "\n";
  if (Buffer.byteLength(text) > 8_000_000) throw Error("STATIC_ARTIFACT_TOO_LARGE");
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(output, text, { flag: "wx" });
}
export async function restoreFdciArtifact(input, destination) {
  const bytes = await readFile(input); if (bytes.length > 8_000_000) throw Error("STATIC_ARTIFACT_TOO_LARGE");
  const value = JSON.parse(bytes);
  if (!exact(value, ["data", "sha256"]) || !exact(value.data, ["format", "checkpoint", "catalog"]) ||
      value.data.format !== 1 || await catalogHash(value.data) !== value.sha256) throw Error("STATIC_ARTIFACT_INVALID");
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
export function selectFdciArtifact(artifacts, runs, { workflowId, sha, branch, currentRunId }) {
  if (!/^[a-f0-9]{40}$/.test(sha) || !Number.isSafeInteger(workflowId)) throw Error("STATIC_ARTIFACT_IDENTITY_INVALID");
  return artifacts.filter(a => a.name === "fdci-static-state-v1" && !a.expired && a.size_in_bytes <= 8_000_000 &&
    a.workflow_run?.id < currentRunId && runs.some(r => r.id === a.workflow_run.id && r.workflow_id === workflowId &&
      r.head_sha === sha && r.head_branch === branch && r.status === "completed"))
    .sort((a, b) => b.workflow_run.id - a.workflow_run.id || b.id - a.id)[0] ?? null;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [op, a, b] = process.argv.slice(2);
  if (op === "export") await exportFdciArtifact(a, b);
  else if (op === "restore") await restoreFdciArtifact(a, b);
  else if (op === "synthetic-cycle") console.log(JSON.stringify(await runFdciStaticCycle({
    workDirectory: join(a, "private"), publishDirectory: join(a, "public"), fetcher: syntheticFdciFetch, checkedAt: new Date().toISOString(),
  })));
  else if (op === "select") {
    const artifact = selectFdciArtifact(JSON.parse(await readFile(a, "utf8")), JSON.parse(await readFile(b, "utf8")), {
      workflowId: Number(process.env.FDCI_STATIC_WORKFLOW_ID), sha: process.env.FDCI_STATIC_APPROVED_SHA,
      branch: process.env.GITHUB_REF_NAME, currentRunId: Number(process.env.GITHUB_RUN_ID),
    });
    console.log(artifact ? String(artifact.workflow_run.id) : "");
  } else throw Error("STATIC_ARTIFACT_OPERATION_INVALID");
}
