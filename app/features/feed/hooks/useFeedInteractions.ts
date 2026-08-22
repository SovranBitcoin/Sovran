/**
 * @fileoverview Engagement wiring shared by every feed surface.
 *
 * Subscribes engagement for the events a viewer can act on, mirrors the
 * togglers into refs so render callbacks stay stable, and hands back the
 * video-overlay paging built from the same list. Callers only supply the rows
 * and how to read a note's base metrics.
 */

import { useMemo } from 'react';

import { useLatestRef } from '@/shared/hooks/useLatestRef';

import type { FeedItem, NoteMetrics, ProfileInfo } from '../components/nostr/feedTypes';
import { collectActionableEvents } from '../lib/feedRows';
import { useNostrEngagement } from './useNostrEngagement';
import { useVideoOverlayNavigation } from './useVideoOverlayNavigation';
import { useZap } from './useZap';

type FeedInteractionsOptions = {
  feedItems: FeedItem[];
  getMetrics: (eventId: string) => NoteMetrics;
  profilesRef: { current: Map<string, ProfileInfo> };
};

export function useFeedInteractions({
  feedItems,
  getMetrics,
  profilesRef,
}: FeedInteractionsOptions) {
  const actionableEvents = useMemo(() => collectActionableEvents(feedItems), [feedItems]);

  const { getDisplayMetrics, getEngagementState, getZapState, toggleLike, toggleRepost } =
    useNostrEngagement(actionableEvents, getMetrics);
  const toggleLikeRef = useLatestRef(toggleLike);
  const toggleRepostRef = useLatestRef(toggleRepost);
  const { openZapMenu } = useZap();
  const openZapMenuRef = useLatestRef(openZapMenu);

  const { onOverlayOpenedFromIndex, getVideoFeedLayoutsAndIndex, onSwipeUpToNextPost } =
    useVideoOverlayNavigation({
      feedItems,
      getDisplayMetrics,
      getEngagementState,
      profilesRef,
      toggleLike,
      toggleRepost,
      getZapState,
      openZapMenu,
    });

  return {
    getDisplayMetrics,
    getEngagementState,
    getZapState,
    toggleLikeRef,
    toggleRepostRef,
    openZapMenuRef,
    onOverlayOpenedFromIndex,
    getVideoFeedLayoutsAndIndex,
    onSwipeUpToNextPost,
  };
}
