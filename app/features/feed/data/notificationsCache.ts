/**
 * In-memory page-0 cache for notifications/mentions. Like the feed cache, the
 * value (`FeedNotificationsResult`) holds Map objects, so it is in-memory only:
 * fresh on cold launch, warm on in-session navigation. Pagination stays
 * ephemeral.
 */
import { createQueryCacheStore } from '@/shared/lib/cache/createQueryCacheStore';
import type { FeedNotificationsResult } from './feedClient';

export const notificationsPageCache = createQueryCacheStore<FeedNotificationsResult>({
  name: 'notifications-page-cache',
  logKey: 'notifications_page_cache',
  staleTtlMs: 60 * 1000,
  maxEntries: 8,
  persist: false,
});

/** Cache key for a notifications page-0 entry: every filter dimension + viewer. */
export function notificationsPageKey(args: {
  viewerPubkey: string;
  tab: string;
  policy: string;
  replyScope: string;
}): string {
  return `notif:${args.viewerPubkey}:${args.tab}:${args.policy}:${args.replyScope}`;
}
