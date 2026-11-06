// Two recoverable Git writes; never claims atomicity with the state branch or Pages/CDN.
import { createHash } from "node:crypto";
import { FDCI_STATE_REPOSITORY, validateDurableFdciState } from "./fdci-static-durable.mjs";
import { validateFdciCatalog } from "../lib/fdci-static-catalog.ts";
import { buildFdciActiveVersion, validateFdciActiveVersion } from "../lib/fdci-static-publication.ts";
const pointerPath = "fdci-catalog/active.json", hex = /^[a-f0-9]{40}$/;
const gitSha = bytes => createHash("sha1").update(`blob ${Buffer.byteLength(bytes)}\0`).update(bytes).digest("hex");
export function createFdciGitPublisher({ token, fetcher = fetch }) {
  if (!token) throw Error("FDCI_GITHUB_AUTH_REQUIRED");
  const base = `https://api.github.com/repos/${FDCI_STATE_REPOSITORY}`;
  const request = (route, method = "GET", body) => fetcher(base + route, { method, redirect: "error",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.object+json", "User-Agent": "DocenteTuc-FDCI-publication" },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
  async function read(path) {
    if (path !== pointerPath && !/^fdci-catalog\/versions\/[a-f0-9]{64}\.json$/.test(path)) throw Error("FDCI_PUBLICATION_PATH_FORBIDDEN");
    const response = await request(`/contents/${path}?ref=main`);
    if (response.status === 404) return null;
    if (!response.ok) throw Error(`FDCI_PUBLICATION_READ_HTTP_${response.status}`);
    let value = await response.json(); const revision = value.sha;
    if (value.type !== "file" || value.path !== path || !hex.test(revision) || !Number.isSafeInteger(value.size) || value.size < 0 || value.size > 2_100_000) throw Error("FDCI_PUBLICATION_METADATA_INVALID");
    if (value.encoding === "none") {
      const blob = await request(`/git/blobs/${revision}`);
      if (!blob.ok) throw Error(`FDCI_PUBLICATION_BLOB_HTTP_${blob.status}`); value = await blob.json();
    }
    if (value.encoding !== "base64" || typeof value.content !== "string") throw Error("FDCI_PUBLICATION_ENCODING_INVALID");
    const bytes = Buffer.from(value.content, "base64");
    if (bytes.length > 2_100_000 || gitSha(bytes) !== revision) throw Error("FDCI_PUBLICATION_BLOB_MISMATCH");
    return { revision, bytes, value: JSON.parse(bytes.toString("utf8")) };
  }
  async function write(path, value, previous) {
    const bytes = JSON.stringify(value) + "\n", proposed = gitSha(bytes);
    const confirm = async () => {
      const current = await read(path);
      if (current?.revision === proposed) return { revision: proposed, recoveredAck: true };
      throw Error("FDCI_PUBLICATION_COMMIT_UNCERTAIN");
    };
    let response;
    try { response = await request(`/contents/${path}`, "PUT", { branch: "main", message: `FDCI static ${path === pointerPath ? "active reference" : "immutable version"}`,
      content: Buffer.from(bytes).toString("base64"), ...(previous ? { sha: previous.revision } : {}) }); }
    catch { return confirm(); } // Read to reconcile; never blindly repeat PUT.
    if (!response.ok) {
      if (!previous && [409, 422].includes(response.status)) return confirm();
      throw Error([409, 422].includes(response.status) ? "FDCI_PUBLICATION_CONFLICT" : `FDCI_PUBLICATION_WRITE_HTTP_${response.status}`);
    }
    let result; try { result = await response.json(); } catch { return confirm(); }
    if (result.content?.sha !== proposed) throw Error("FDCI_PUBLICATION_COMMIT_UNCERTAIN");
    return { revision: proposed, recoveredAck: false };
  }
  async function reconcile(saved) {
    await validateDurableFdciState(saved.state);
    if (!hex.test(saved.revision)) throw Error("FDCI_STATE_REVISION_INVALID");
    const { catalog, generation, codeSha, lastAttempt } = saved.state.data;
    const previous = await read(pointerPath);
    if (!catalog) {
      if (previous) throw Error("FDCI_STATE_CATALOG_MISSING");
      return { changed: false, active: null }; // Partial first scan cannot publish anything.
    }
    await validateFdciCatalog(catalog);
    const active = await buildFdciActiveVersion({ generation, codeSha, lastAttempt, stateChecksum: saved.state.sha256, stateRevision: saved.revision,
      catalogSha256: catalog.sha256, catalogUpdatedAt: catalog.updatedAt });
    if (previous) {
      const current = await validateFdciActiveVersion(previous.value);
      if (current.generation > generation || current.generation === generation && current.sha256 !== active.sha256 || current.catalogUpdatedAt > catalog.updatedAt)
        throw Error("FDCI_PUBLICATION_STALE_STATE");
    }
    const path = `fdci-catalog/${active.versionPath}`, version = await read(path);
    if (version) {
      await validateFdciCatalog(version.value);
      if (version.value.sha256 !== catalog.sha256 || version.bytes.toString("utf8") !== JSON.stringify(catalog) + "\n") throw Error("FDCI_IMMUTABLE_VERSION_CONFLICT");
    } else await write(path, catalog, null);
    if (previous?.value.sha256 === active.sha256) return { changed: !version, active, revision: previous.revision, repairedVersion: !version };
    const committed = await write(pointerPath, active, previous);
    return { changed: true, active, ...committed };
  }
  return { reconcile };
}
