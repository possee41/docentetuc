import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { runSimeImport } from "./import-sime.mjs";
import { runPublicSourceImport } from "./import-public-sources.mjs";
import { resolveGatewayConfig, verifyGatewayIdentity, runGatewayImport } from "./import-via-gateway.mjs";
import { createDailyGitStore, runDailyBatch, runDailyCheckpoint, sealDailyState, validateDailyState } from "./daily-sync-state.mjs";
import { callGate } from "./import-gate.mjs";

// Reuse collectors unchanged. Their writes are staged in Node, not sent to D1.
export async function collectDailySnapshot(target, { sourceFetch = fetch, receiverFetch = fetch, now = new Date() } = {}) {
  const items = [], health = new Set(); let complete = false;
  const stage = async (url, init = {}) => {
    if (init.method === "GET" || !init.method) return receiverFetch(url, init); // SIME prior public metadata only.
    const payload = JSON.parse(init.body);
    if (payload.mode === "error") return Response.json({ ok: true });
    for (const name of payload.health ?? []) health.add(name);
    if (payload.mode === "finish") complete = payload.complete === true;
    if (payload.mode === "batch") items.push(...payload.items);
    return Response.json({ ok: true, received: payload.items?.length ?? 0, created: payload.items?.length ?? 0,
      updated: 0, unchanged: 0, queries: 0, rowsRead: 0, rowsWritten: 0 });
  };
  if (target.source === "sime") await runSimeImport({ endpoint: target.endpoint, token: target.secret, sourceFetch, receiverFetch: stage, now });
  else if (["infd", "cenet"].includes(target.source)) await runPublicSourceImport({ source: target.source,
    endpoint: target.endpoint, token: target.secret, sourceFetch, receiverFetch: stage, now });
  else throw Error("DAILY_SOURCE_UNSUPPORTED");
  return { items, complete, ...(health.size ? { health: [...health] } : {}) };
}
export function dailyReceiver(target, fetcher = fetch) {
  return async payload => {
    const r = await fetcher(target.endpoint, { method: "POST", redirect: "error",
      headers: { Authorization: `Bearer ${target.secret}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw Error(`DAILY_RECEIVER_HTTP_${r.status}`);
    return r.json();
  };
}
export async function runDailySource(config, codeSha, { store, sourceFetch = fetch, receiverFetch = fetch, now = new Date() } = {}) {
  if (config.DAILY_SOURCES_ENABLED !== "true" || !["sime", "infd", "cenet", "juntas"].includes(config.SYNC_SOURCE)) throw Error("DAILY_SOURCE_DISABLED");
  const secretName = `${config.SYNC_SOURCE.toUpperCase()}_IMPORT_SECRET`;
  config = { ...config, [secretName]: config[secretName] || config.DAILY_IMPORT_SECRET };
  const target = resolveGatewayConfig(config, codeSha);
  // Never repurpose or reopen the retired production FDCI gateway.
  if (config.IMPORT_GATEWAY_TARGET === "production") throw Error("DAILY_RETIRED_GATEWAY_FORBIDDEN");
  if (!/^docentetuc-sources-canary-1-2(?:-local)?$/.test(target.name) ||
      !["docentetuc-sources-canary-1-2.possee41.workers.dev", "127.0.0.1"].includes(new URL(target.origin).hostname)) throw Error("DAILY_CANARY_IDENTITY_REQUIRED");
  if (target.origin.startsWith("https:") && target.id === "00000000-0000-4000-8000-000000000012") throw Error("DAILY_CANARY_DATABASE_NOT_CONFIGURED");
  const initial = await store.load(); validateDailyState(initial.state, target.source, codeSha);
  if (initial.state.data.halted || initial.state.data.inFlight) throw Error("DAILY_HALTED_REVIEW_REQUIRED");
  try { await verifyGatewayIdentity(target, receiverFetch); }
  catch (error) {
    await store.save(initial, sealDailyState({ ...initial.state.data, generation: initial.state.data.generation + 1, halted: true }));
    throw error;
  }
  const owner = `${config.GITHUB_RUN_ID}-${config.GITHUB_RUN_ATTEMPT}`;
  const gateConfig = { ...config, IMPORT_GATE_RUN_ID: owner, IMPORT_GATE_TTL_SECONDS: "600" };
  const ownedFetch = (url, init = {}) => receiverFetch(url, { ...init,
    headers: { ...Object.fromEntries(new Headers(init.headers)), "X-Import-Gate-Owner": owner }, redirect: "error" });
  const operation = async () => {
    let attempted = false;
    const open = async () => { attempted = true; await callGate("open", gateConfig, receiverFetch, codeSha); };
    try {
      if (target.source === "juntas") { await open(); return await runGatewayImport(target, config, sourceFetch, ownedFetch); }
      return await runDailyBatch({ source: target.source, codeSha, store, now, owner, limit: 50,
        collect: async () => { await open(); return collectDailySnapshot(target, { sourceFetch, receiverFetch: ownedFetch, now }); },
        send: dailyReceiver(target, ownedFetch) });
    } finally {
      if (attempted) {
        try { await callGate("close", gateConfig, receiverFetch, codeSha); }
        catch {
          if (target.source !== "juntas") {
            const p = await store.load();
            await store.save(p, sealDailyState({ ...p.state.data, generation: p.state.data.generation + 1, halted: true }));
          }
          throw Error("DAILY_GATE_CLOSE_FAILED");
        }
      }
    }
  };
  if (target.source === "juntas") return runDailyCheckpoint({ store, codeSha, owner, operation, now });
  // Check persistent suspension before attempting to open any source concession.
  const previous = await store.load();
  if (previous.state.data.halted || previous.state.data.inFlight) throw Error("DAILY_HALTED_REVIEW_REQUIRED");
  return operation();
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const c = process.env, sha = c.DAILY_APPROVED_SHA;
    if (c.GITHUB_REPOSITORY !== "possee41/docentetuc" || c.GITHUB_RUN_ATTEMPT !== "1" || !/^[a-f0-9]{40}$/.test(sha ?? "") ||
        c.GITHUB_REF !== "refs/heads/release/daily-sync-358112c" || c.GITHUB_SHA !== sha || !/^\d+$/.test(c.GITHUB_RUN_ID ?? "") ||
        execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() !== sha) throw Error("DAILY_EXECUTION_NOT_APPROVED");
    const store = createDailyGitStore({ source: c.SYNC_SOURCE, codeSha: sha, token: c.GH_TOKEN });
    console.log(JSON.stringify(await runDailySource(c, sha, { store })));
  } catch (error) {
    console.error(/^[A-Z0-9_]+$/.test(error?.message ?? "") ? error.message : "DAILY_SYNC_FAILED"); process.exitCode = 1;
  }
}
