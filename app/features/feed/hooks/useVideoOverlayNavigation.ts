import { useCallback, useMemo, useRef } from 'react';

import type { ImageOverlayReplaceLayout } from '../components/nostr/image-overlay';
import type { FeedEvent, FeedItem } from '../components/nostr/feedTypes';
import {
  MAX_VIDEO_FEED_PAGES,
  buildVideoOverlayLayout,
  computeFeedIndicesWithVideo,
} from '../components/nostr/videoLayout';

type LayoutArgs = Parameters<typeof buildVideoOverlayLayout>;

interface Options {
  feedItems: FeedItem[];
  getDisplayMetrics: LayoutArgs[2];
  getEngagementState: LayoutArgs[3];
  profilesRef: LayoutArgs[4];
  /** Engagement togglers may be async; the overlay ignores their result. */
  toggleLike: (event: FeedEvent) => unknown;
  toggleRepost: (event: FeedEvent) => unknown;
  getZapState: NonNullable<LayoutArgs[7]>['getZapState'];
  openZapMenu: NonNullable<LayoutArgs[7]>['openZapMenu'];
}

/**
 * Video-overlay paging for a feed list: remembers which feed index opened the
 * overlay, builds the page stack of video posts from that point forward, and
 * advances to the next video post on swipe-up. Shared by HomeFeed and UserFeed.
 */
export function useVideoOverlayNavigation({
  feedItems,
  getDisplayMetrics,
  getEngagementState,
  profilesRef,
  toggleLike,
  toggleRepost,
  getZapState,
  openZapMenu,
}: Options) {
  const overlaySourceIndexRef = useRef(-1);
  const feedIndicesWithVideo = useMemo(() => computeFeedIndicesWithVideo(feedItems), [feedItems]);

  const onOverlayOpenedFromIndex = useCallback((index: number) => {
    overlaySourceIndexRef.current = index;
  }, []);

  const buildLayoutForVideoIndex = useCallback(
    (feedIndex: number): ImageOverlayReplaceLayout | null =>
      buildVideoOverlayLayout(
        feedIndex,
        feedItems,
        getDisplayMetrics,
        getEngagementState,
        profilesRef,
        toggleLike,
        toggleRepost,
        { getZapState, openZapMenu }
      ),
    [
      feedItems,
      getDisplayMetrics,
      getEngagementState,
      getZapState,
      openZapMenu,
      profilesRef,
      toggleLike,
      toggleRepost,
    ]
  );

  const getVideoFeedLayoutsAndIndex = useCallback((): {
    layouts: ImageOverlayReplaceLayout[];
    initialIndex: number;
  } | null => {
    const start = overlaySourceIndexRef.current;
    const indices = feedIndicesWithVideo.filter((i) => i >= start).slice(0, MAX_VIDEO_FEED_PAGES);
    const layouts = indices
      .map((i) => buildLayoutForVideoIndex(i))
      .filter((l): l is ImageOverlayReplaceLayout => l != null);
    return layouts.length ? { layouts, initialIndex: 0 } : null;
  }, [feedIndicesWithVideo, buildLayoutForVideoIndex]);

  const onSwipeUpToNextPost = useCallback(
    (openNext: (layout: ImageOverlayReplaceLayout) => void) => {
      const current = overlaySourceIndexRef.current;
      const nextVideoIndex = feedIndicesWithVideo.find((i) => i > current);
      if (typeof nextVideoIndex !== 'number') return;
      const layout = buildLayoutForVideoIndex(nextVideoIndex);
      if (!layout) return;
      overlaySourceIndexRef.current = nextVideoIndex;
      openNext(layout);
    },
    [feedIndicesWithVideo, buildLayoutForVideoIndex]
  );

  return { onOverlayOpenedFromIndex, getVideoFeedLayoutsAndIndex, onSwipeUpToNextPost };
}
