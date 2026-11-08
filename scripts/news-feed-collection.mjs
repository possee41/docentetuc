import { createHash } from 'node:crypto';
import { NEWS_FEEDS, fetchNewsFeed } from '../lib/news-discovery.ts';
import { diagnoseNewsFeed } from './news-feed-diagnostics.mjs';
import { sealDailyState } from './daily-sync-state.mjs';

// Each feed is an independent snapshot. Never infer deletions from a failed feed.
export async function collectNewsFeeds(fetcher = fetch, now = new Date()) {
  const items = [], feeds = {};
  for (const feed of NEWS_FEEDS) {
    try {
      const articles = await diagnoseNewsFeed(feed, () => fetchNewsFeed(feed, fetcher, now));
      feeds[feed.key] = { status: 'OK', articles: articles.length, checkedAt: now.toISOString(), error: null };
      for (const article of articles) items.push({ id: createHash('sha256').update(article.url).digest('hex'), contentHash: article.fingerprint,
        article: { feedKey: feed.key, title: article.title, url: article.url, publishedAt: article.publishedAt, updatedAt: article.updatedAt, fingerprint: article.fingerprint } });
    } catch (error) {
      const code = new RegExp(`^NEWS_${feed.key.toUpperCase()}_[A-Z_]+$`).test(error?.message ?? '') ? error.message : 'NEWS_SOURCE_FAILED';
      feeds[feed.key] = { status: 'ERROR', articles: 0, checkedAt: now.toISOString(), error: code };
    }
  }
  return { items, feeds, usable: Object.values(feeds).some(f => f.status === 'OK'), complete: Object.values(feeds).every(f => f.status === 'OK') };
}

// News-only health overlay: other daily sources and their state format stay untouched.
export function newsFeedStateStore(store, collection) {
  return { load: () => store.load(), save: (previous, next) => {
    const snapshot = collection();
    if (!snapshot) return store.save(previous, next);
    const feeds = Object.fromEntries(Object.entries(snapshot.feeds).map(([key, feed]) => [key, { ...feed,
      lastSuccessAt: feed.status === 'OK' ? feed.checkedAt : previous.state.data.newsFeeds?.[key]?.lastSuccessAt ?? null }]));
    return store.save(previous, sealDailyState({ ...next.data, newsFeeds: feeds, newsCollectionComplete: snapshot.complete,
      lastSuccessAt: snapshot.complete ? next.data.lastSuccessAt : previous.state.data.lastSuccessAt }));
  } };
}

export function newsCollectionResult(result, snapshot) {
  return { ...result, batchDrained: result.completed, completed: result.completed && snapshot.complete,
    status: result.completed && snapshot.complete ? 'OK' : 'PARTIAL', feeds: snapshot.feeds };
}
