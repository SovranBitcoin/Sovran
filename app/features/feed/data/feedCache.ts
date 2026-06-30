/**
 * In-memory page-0 cache for the home feed. The cached value is a
 * `FeedParseResult` which holds Map objects, so it is NOT persisted (Maps don't
 * survive JSON) — and an in-memory store is exactly what we want anyway: it
 * resets on every cold launch (fresh fetch), but survives warm navigation
 * within a session so returning to the feed paints instantly.
 *
 * Only page 0 is cached; infinite-scroll pages stay ephemeral in the screen.
 */
import { createQueryCacheStore } from '@/shared/lib/cache/createQueryCacheStore';
import type { FeedParseResult } from './feedClient';

export const feedPageCache = createQueryCacheStore<FeedParseResult>({
  name: 'feed-page-cache',
  logKey: 'feed_page_cache',
  staleTtlMs: 2 * 60 * 1000, // personalized ranked feed rotates fast
  maxEntries: 12,
  persist: false,
});

/** Cache key for a feed page-0 entry: spec + viewer. */
export function feedPageKey(spec: string, viewerPubkey: string | undefined): string {
  return `feed:${spec}:${viewerPubkey || 'host'}`;
}
