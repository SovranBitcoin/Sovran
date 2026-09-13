import { readIsUnavailable, type FeedParseResult } from '../data/feedClient';
import type { useFeedContentState } from '../hooks/useFeedContentState';
import { getFeedClient } from '../data/useFeedClient';
import { feedLog } from '@/shared/lib/logger';

type UserFeedContentState = ReturnType<typeof useFeedContentState>;

/** The refs + setters the load-more path (UserFeed's `loadMoreUserItemsImpl`) works over. */
export interface UserFeedLoadCtx {
  pubkey: string;
  authorName: string | undefined;
  authorPicture: string | undefined;
  isOwnProfile: boolean | undefined;
  hasMoreRef: { current: boolean };
  paginationCursorRef: { current: FeedParseResult['paginationCursor'] };
  paginationUntilRef: { current: number };
  paginationOffsetRef: { current: number };
  loadingMoreRef: { current: boolean };
  feedItemIdsRef: { current: Set<string> };
  activeLoadMoreIdRef: { current: string | null };
  isFirstRender: { current: boolean };
  deletedRepostIdsRef: { current: Record<string, number> | null };
  quotedRef: UserFeedContentState['quotedRef'];
  profilesRef: UserFeedContentState['profilesRef'];
  applyPage: UserFeedContentState['applyPage'];
  appendPage: UserFeedContentState['appendPage'];
  applyEnrichment: UserFeedContentState['applyEnrichment'];
  resetContent: UserFeedContentState['resetContent'];
  setIsLoadingMore: (value: boolean) => void;
}

/**
 * Page 0 of an author's feed through the feed client, with the client disposed
 * whatever happens. Module scope: React Compiler cannot lower a `try` with a
 * `finally`, and an inline body would cost UserFeed its memoization.
 *
 * A tier-exhausted answer with nothing to show is thrown (SYSTEM.md F06) so the
 * read hook reports an error instead of caching an empty page as "no posts".
 */
export async function fetchUserFeedPage(args: {
  pubkey: string;
  authorName: string | undefined;
  authorPicture: string | undefined;
  signal: AbortSignal | undefined;
  readId?: string;
}): Promise<FeedParseResult> {
  const client = getFeedClient();
  try {
    const page = await client.getUserFeed({
      pubkey: args.pubkey,
      authorName: args.authorName,
      authorPicture: args.authorPicture,
      limit: 50,
      signal: args.signal,
      readId: args.readId,
    });
    if (readIsUnavailable(page.read) && page.orderedFeedItems.length === 0) {
      throw new Error('profile feed unavailable');
    }
    return page;
  } finally {
    client.dispose?.();
  }
}

/**
 * Post-paint enrichment for a painted page: quoted posts resolving, author
 * names/avatars filling in. Its failure must not erase the posts a working
 * tier already supplied, so it never throws.
 */
export async function enrichUserFeedPage(
  page: Pick<FeedParseResult, 'missingQuotedIds' | 'missingProfilePubkeys'>,
  ctx: {
    isCancelled: () => boolean;
    applyEnrichment: UserFeedContentState['applyEnrichment'];
  }
): Promise<void> {
  if (page.missingQuotedIds.length === 0 && page.missingProfilePubkeys.length === 0) return;
  const client = getFeedClient();
  try {
    const updates = await client.enrich({
      missingQuotedIds: page.missingQuotedIds,
      missingProfilePubkeys: page.missingProfilePubkeys,
    });
    if (ctx.isCancelled()) return;
    // Async enrichment lands after first paint and reflows rows (quoted
    // posts resolving, author names/avatars filling in). See HomeFeed.
    feedLog.info('feed.shift.enrich', {
      surface: 'user',
      quotedEvents: updates.quotedEvents?.size ?? 0,
      metrics: updates.metrics?.size ?? 0,
      profiles: updates.profiles?.size ?? 0,
    });
    ctx.applyEnrichment(updates);
  } catch (error) {
    feedLog.warn('feed.user.enrich_failed', { error });
  } finally {
    client.dispose?.();
  }
}
