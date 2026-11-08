// Public-source progress only. No Cloudflare token, SQL, artifact expiry or implicit reset.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
export const DAILY_REPOSITORY = "possee41/docentetuc";
export const DAILY_SOURCES = ["sime", "infd", "cenet", "juntas", "news"];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const blob = bytes => createHash("sha1").update(`blob ${Buffer.byteLength(bytes)}\0`).update(bytes).digest("hex");
const hex = /^[a-f0-9]{40}$/;
export const sealDailyState = data => ({ data, sha256: hash(JSON.stringify(data)) });
export function initialDailyState(source, codeSha, environment = 'canary') {
  if (!DAILY_SOURCES.includes(source) || !hex.test(codeSha) || !['canary','production'].includes(environment)) throw Error("DAILY_STATE_IDENTITY_INVALID");
  return sealDailyState({ format: 1, repository: DAILY_REPOSITORY, source, codeSha, generation: 0,
    ...(environment === 'production' ? { environment } : {}),
    confirmed: {}, queue: {}, cursor: "", owner: null, expiresAt: null, inFlight: null, halted: false,
    lastAttemptAt: null, lastSuccessAt: null, pending: 0 });
}
export function validateDailyState(state, source, codeSha) {
  const d = state?.data;
  if (!d || Buffer.byteLength(JSON.stringify(state)) > 8_000_000 || state.sha256 !== hash(JSON.stringify(d)) || d.format !== 1 || d.repository !== DAILY_REPOSITORY ||
      d.source !== source || !DAILY_SOURCES.includes(source) || d.codeSha !== codeSha || !hex.test(codeSha) ||
      !Number.isSafeInteger(d.generation) || d.generation < 0 || typeof d.halted !== "boolean" ||
      !d.confirmed || Array.isArray(d.confirmed) || typeof d.confirmed !== "object" ||
      Object.entries(d.confirmed).some(([id, h]) => !id || id.length > 260 || !/^[a-f0-9]{64}$/.test(h)) ||
      !d.queue || Array.isArray(d.queue) || typeof d.queue !== "object" || Object.entries(d.queue).some(([id, row]) =>
        id !== row?.id || !id || id.length > 260 || !/^[a-f0-9]{64}$/.test(row.contentHash)) ||
      !Number.isSafeInteger(d.pending) || d.pending < 0 || typeof d.cursor !== "string" ||
      [d.lastAttemptAt, d.lastSuccessAt, d.expiresAt].some(v => v !== null && (typeof v !== "string" || !Number.isFinite(Date.parse(v)))) ||
      d.owner !== null && !/^[A-Za-z0-9_-]{1,100}$/.test(d.owner) ||
      (d.owner === null) !== (d.expiresAt === null) ||
      d.inFlight !== null && (typeof d.inFlight !== "object" || !["start", "batch", "finish", "checkpoint"].includes(d.inFlight.mode)))
    throw Error("DAILY_STATE_INVALID");
  return state;
}

