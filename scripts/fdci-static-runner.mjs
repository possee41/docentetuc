import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { initialFdciState, validateDurableFdciState, createFdciGitStateStore, collectDurableFdciCycle, FDCI_STATE_REPOSITORY } from "./fdci-static-durable.mjs";
import { createFdciGitPublisher } from "./fdci-static-publisher.mjs";

export async function runIntegratedFdci({ store, publisher, codeSha, root, sourceFetch, checkedAt, pause, recoverOnly = true }) {
  const previous = await store.load();
  if (previous.state.data.codeSha !== codeSha) throw Error("FDCI_STATE_CODE_REVIEW_REQUIRED");
  // Repair publication from already-confirmed Git state before considering another source query.
  const recovered = await publisher.reconcile(previous);
  if (recoverOnly || recovered.changed) return { status: "publication-reconciled", collected: false, publication: recovered };
  const outcome = await collectDurableFdciCycle({ state: previous.state, root, fetcher: sourceFetch, checkedAt, pause });
  const saved = await store.save(previous, outcome.state); // State and publication are separate commits/branches.
  const publication = await publisher.reconcile(saved);
  return { status: outcome.error ? "source-error" : outcome.result.status, collected: true, result: outcome.result, error: outcome.error,
    stateGeneration: saved.state.data.generation, publication };
}

// Explicit local review of a new executable revision; never automatic during synchronization.
export async function reviewFdciExecutable(bytes, { expectedRevision, expectedChecksum, oldCodeSha, newCodeSha }) {
  const { createHash } = await import("node:crypto");
  const revision = createHash("sha1").update(`blob ${Buffer.byteLength(bytes)}\0`).update(bytes).digest("hex");
  const state = await validateDurableFdciState(JSON.parse(bytes));
  if (revision !== expectedRevision || state.sha256 !== expectedChecksum || state.data.codeSha !== oldCodeSha || oldCodeSha === newCodeSha)
    throw Error("FDCI_CODE_REVIEW_PROVENANCE_INVALID");
  await initialFdciState(newCodeSha); // Reuse strict SHA validation, without initializing any state.
  const { catalogHash } = await import("../lib/fdci-static-catalog.ts");
  const data = { ...state.data, codeSha: newCodeSha, generation: state.data.generation + 1 };
  return validateDurableFdciState({ data, sha256: await catalogHash(data) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "review-local") {
    const [input, output, expectedRevision, expectedChecksum, oldCodeSha, newCodeSha] = process.argv.slice(3);
    const reviewed = await reviewFdciExecutable(await readFile(input, "utf8"), { expectedRevision, expectedChecksum, oldCodeSha, newCodeSha });
    await writeFile(output, JSON.stringify(reviewed) + "\n", { flag: "wx" });
  } else if (process.argv[2] === "run") {
    const codeSha = process.env.FDCI_STATIC_APPROVED_SHA;
    if (process.env.GITHUB_REPOSITORY !== FDCI_STATE_REPOSITORY || process.env.GITHUB_REF_NAME !== "main" ||
        process.env.GITHUB_RUN_ATTEMPT !== "1" || process.env.FDCI_INTEGRATED_ENABLED !== "true" || !/^[a-f0-9]{40}$/.test(codeSha ?? "")) throw Error("FDCI_INTEGRATED_RUN_DISABLED");
    const actual = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim();
    if (actual !== codeSha) throw Error("FDCI_EXECUTABLE_SHA_MISMATCH");
    const token = process.env.GH_TOKEN;
    const result = await runIntegratedFdci({ store: createFdciGitStateStore({ token }), publisher: createFdciGitPublisher({ token }), codeSha,
      root: ".fdci-integrated-runner", sourceFetch: fetch, checkedAt: new Date().toISOString(), recoverOnly: process.env.FDCI_RECOVER_ONLY !== "false" });
    await mkdir("fdci-integrated-result");
    await writeFile("fdci-integrated-result/result.json", JSON.stringify(result) + "\n");
    console.log(JSON.stringify(result)); if (result.error) process.exitCode = 1;
  } else throw Error("FDCI_INTEGRATED_OPERATION_INVALID");
}
