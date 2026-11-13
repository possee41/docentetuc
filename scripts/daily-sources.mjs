import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { writeFileSync, existsSync } from "node:fs";
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
export async function runDailySource(config, codeSha, { store, sourceFetch = fetch, receiverFetch = fetch, now = new Date(), signal } = {}) {
  if (config.DAILY_SOURCES_ENABLED !== "true" || !["sime", "infd", "cenet", "juntas"].includes(config.SYNC_SOURCE)) throw Error("DAILY_SOURCE_DISABLED");
  const secretName = `${config.SYNC_SOURCE.toUpperCase()}_IMPORT_SECRET`;
  config = { ...config, [secretName]: config[secretName] || config.DAILY_IMPORT_SECRET };
  const target = resolveGatewayConfig(config, codeSha);
  const sime = target.source === 'sime', invocations = [];
  if (sime && config.IMPORT_GATEWAY_TARGET === 'production') {
    if (config.GITHUB_REPOSITORY !== 'possee41/docentetuc' || config.GITHUB_REF !== 'refs/heads/fix/navigation-community-1.1' ||
        config.GITHUB_RUN_ATTEMPT !== '1' || !/^[1-9]\d*$/.test(config.GITHUB_RUN_ID || '')) throw Error('SIME_PRODUCTION_EXECUTION_FORBIDDEN');
    if (config.DAILY_EVENT_NAME === 'schedule') {
      if (config.SIME_PRODUCTION_DAILY_ENABLED !== 'true') throw Error('SIME_PRODUCTION_DAILY_DISABLED');
    } else if (config.DAILY_EVENT_NAME !== 'workflow_dispatch' || config.GITHUB_ACTOR_ID !== '296786704' ||
        config.SIME_PRODUCTION_RECOVERY_ENABLED !== 'true' || config.SIME_PRODUCTION_RECOVERY_CONFIRM !== 'true')
      throw Error('SIME_PRODUCTION_RECOVERY_NOT_APPROVED');
  }
  const rawReceiver = receiverFetch;
  if (sime) receiverFetch = async (input, init = {}) => {
    const started = performance.now(), url = new URL(input), operation = init.body ? JSON.parse(init.body).action || JSON.parse(init.body).mode : 'read';
    try {
      const response = await rawReceiver(input, init);
      invocations.push({ path: url.pathname, operation, http: response.status, rayId: response.headers.get('cf-ray'), wallMs: performance.now()-started });
      return response;
    } catch (error) { invocations.push({ path:url.pathname,operation,http:null,wallMs:performance.now()-started,error:'NETWORK_ERROR' });throw error; }
  };
  // Never repurpose or reopen the retired production FDCI gateway.
  if (config.IMPORT_GATEWAY_TARGET === "production" &&
      new URL(target.origin).hostname !== "docentetuc-sources-1-2.possee41.workers.dev") throw Error("DAILY_RETIRED_GATEWAY_FORBIDDEN");
  const initial = await store.load(); validateDailyState(initial.state, target.source, codeSha);
  if (config.IMPORT_GATEWAY_TARGET === 'production' &&
      (!['sime','infd','cenet'].includes(target.source) || config.DAILY_STATE_ENVIRONMENT !== 'production' || initial.state.data.environment !== 'production'))
    throw Error('DAILY_PRODUCTION_STATE_REQUIRED');
  if (initial.state.data.halted || initial.state.data.inFlight) throw Error("DAILY_HALTED_REVIEW_REQUIRED");
  const recoveryRunId = sime && config.IMPORT_GATEWAY_TARGET === 'production' && config.DAILY_EVENT_NAME === 'workflow_dispatch' ? config.GITHUB_RUN_ID : undefined;
  if (recoveryRunId && initial.state.data.recoveryRunId) throw Error('DAILY_RECOVERY_ALREADY_USED_OR_INVALID');
  if (sime && signal?.aborted) throw Error('SIME_CANCELLED');
  try { await verifyGatewayIdentity(target, receiverFetch); }
  catch (error) {
    await store.save(initial, sealDailyState({ ...initial.state.data, generation: initial.state.data.generation + 1, halted: true }));
    throw error;
  }
  const owner = `${config.GITHUB_RUN_ID}-${config.GITHUB_RUN_ATTEMPT}`;
  const gateConfig = { ...config, IMPORT_GATE_RUN_ID: owner, IMPORT_GATE_TTL_SECONDS: "600" };
  let deadline = Infinity, closed = null;
  const check = () => { if (sime && signal?.aborted) throw Error('SIME_CANCELLED'); if (sime && Date.now() >= deadline) throw Error('DAILY_LEASE_EXPIRED'); };
  const ownedFetch = (url, init = {}) => { check(); return receiverFetch(url, { ...init,
    headers: { ...Object.fromEntries(new Headers(init.headers)), "X-Import-Gate-Owner": owner }, redirect: "error",
    ...(sime ? {signal:AbortSignal.any([AbortSignal.timeout(Math.max(1,Math.min(20_000,deadline-Date.now()))),...(init.signal?[init.signal]:[]),...(signal?[signal]:[])])}: {}) });
  };
  const boundedSource = (url, init = {}) => {
    check();
    return sourceFetch(url, { ...init, ...(sime && Number.isFinite(deadline) ? {
      signal: AbortSignal.any([AbortSignal.timeout(Math.max(1,Math.min(15_000,deadline-Date.now()))), ...(init.signal ? [init.signal] : []),...(signal?[signal]:[])]) } : {}) });
  };
  const operation = async () => {
    let attempted = false;
    const open = async () => { check(); attempted = true; const ack = await callGate("open", gateConfig, receiverFetch, codeSha);
      deadline = Date.parse(ack.expiresAt);
      if (sime && (!Number.isFinite(deadline) || deadline <= Date.now() || deadline > Date.now()+600_000)) throw Error('DAILY_LEASE_EXPIRY_INVALID'); };
    try {
      if (target.source === "juntas") { await open(); return await runGatewayImport(target, config, sourceFetch, ownedFetch); }
      return await runDailyBatch({ source: target.source, codeSha, store, now, owner, limit: 50, recoveryRunId, check,
        collect: async () => { await open(); return collectDailySnapshot(target, { sourceFetch: sime ? boundedSource : sourceFetch, receiverFetch: ownedFetch, now }); },
        send: dailyReceiver(target, ownedFetch) });
    } finally {
      if (attempted) {
        try { await callGate("close", gateConfig, receiverFetch, codeSha); closed = true; }
        catch {
          closed = false;
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
  try { const result = await operation(); return sime ? { ...result, closed, invocations } : result; }
  catch (error) { if (sime) error.diagnostics = { closed, invocations }; throw error; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController(),abort=()=>controller.abort();
  if(process.env.SYNC_SOURCE==='sime'){process.once('SIGINT',abort);process.once('SIGTERM',abort);}
  try {
    const c = process.env, sha = c.DAILY_APPROVED_SHA;
    if(c.SYNC_SOURCE==='sime'&&existsSync('sime-production-result.json'))throw Error('SIME_RESULT_ALREADY_EXISTS');
    if (c.GITHUB_REPOSITORY !== "possee41/docentetuc" || c.GITHUB_RUN_ATTEMPT !== "1" || !/^[a-f0-9]{40}$/.test(sha ?? "") ||
        c.GITHUB_REF !== `refs/heads/${c.DAILY_DEFAULT_BRANCH}` || !/^\d+$/.test(c.GITHUB_RUN_ID ?? "") ||
        execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() !== sha) throw Error("DAILY_EXECUTION_NOT_APPROVED");
    const store = createDailyGitStore({ source: c.SYNC_SOURCE, codeSha: sha, token: c.GH_TOKEN,
      environment: c.IMPORT_GATEWAY_TARGET === 'production' ? 'production' : 'canary' });
    const result = await runDailySource(c, sha, { store, signal:controller.signal });
    if (c.SYNC_SOURCE === 'sime') writeFileSync('sime-production-result.json', JSON.stringify({runId:c.GITHUB_RUN_ID,codeSha:sha,...result})+'\n',{flag:'wx'});
    console.log(JSON.stringify(result));
  } catch (error) {
    if (process.env.SYNC_SOURCE === 'sime'&&!existsSync('sime-production-result.json')) {
      try { writeFileSync('sime-production-result.json', JSON.stringify({runId:process.env.GITHUB_RUN_ID,codeSha:process.env.DAILY_APPROVED_SHA,
        failed:true,code:/^[A-Z0-9_]+$/.test(error?.message || '')?error.message:'DAILY_SYNC_FAILED',...error.diagnostics})+'\n',{flag:'wx'}); }
      catch { console.error('SIME_RESULT_LOCAL_WRITE_FAILED'); }
    }
    console.error(/^[A-Z0-9_]+$/.test(error?.message ?? "") ? error.message : "DAILY_SYNC_FAILED"); process.exitCode = 1;
  } finally {process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
}