// Same Contents API CAS approach as the proven FDCI store, on a separate fixed branch.
// contents:write is repository-wide; branch restrictions here are code controls, not token scope.
export function createDailyGitStore({ source, codeSha, token, fetcher = fetch, environment = 'canary' }) {
  initialDailyState(source, codeSha, environment);
  if (!token) throw Error("DAILY_GITHUB_TOKEN_REQUIRED");
  const branch = `daily-state-${environment === 'production' ? 'production-' : ''}${source}`, path = `${source}.json`;
  const scoped = state => { validateDailyState(state, source, codeSha); if ((state.data.environment ?? 'canary') !== environment) throw Error('DAILY_STATE_ENVIRONMENT_MISMATCH'); return state; };
  const base = `https://api.github.com/repos/${DAILY_REPOSITORY}`;
  const request = (route, method = "GET", body) => fetcher(base + route, { method, redirect: "error",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.object+json", "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) });
  const decode = async item => {
    const revision = item.sha;
    if (!hex.test(revision) || item.path !== path || item.type !== "file" || !Number.isSafeInteger(item.size) || item.size < 0 || item.size > 8_000_000)
      throw Error("DAILY_STATE_PROVENANCE_INVALID");
    if (item.encoding === "none") {
      const response = await request(`/git/blobs/${revision}`);
      if (!response.ok) throw Error("DAILY_STATE_BLOB_UNAVAILABLE");
      item = await response.json();
    }
    if (item.encoding !== "base64" || typeof item.content !== "string") throw Error("DAILY_STATE_ENCODING_INVALID");
    const bytes = Buffer.from(item.content, "base64");
    if (bytes.length > 8_000_000 || blob(bytes) !== revision) throw Error("DAILY_STATE_CHECKSUM_INVALID");
    return { revision, state: scoped(JSON.parse(bytes.toString("utf8"))) };
  };
  const load = async () => {
    const r = await request(`/contents/${path}?ref=${branch}`);
    if (!r.ok) throw Error(r.status === 404 ? "DAILY_STATE_MISSING_NO_RESET" : `DAILY_STATE_READ_${r.status}`);
    return decode(await r.json());
  };
  const save = async (previous, state) => {
    scoped(previous.state); scoped(state);
    if (!hex.test(previous.revision) || state.data.generation !== previous.state.data.generation + 1) throw Error("DAILY_STATE_TRANSITION_INVALID");
    const content = JSON.stringify(state) + "\n", proposed = blob(content);
    const confirm = async () => { const actual = await load(); if (actual.revision !== proposed) throw Error("DAILY_STATE_WRITE_UNCERTAIN"); return actual; };
    let r;
    try { r = await request(`/contents/${path}`, "PUT", { branch, sha: previous.revision,
      message: `${source} progress ${state.data.generation}`, content: Buffer.from(content).toString("base64") }); }
    catch { return confirm(); } // Read back only; never retry the write.
    if (!r.ok) throw Error([409, 422].includes(r.status) ? "DAILY_STATE_CONFLICT" : `DAILY_STATE_WRITE_${r.status}`);
    let result; try { result = await r.json(); } catch { return confirm(); }
    if (result.content?.sha !== proposed) throw Error("DAILY_STATE_WRITE_UNCERTAIN");
    return { revision: proposed, state };
  };
  return { load, save, branch, path };
}

