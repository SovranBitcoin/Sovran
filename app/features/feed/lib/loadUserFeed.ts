import type { useFeedContentState } from '../hooks/useFeedContentState';
import { getFeedClient } from '../data/useFeedClient';
import { feedLog, log } from '@/shared/lib/logger';
import { useNostrSocialStore } from '@/shared/stores/profile/nostrSocialStore';

type UserFeedContentState = ReturnType<typeof useFeedContentState>;

export interface UserFeedLoadCtx {
  pubkey: string;
  authorName: string | undefined;
  authorPicture: string | undefined;
  isOwnProfile: boolean | undefined;
  hasMoreRef: { current: boolean };
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
  setIsLoading: (value: boolean) => void;
  setIsLoadingMore: (value: boolean) => void;
}

export async function loadUserFeedImpl(
  ctx: UserFeedLoadCtx,
  isCancelled: () => boolean
): Promise<void> {
  const {
    pubkey,
    authorName,
    authorPicture,
    isOwnProfile,
    hasMoreRef,
    paginationUntilRef,
    paginationOffsetRef,
    feedItemIdsRef,
    isFirstRender,
    deletedRepostIdsRef,
    applyPage,
    applyEnrichment,
    resetContent,
    setIsLoading,
  } = ctx;
  const client = getFeedClient();
  let hasLoadedPage = false;

  try {
    const phase1 = await client.getUserFeed({
      pubkey,
      authorName,
      authorPicture,
      limit: 50,
    });
    if (isCancelled()) return;

    paginationUntilRef.current = phase1.paginationUntil;
    hasMoreRef.current = phase1.paginationUntil > 0 && phase1.orderedFeedItems.length > 0;
    paginationOffsetRef.current = phase1.paginationOffset;
    feedItemIdsRef.current = new Set(
      phase1.orderedFeedItems.map((item) =>
        item.type === 'note' ? item.event.id : item.repostEvent.id
      )
    );

    if (isOwnProfile && deletedRepostIdsRef.current === null) {
      deletedRepostIdsRef.current = useNostrSocialStore.getState().deletedRepostOriginalIds;
    }

    const displayItems =
      isOwnProfile && deletedRepostIdsRef.current
        ? phase1.orderedFeedItems.filter((item) => {
            if (item.type !== 'repost') return true;
            return !deletedRepostIdsRef.current![item.originalEventId];
          })
        : phase1.orderedFeedItems;

    applyPage(phase1, displayItems);
    hasLoadedPage = true;
    setIsLoading(false);
    // After initial render, mark first render done so subsequent items skip animation
    requestAnimationFrame(() => {
      isFirstRender.current = false;
    });

    if (!isCancelled()) {
      const updates = await client.enrich({
        missingQuotedIds: phase1.missingQuotedIds,
        missingProfilePubkeys: phase1.missingProfilePubkeys,
      });
      if (isCancelled()) return;
      // Async enrichment lands after first paint and reflows rows (quoted
      // posts resolving, author names/avatars filling in). See HomeFeed.
      feedLog.info('feed.shift.enrich', {
        surface: 'user',
        quotedEvents: updates.quotedEvents?.size ?? 0,
        metrics: updates.metrics?.size ?? 0,
        profiles: updates.profiles?.size ?? 0,
      });
      applyEnrichment(updates);
    }
  } catch (error) {
    if (hasLoadedPage) {
      feedLog.warn('feed.user.enrich_failed', { error });
    } else {
      log.error('feed.user.load_failed', { error });
    }
    if (!isCancelled()) {
      // Enrichment only fills names, quotes and metrics. Its failure must not
      // erase the posts that a working tier has already supplied.
      if (!hasLoadedPage) resetContent();
      setIsLoading(false);
    }
  } finally {
    client.dispose?.();
  }
}
