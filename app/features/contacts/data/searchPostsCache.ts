/**
 * In-memory cache for the "Posts" search sub-tab (recent posts by the people
 * matching a query). The value is a `FeedParseResult` which holds Map objects,
 * so it is NOT persisted — and in-memory is exactly right: it resets on cold
 * launch but survives warm navigation within a session, so returning to the
 * Posts tab for the same query paints instantly instead of refetching.
 *
 * Keyed by the comma-joined matched pubkeys, so a different result set is a
 * different (cold) key. Not viewer-specific.
 */
import { createQueryCacheStore } from '@/shared/lib/cache/createQueryCacheStore';
import type { FeedParseResult } from '@/features/feed/data/feedClient';

export const searchPostsCache = createQueryCacheStore<FeedParseResult>({
  name: 'search-posts-cache',
  logKey: 'search_posts_cache',
  staleTtlMs: 2 * 60 * 1000,
  maxEntries: 12,
  persist: false,
});

/** Cache key for a Posts-search entry: the comma-joined matched pubkeys. */
export function searchPostsKey(pubkeysKey: string): string {
  return `search-posts:${pubkeysKey}`;
}