export async function runDailyBatch({ store, source, codeSha, owner, collect, send, limit = 50, now = new Date() }) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(owner) || !Number.isInteger(limit) || limit < 1 || limit > 50) throw Error("DAILY_OPTIONS_INVALID");
  let previous = await store.load();
  validateDailyState(previous.state, source, codeSha);
  let d = structuredClone(previous.state.data);
  if (d.halted || d.inFlight) throw Error("DAILY_HALTED_REVIEW_REQUIRED");
  if (d.owner && Date.parse(d.expiresAt) > now.getTime()) throw Error("DAILY_BUSY");
  const persist = async patch => {
    const next = sealDailyState({ ...d, ...patch, generation: d.generation + 1 });
    previous = await store.save(previous, next); d = structuredClone(previous.state.data);
  };
  await persist({ owner, expiresAt: new Date(now.getTime() + 1_800_000).toISOString(), lastAttemptAt: now.toISOString() });
  const deadline = performance.now() + 1_800_000;
  const write = async payload => {
    if (performance.now() >= deadline) throw Error("DAILY_LEASE_EXPIRED");
    // Persist intent BEFORE any potentially ambiguous receiver request.
    await persist({ inFlight: { mode: payload.mode, id: payload.items?.[0]?.id ?? null } });
    const ack = await send(payload);
    if (ack?.ok !== true || payload.mode === "batch" && (ack.received !== 1 ||
        ![ack.created, ack.updated, ack.unchanged].every(n => Number.isSafeInteger(n) && n >= 0) || ack.created + ack.updated + ack.unchanged !== 1))
      throw Error("DAILY_RECEIVER_ACK_INVALID");
    return ack;
  };
  try {
    const snapshot = await collect(); // Complete source validation before any receiver write.
    if (snapshot.complete !== true || !Array.isArray(snapshot.items)) throw Error("DAILY_SOURCE_INCOMPLETE");
    const items = new Map();
    for (const row of snapshot.items) {
      if (typeof row.id !== "string" || !/^[A-Za-z0-9:_-]{1,260}$/.test(row.id) ||
          ["__proto__", "constructor", "prototype"].includes(row.id) || !/^[a-f0-9]{64}$/.test(row.contentHash) ||
          items.has(row.id) && items.get(row.id).contentHash !== row.contentHash)
        throw Error("DAILY_SOURCE_CONFLICT");
      items.set(row.id, row);
    }
    const ordered = [...items.values()].sort((a, b) => a.id.localeCompare(b.id, "en"));
    const backlog = { ...d.queue };
    for (const row of ordered) {
      if (d.confirmed[row.id] === row.contentHash) delete backlog[row.id];
      else backlog[row.id] = row; // Latest complete observation supersedes an older pending version.
    }
    const pending = Object.values(backlog).sort((a, b) => a.id.localeCompare(b.id, "en"));
    const queue = [...pending.filter(row => row.id > d.cursor), ...pending.filter(row => row.id <= d.cursor)];
    const health = snapshot.health ? { health: snapshot.health } : {};
    await persist({ queue: backlog, pending: pending.length });
    await write({ mode: "start", ...health }); await persist({ inFlight: null, pending: pending.length });
    const totals = { created: 0, updated: 0, unchanged: 0 };
    for (const row of queue.slice(0, limit)) {
      const ack = await write({ mode: "batch", items: [row] });
      for (const key of Object.keys(totals)) totals[key] += ack[key];
      const remaining = { ...d.queue }; delete remaining[row.id];
      await persist({ inFlight: null, confirmed: { ...d.confirmed, [row.id]: row.contentHash }, queue: remaining, cursor: row.id, pending: d.pending - 1 });
    }
    const complete = d.pending === 0;
    if (complete) {
      await write({ mode: "finish", complete: true, count: ordered.length, ...health });
      await persist({ inFlight: null, lastSuccessAt: now.toISOString(), cursor: "" });
    }
    await persist({ owner: null, expiresAt: null });
    return { source, examined: ordered.length, processed: Math.min(queue.length, limit), pending: d.pending, completed: complete,
      ...totals, lastSuccessAt: d.lastSuccessAt, cursor: d.cursor };
  } catch (error) {
    // A source failure before writes can resume tomorrow. An uncertain receiver write cannot.
    await persist({ owner: null, expiresAt: null, halted: Boolean(d.inFlight) });
    throw error;
  }
}

// Juntas retains its own D1 checkpoints; Git provides the same durable suspension gate.
export async function runDailyCheckpoint({ store, codeSha, owner, operation, now = new Date() }) {
  const previous = await store.load(); validateDailyState(previous.state, "juntas", codeSha);
  const d = previous.state.data;
  if (d.halted || d.inFlight) throw Error("DAILY_HALTED_REVIEW_REQUIRED");
  if (d.owner && Date.parse(d.expiresAt) > now.getTime()) throw Error("DAILY_BUSY");
  let claimed = await store.save(previous, sealDailyState({ ...d, generation: d.generation + 1, owner,
    expiresAt: new Date(now.getTime() + 1_800_000).toISOString(), inFlight: { mode: "checkpoint" }, lastAttemptAt: now.toISOString() }));
  try {
    const result = await operation();
    claimed = await store.save(claimed, sealDailyState({ ...claimed.state.data, generation: claimed.state.data.generation + 1,
      owner: null, expiresAt: null, inFlight: null, pending: result.completed ? 0 : 1,
      lastSuccessAt: result.completed ? now.toISOString() : d.lastSuccessAt }));
    return { ...result, lastSuccessAt: claimed.state.data.lastSuccessAt };
  } catch (error) {
    await store.save(claimed, sealDailyState({ ...claimed.state.data, generation: claimed.state.data.generation + 1,
      owner: null, expiresAt: null, halted: true }));
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] !== "seed-local") throw Error("DAILY_STATE_OPERATION_INVALID");
  const [, , , source, codeSha, output, environment = 'canary'] = process.argv;
  if (!output) throw Error("DAILY_STATE_OUTPUT_REQUIRED");
  writeFileSync(output, JSON.stringify(initialDailyState(source, codeSha, environment)) + "\n", { flag: "wx" });
}
