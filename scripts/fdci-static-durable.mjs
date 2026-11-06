// Durable official state: one atomic file on a branch outside the Pages source.
// No D1, Cloudflare credentials, artifact dependency or implicit bootstrap.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { catalogHash, validateFdciCatalog } from "../lib/fdci-static-catalog.ts";
import { validateFdciCheckpoint } from "./fdci-static-artifact.mjs";
import { runFdciStaticCycle } from "./fdci-static-cycle.mjs";

export const FDCI_STATE_REPOSITORY = "possee41/docentetuc-fdci-catalog-pilot";
export const FDCI_STATE_BRANCH = "fdci-static-state";
const path = "fdci-state.json", limit = 8_000_000, hex = /^[a-f0-9]{40}$/;
const exact = (v, keys) => v && typeof v === "object" && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const iso = v => typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const blobSha = bytes => createHash("sha1").update(`blob ${Buffer.byteLength(bytes)}\0`).update(bytes).digest("hex");
async function envelope(data) { return { data, sha256: await catalogHash(data) }; }

export async function initialFdciState(codeSha) {
  if (!hex.test(codeSha)) throw Error("FDCI_STATE_CODE_INVALID");
  return envelope({ format: 1, repository: FDCI_STATE_REPOSITORY, dataset: "official", codeSha, generation: 0,
    checkpoint: null, catalog: null, lastAttempt: null });
}
export async function validateDurableFdciState(value) {
  const d = value?.data;
  if (Buffer.byteLength(JSON.stringify(value) ?? "") > limit || !exact(value, ["data", "sha256"]) ||
      !exact(d, ["format", "repository", "dataset", "codeSha", "generation", "checkpoint", "catalog", "lastAttempt"]) ||
      value.sha256 !== await catalogHash(d) || d.format !== 1 || d.repository !== FDCI_STATE_REPOSITORY || d.dataset !== "official" ||
      !hex.test(d.codeSha) || !Number.isSafeInteger(d.generation) || d.generation < 0) throw Error("FDCI_DURABLE_STATE_INVALID");
  if (d.generation === 0) {
    if (d.checkpoint !== null || d.catalog !== null || d.lastAttempt !== null) throw Error("FDCI_INITIAL_STATE_INVALID");
  } else {
    const a = d.lastAttempt;
    if (!exact(a, ["at", "status", "error"]) || !iso(a.at) || !["complete", "partial", "restarted", "source-error"].includes(a.status) ||
        (a.status === "source-error" ? !/^[A-Z0-9_]{1,100}$/.test(a.error) : a.error !== null)) throw Error("FDCI_ATTEMPT_INVALID");
    if (d.checkpoint) {
      await validateFdciCheckpoint(d.checkpoint);
      if (d.checkpoint.data.lastCheckAt > a.at) throw Error("FDCI_STATE_TIME_INVALID");
    } else if (a.status !== "source-error") throw Error("FDCI_STATE_CHECKPOINT_MISSING");
    if (d.catalog) {
      await validateFdciCatalog(d.catalog);
      if (d.catalog.updatedAt > a.at) throw Error("FDCI_STATE_TIME_INVALID");
    }
    if (a.status === "complete" && (!d.catalog || d.catalog.updatedAt !== a.at || d.checkpoint.data.items.length ||
        d.checkpoint.data.state.detail_after || d.checkpoint.data.state.detail_upper)) throw Error("FDCI_COMPLETE_STATE_INVALID");
  }
  return value;
}

// Explicit one-time migration only; never used as an automatic missing-state fallback.
export async function migrateOfficialFdciArtifact(value, { sourceSha, runId, codeSha }) {
  const d = value?.data, o = d?.origin;
  if (!exact(value, ["data", "sha256"]) || !exact(d, ["format", "origin", "checkpoint", "catalog"]) ||
      value.sha256 !== await catalogHash(d) || d.format !== 2 || !hex.test(sourceSha) || !Number.isSafeInteger(runId) || runId <= 0 ||
      !exact(o, ["dataset", "repository", "workflowId", "runId", "runAttempt", "sha", "branch"]) || o.dataset !== "official-readonly" ||
      o.repository !== FDCI_STATE_REPOSITORY || o.sha !== sourceSha || o.runId !== runId || o.branch !== "main" || o.runAttempt !== 1 ||
      !Number.isSafeInteger(o.workflowId) || o.workflowId <= 0) throw Error("FDCI_MIGRATION_PROVENANCE_INVALID");
  const initial = await initialFdciState(codeSha);
  await validateFdciCheckpoint(d.checkpoint); if (d.catalog) await validateFdciCatalog(d.catalog);
  const at = d.checkpoint.data.lastCheckAt;
  const status = d.catalog?.updatedAt === at && !d.checkpoint.data.items.length && !d.checkpoint.data.state.detail_after ? "complete"
    : d.checkpoint.data.activeKey ? "partial" : "restarted";
  return validateDurableFdciState(await envelope({ ...initial.data, generation: 1, checkpoint: d.checkpoint, catalog: d.catalog,
    lastAttempt: { at, status, error: null } }));
}

