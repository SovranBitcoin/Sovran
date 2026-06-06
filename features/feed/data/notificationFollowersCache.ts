/**
 * In-memory page-0 cache for the Follows list. Like the feed and notifications
 * caches, the value (`FeedNotificationsResult`) holds Map objects, so it is
 * in-memory only: fresh on cold launch, warm on in-session navigation so
 * re-entering the Follows page paints instantly. Pagination stays ephemeral.
 */
import { createQueryCacheStore } from '@/shared/lib/cache/createQueryCacheStore';
import type { FeedNotificationsResult } from './feedClient';

export const notificationFollowersCache = createQueryCacheStore<FeedNotificationsResult>({
  name: 'notification-followers-page-cache',
  logKey: 'notification_followers_page_cache',
  staleTtlMs: 2 * 60 * 1000,
  maxEntries: 4,
  persist: false,
});

/** Cache key for a Follows page-0 entry: viewer. */
export function notificationFollowersKey(viewerPubkey: string): string {
  return `followers:${viewerPubkey}`;
}
