import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createDailyGitStore, runDailyBatch, validateDailyState, sealDailyState } from "./daily-sync-state.mjs";
import { resolveGatewayConfig, verifyGatewayIdentity } from './import-via-gateway.mjs';
import { callGate } from './import-gate.mjs';

export function newsTarget(config) {
  const url = new URL(config.NEWS_DISCOVERY_ORIGIN);
  const isolated=url.origin==='https://docentetuc-news-canary-1-2.possee41.workers.dev';
  if(isolated&&(config.IMPORT_GATEWAY_TARGET!=='canary'||config.IMPORT_GATEWAY_DATABASE_NAME!=='docentetuc-web-canary-1-2'||
    config.IMPORT_GATEWAY_DATABASE_ID!=='853e2f5d-89b1-46a3-9c1c-5cbd46784756'||
    ['baaf5886-0123-4948-96da-aa7106424549','00000000-0000-4000-8000-000000000012'].includes(config.IMPORT_GATEWAY_DATABASE_ID)))throw Error('NEWS_TARGET_NOT_APPROVED');
  if (!isolated && !["https://canary.docentetuc.com.ar"].includes(url.origin) ||
      url.pathname !== "/" || url.search || url.hash || url.username || url.password ||
      !/^[A-Za-z0-9_-]{32,}$/.test(config.NEWS_DISCOVERY_SECRET ?? "")) throw Error("NEWS_TARGET_NOT_APPROVED");
  return { endpoint: url.origin + "/api/internal/news-discovery", secret: config.NEWS_DISCOVERY_SECRET };
}
export async function runDailyNews(config, codeSha, { store, sourceFetch = fetch, receiverFetch = fetch, now = new Date() } = {}) {
  if (config.DAILY_SOURCES_ENABLED !== "true") throw Error("DAILY_SOURCE_DISABLED");
  const target = newsTarget(config);
  if (config.NEWS_DRY_RUN === "true") return { source: "news", dryRun: true, sourceRequests: 0, writes: 0 };
  // All registry feeds, parsed in Node. No remote HTML/XML processing in the Worker.
  let snapshot;
  const collect = async () => {
    snapshot = await collectNewsFeeds(sourceFetch, now);
    if (!snapshot.usable) throw Error('NEWS_ALL_FEEDS_FAILED');
    return { complete: true, items: snapshot.items };
  };
  const isolated=target.endpoint.startsWith('https://docentetuc-news-canary-1-2.possee41.workers.dev/');
  const owner=`${config.GITHUB_RUN_ID}-${config.GITHUB_RUN_ATTEMPT}`;
  const operation=async()=>newsCollectionResult(await runDailyBatch({ source: "news", codeSha, store: newsFeedStateStore(store,()=>snapshot), now, limit: 5,
    owner: `${config.GITHUB_RUN_ID}-${config.GITHUB_RUN_ATTEMPT}`, collect,
    send: async payload => {
      if (payload.mode !== "batch") return { ok: true }; // News health persists in the Git ledger.
      const r = await receiverFetch(target.endpoint, { method: "POST", redirect: "error",
        headers: { Authorization: `Bearer ${target.secret}`, "Content-Type": "application/json", ...(isolated?{'X-Import-Gate-Owner':owner}:{}) },
        body: JSON.stringify({ articles: [payload.items[0].article], maxCandidates: 1 }), signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw Error(`NEWS_RECEIVER_HTTP_${r.status}`);
      const ack = await r.json(), result = ack.result;
      if (ack.status !== "OK" || ack.autoPublish !== false || ack.notifications !== false || ack.totalReceived !== 1 ||
          !result || result.skipped !== 0) throw Error("NEWS_RECEIVER_ACK_INVALID");
      return { ok: true, received: 1, created: result.created, updated: result.updated, unchanged: result.unchanged };
    } }), snapshot);
  if(!isolated)return operation();
  const previous=await store.load();validateDailyState(previous.state,'news',codeSha);
  if(previous.state.data.halted||previous.state.data.inFlight)throw Error('DAILY_HALTED_REVIEW_REQUIRED');
  const gate={...config,SYNC_SOURCE:'news',NEWS_IMPORT_SECRET:target.secret,IMPORT_GATE_RUN_ID:owner,IMPORT_GATE_TTL_SECONDS:'600'};
  const identity=resolveGatewayConfig(gate,codeSha);await verifyGatewayIdentity(identity,receiverFetch);
  let attempted=false;try{attempted=true;await callGate('open',gate,receiverFetch,codeSha);return await operation();}
  finally{if(attempted)try{await callGate('close',gate,receiverFetch,codeSha);}catch{const p=await store.load();await store.save(p,sealDailyState({...p.state.data,generation:p.state.data.generation+1,halted:true}));throw Error('NEWS_GATE_CLOSE_FAILED');}}
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const c = process.env, sha = c.DAILY_APPROVED_SHA;
    const isolated=c.NEWS_DISCOVERY_ORIGIN==='https://docentetuc-news-canary-1-2.possee41.workers.dev';
    if (!isolated && c.NEWS_DISCOVERY_ORIGIN !== "https://canary.docentetuc.com.ar") throw Error("NEWS_PRODUCTION_DISABLED_IN_TEST");
    if (c.GITHUB_REPOSITORY !== "possee41/docentetuc" || c.GITHUB_RUN_ATTEMPT !== "1" ||
        c.GITHUB_REF !== (isolated?'refs/heads/release/news-canary':'refs/heads/release/daily-sync-358112c') || c.GITHUB_SHA !== sha || !/^\d+$/.test(c.GITHUB_RUN_ID ?? "") ||
        !/^[a-f0-9]{40}$/.test(sha ?? "") || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() !== sha)
      throw Error("DAILY_EXECUTION_NOT_APPROVED");
    const store = c.NEWS_DRY_RUN === "true" ? null : createDailyGitStore({ source: "news", codeSha: sha, token: c.GH_TOKEN });
    console.log(JSON.stringify(await runDailyNews(c, sha, { store })));
  } catch (error) {
    console.error(/^[A-Z0-9_]+$/.test(error?.message ?? "") ? error.message : "NEWS_DAILY_FAILED"); process.exitCode = 1;
  }
}