export function fdciDurableView(state, now = Date.now()) {
  const { catalog, lastAttempt } = state.data;
  const ageMs = catalog ? Math.max(0, now - Date.parse(catalog.updatedAt)) : null;
  const status = !catalog ? "unavailable" : lastAttempt?.status !== "complete" || ageMs > 86_400_000 ? "stale" : "ready";
  // A stale snapshot remains consultable, but is never advertised as current.
  const activeItems = status === "ready" ? catalog.items.filter(i => !["CLOSED", "EXPIRED"].includes(i.normalizedStatus) &&
    ![i.registrationCloseAt, i.endsAt].some(d => d && Date.parse(d) <= now)) : [];
  return { status, updatedAt: catalog?.updatedAt ?? null, ageMs, lastAttempt: structuredClone(lastAttempt),
    catalog: structuredClone(catalog), activeItems: structuredClone(activeItems) };
}

export async function collectDurableFdciCycle({ state, root, fetcher, checkedAt, pause }) {
  await validateDurableFdciState(state);
  if (!iso(checkedAt) || state.data.lastAttempt && checkedAt <= state.data.lastAttempt.at) throw Error("FDCI_STATE_TIME_CONFLICT");
  await mkdir(root); // Fresh workspace only: never merge a restored cursor with local leftovers.
  await mkdir(join(root, "private"));
  if (state.data.checkpoint) await writeFile(join(root, "private/checkpoint.json"), JSON.stringify(state.data.checkpoint));
  if (state.data.catalog) {
    await mkdir(join(root, "public"));
    await writeFile(join(root, "public/catalog.json"), JSON.stringify(state.data.catalog));
  }
  let result, error = null, checkpoint = state.data.checkpoint, catalog = state.data.catalog;
  try {
    result = await runFdciStaticCycle({ workDirectory: join(root, "private"), publishDirectory: join(root, "public"), fetcher, checkedAt, pause, courseLimit: 2 });
    checkpoint = JSON.parse(await readFile(join(root, "private/checkpoint.json"), "utf8"));
    if (result.status === "complete") {
      catalog = await validateFdciCatalog(JSON.parse(await readFile(join(root, "public/catalog.json"), "utf8")));
      if (catalog.sha256 !== result.sha256) throw Error("FDCI_CATALOG_ACK_MISMATCH");
    }
  } catch (e) {
    error = /^[A-Z0-9_]{1,100}$/.test(e.message) ? e.message : "FDCI_SOURCE_FAILED";
    // Even a local failure after rename cannot publish an unconfirmed snapshot.
    checkpoint = state.data.checkpoint; catalog = state.data.catalog;
  }
  const next = await envelope({ ...state.data, generation: state.data.generation + 1, checkpoint, catalog,
    lastAttempt: { at: checkedAt, status: error ? "source-error" : result.status, error } });
  await validateDurableFdciState(next);
  return { state: next, result: result ?? null, error, view: fdciDurableView(next, Date.parse(checkedAt)) };
}

