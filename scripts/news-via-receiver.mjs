import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { NEWS_FEEDS, fetchNewsFeed } from "../lib/news-discovery.ts";
import { createDailyGitStore, runDailyBatch } from "./daily-sync-state.mjs";
import { diagnoseNewsFeed } from './news-feed-diagnostics.mjs';

export function newsTarget(config) {
  const url = new URL(config.NEWS_DISCOVERY_ORIGIN);
  if (!["https://docentetuc.com.ar", "https://canary.docentetuc.com.ar"].includes(url.origin) ||
      url.pathname !== "/" || url.search || url.hash || url.username || url.password ||
      !/^[A-Za-z0-9_-]{32,}$/.test(config.NEWS_DISCOVERY_SECRET ?? "") ||
      url.hostname === "docentetuc.com.ar" && config.DAILY_PRODUCTION_APPROVED !== "true") throw Error("NEWS_TARGET_NOT_APPROVED");
  return { endpoint: url.origin + "/api/internal/news-discovery", secret: config.NEWS_DISCOVERY_SECRET };
}
export async function runDailyNews(config, codeSha, { store, sourceFetch = fetch, receiverFetch = fetch, now = new Date() } = {}) {
  if (config.DAILY_SOURCES_ENABLED !== "true") throw Error("DAILY_SOURCE_DISABLED");
  const target = newsTarget(config);
  if (config.NEWS_DRY_RUN === "true") return { source: "news", dryRun: true, sourceRequests: 0, writes: 0 };
  // All registry feeds, parsed in Node. No remote HTML/XML processing in the Worker.
  const collect = async () => {
    const items = [];
    for (const feed of NEWS_FEEDS) for (const article of await diagnoseNewsFeed(feed,()=>fetchNewsFeed(feed, sourceFetch, now))) {
      items.push({ id: createHash("sha256").update(article.url).digest("hex"), contentHash: article.fingerprint,
        article: { feedKey: feed.key, title: article.title, url: article.url, publishedAt: article.publishedAt,
          updatedAt: article.updatedAt, fingerprint: article.fingerprint } });
    }
    return { complete: true, items };
  };
  return runDailyBatch({ source: "news", codeSha, store, now, limit: 5,
    owner: `${config.GITHUB_RUN_ID}-${config.GITHUB_RUN_ATTEMPT}`, collect,
    send: async payload => {
      if (payload.mode !== "batch") return { ok: true }; // News health persists in the Git ledger.
      const r = await receiverFetch(target.endpoint, { method: "POST", redirect: "error",
        headers: { Authorization: `Bearer ${target.secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ articles: [payload.items[0].article], maxCandidates: 1 }), signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw Error(`NEWS_RECEIVER_HTTP_${r.status}`);
      const ack = await r.json(), result = ack.result;
      if (ack.status !== "OK" || ack.autoPublish !== false || ack.notifications !== false || ack.totalReceived !== 1 ||
          !result || result.skipped !== 0) throw Error("NEWS_RECEIVER_ACK_INVALID");
      return { ok: true, received: 1, created: result.created, updated: result.updated, unchanged: result.unchanged };
    } });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const c = process.env, sha = c.DAILY_APPROVED_SHA;
    if (c.GITHUB_REPOSITORY !== "possee41/docentetuc" || c.GITHUB_RUN_ATTEMPT !== "1" ||
        c.GITHUB_REF !== `refs/heads/${c.DAILY_DEFAULT_BRANCH}` || !/^\d+$/.test(c.GITHUB_RUN_ID ?? "") ||
        !/^[a-f0-9]{40}$/.test(sha ?? "") || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() !== sha)
      throw Error("DAILY_EXECUTION_NOT_APPROVED");
    const store = c.NEWS_DRY_RUN === "true" ? null : createDailyGitStore({ source: "news", codeSha: sha, token: c.GH_TOKEN });
    console.log(JSON.stringify(await runDailyNews(c, sha, { store })));
  } catch (error) {
    console.error(/^[A-Z0-9_]+$/.test(error?.message ?? "") ? error.message : "NEWS_DAILY_FAILED"); process.exitCode = 1;
  }
}