export function createFdciGitStateStore({ token, fetcher = fetch }) {
  if (!token) throw Error("FDCI_GITHUB_AUTH_REQUIRED");
  const base = `https://api.github.com/repos/${FDCI_STATE_REPOSITORY}`;
  const endpoint = `/contents/${path}`;
  const request = (route, method = "GET", body) => fetcher(base + route, { method, redirect: "error",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.object+json", "User-Agent": "DocenteTuc-FDCI-state" },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
  async function load() {
    const response = await request(`${endpoint}?ref=${FDCI_STATE_BRANCH}`);
    if (!response.ok) throw Error(response.status === 404 ? "FDCI_DURABLE_STATE_MISSING" : `FDCI_STATE_READ_HTTP_${response.status}`);
    let item = await response.json(); const revision = item.sha;
    if (!hex.test(revision) || !Number.isSafeInteger(item.size) || item.size < 0 || item.size > limit || item.path !== path || item.type !== "file") throw Error("FDCI_STATE_METADATA_INVALID");
    // Contents metadata omits base64 for files >1 MB; fetch that exact immutable blob.
    if (item.encoding === "none") {
      const blob = await request(`/git/blobs/${revision}`);
      if (!blob.ok) throw Error(`FDCI_STATE_BLOB_HTTP_${blob.status}`);
      item = await blob.json();
    }
    if (item.encoding !== "base64" || typeof item.content !== "string") throw Error("FDCI_STATE_ENCODING_INVALID");
    const bytes = Buffer.from(item.content, "base64");
    if (bytes.length > limit || blobSha(bytes) !== revision) throw Error("FDCI_STATE_BLOB_MISMATCH");
    return { revision, state: await validateDurableFdciState(JSON.parse(bytes.toString("utf8"))) };
  }
  async function save(previous, state) {
    await validateDurableFdciState(previous.state); await validateDurableFdciState(state);
    if (!hex.test(previous.revision) || state.data.generation !== previous.state.data.generation + 1 ||
        state.data.codeSha !== previous.state.data.codeSha || state.data.lastAttempt.at <= (previous.state.data.lastAttempt?.at ?? "")) throw Error("FDCI_STATE_TRANSITION_INVALID");
    if (state.data.lastAttempt.status !== "complete" && JSON.stringify(state.data.catalog) !== JSON.stringify(previous.state.data.catalog) ||
        state.data.lastAttempt.status === "source-error" && JSON.stringify(state.data.checkpoint) !== JSON.stringify(previous.state.data.checkpoint)) throw Error("FDCI_PARTIAL_PROMOTION_FORBIDDEN");
    const content = JSON.stringify(state) + "\n", proposed = blobSha(content);
    const confirm = async () => {
      const confirmed = await load();
      if (confirmed.revision === proposed) return { ...confirmed, recoveredAck: true };
      throw Error("FDCI_STATE_COMMIT_UNCERTAIN");
    };
    let response;
    try { response = await request(endpoint, "PUT", { branch: FDCI_STATE_BRANCH, sha: previous.revision,
      message: `FDCI state ${state.data.generation} (${state.data.lastAttempt.status})`, content: Buffer.from(content).toString("base64") }); }
    catch {
      // One read may recover a lost ACK; never retry the write blindly.
      return confirm();
    }
    if (!response.ok) throw Error([409, 422].includes(response.status) ? "FDCI_STATE_CONFLICT" : `FDCI_STATE_WRITE_HTTP_${response.status}`);
    let result;
    try { result = await response.json(); } catch { return confirm(); }
    if (result.content?.sha !== proposed) throw Error("FDCI_STATE_COMMIT_UNCERTAIN");
    return { revision: proposed, state, recoveredAck: false };
  }
  return { load, save };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "seed-local") {
    await writeFile(process.argv[3], JSON.stringify(await initialFdciState(process.argv[4])) + "\n", { flag: "wx" });
  } else if (process.argv[2] === "migrate-local") {
    const [input, output, codeSha, runId, sourceSha] = process.argv.slice(3);
    const state = await migrateOfficialFdciArtifact(JSON.parse(await readFile(input, "utf8")), { codeSha, runId: Number(runId), sourceSha });
    await writeFile(output, JSON.stringify(state) + "\n", { flag: "wx" });
  } else if (process.argv[2] === "run") {
    const sha = process.env.FDCI_STATIC_APPROVED_SHA;
    if (process.env.GITHUB_REPOSITORY !== FDCI_STATE_REPOSITORY || !hex.test(sha) || process.env.GITHUB_SHA !== sha ||
        process.env.GITHUB_REF_NAME !== "main" || process.env.GITHUB_RUN_ATTEMPT !== "1" || process.env.FDCI_DURABLE_ENABLED !== "true") throw Error("FDCI_DURABLE_RUN_DISABLED");
    const store = createFdciGitStateStore({ token: process.env.GH_TOKEN }), previous = await store.load();
    if (previous.state.data.codeSha !== sha) throw Error("FDCI_STATE_CODE_REVIEW_REQUIRED");
    const outcome = await collectDurableFdciCycle({ state: previous.state, root: ".fdci-durable-runner", fetcher: fetch, checkedAt: new Date().toISOString() });
    const saved = await store.save(previous, outcome.state);
    await mkdir("fdci-result");
    await writeFile("fdci-result/status.json", JSON.stringify({ ...outcome.view, catalog: undefined, activeItems: undefined,
      catalogSha256: saved.state.data.catalog?.sha256 ?? null, revision: saved.revision }) + "\n");
    if (saved.state.data.catalog) await writeFile("fdci-result/catalog.json", JSON.stringify(saved.state.data.catalog) + "\n");
    console.log(JSON.stringify({ generation: saved.state.data.generation, revision: saved.revision, result: outcome.result, error: outcome.error, status: outcome.view.status, updatedAt: outcome.view.updatedAt }));
    if (outcome.error) process.exitCode = 1;
  } else throw Error("FDCI_DURABLE_OPERATION_INVALID");
}
