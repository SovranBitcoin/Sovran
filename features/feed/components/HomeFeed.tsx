/**
 * @fileoverview Home Feed ("For You") Component
 *
 * Algorithmic feed powered by Nagg's GraphQL API.
 */

import {
  useMemo,
  useRef,
  useEffect,
  useCallback,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import { StyleSheet, ActivityIndicator, type LayoutChangeEvent } from 'react-native';
import { usePullToAiRefreshControl } from '@/shared/blocks/PullToAiRefreshControl';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';
import { useLatestRef } from '@/shared/hooks/useLatestRef';
import { log, Log } from '@/shared/lib/logger';
import {
  LegendList,
  type LegendListRenderItemProps,
  type LegendListRef,
} from '@legendapp/list/react-native';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useBackgroundConfig } from '@/shared/providers/BackgroundProvider';
import { getFeedClient } from '@/features/feed/data/useFeedClient';

import type { FeedEvent, FeedItem, NoteMetrics, ProfileInfo } from './nostr/feedTypes';
import { DEFAULT_METRICS } from './nostr/feedTypes';
import { tryNpubEncode } from './nostr/feedParse';
import {
  buildVideoOverlayLayout,
  computeFeedIndicesWithVideo,
  MAX_VIDEO_FEED_PAGES,
} from './nostr/videoLayout';
import {
  buildFeedRows,
  DEFAULT_ENGAGEMENT_STATE,
  feedRowsAreEqual,
  getFeedRowItemType,
  getFeedRowKey,
  type FeedRow,
} from '@/features/feed/lib/feedRows';

import { PostCard } from './nostr/PostCard';
import { RepostCard } from './UserFeed';
import {
  ImageOverlayProvider,
  useImageOverlay,
  AnimatedImageOverlay,
  type ImageOverlayReplaceLayout,
} from './nostr/image-overlay';
import { useNostrEngagement } from '@/features/feed/hooks/useNostrEngagement';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

// ============================================================================
// Types
// ============================================================================

interface HomeFeedProps {
  activeFilter?: string;
}

interface FeedSpec {
  name: string;
  spec: string;
  description?: string;
  enabled?: boolean;
  feedkind?: string;
}

export const FEED_FILTER_FOR_YOU = 'For You';
export const FEED_FILTER_FOLLOWING_POPULAR = 'Following Popular';
export const FEED_FILTER_FOLLOWING_RECENT = 'Following Recent';

// Stable config object — avoids re-triggering useBackgroundConfig every render
const BG_CONFIG = { blurMode: 'full' as const };
const FEED_AVATAR_SIZE = 36;
const FEED_CARD_HORIZONTAL_PADDING = 16;
const FEED_CARD_VERTICAL_PADDING = 10;
const FEED_AVATAR_CENTER_Y = FEED_CARD_VERTICAL_PADDING + FEED_AVATAR_SIZE / 2;
const FEED_THREAD_CONNECTOR_AVATAR_GAP = 6;
const FEED_THREAD_CONNECTOR_TOP =
  FEED_CARD_VERTICAL_PADDING + FEED_AVATAR_SIZE + FEED_THREAD_CONNECTOR_AVATAR_GAP;
const FEED_REPOST_HEADER_HEIGHT = 27;
const FEED_REPOST_ORIGINAL_AVATAR_CENTER_Y = FEED_REPOST_HEADER_HEIGHT + FEED_AVATAR_CENTER_Y;

// ============================================================================
// Empty / Error States
// ============================================================================

function EmptyFeed() {
  const [foreground, defaultColor] = useThemeColor(['foreground', 'default'] as const);

  return (
    <VStack align="center" style={styles.emptyState}>
      <Icon name="mdi:message-text" size={40} color={defaultColor} />
      <Spacer size={8} />
      <Text bold size={16} style={{ color: opacity(foreground, 0.5) }}>
        No posts yet
      </Text>
      <Spacer size={4} />
      <Text size={13} style={styles.emptyText}>
        Pull down to refresh or try a different feed.
      </Text>
    </VStack>
  );
}

function FeedThreadPair({
  first,
  second,
  secondAvatarCenterY = FEED_AVATAR_CENTER_Y,
}: {
  first: ReactNode;
  second: ReactNode;
  secondAvatarCenterY?: number;
}) {
  const foreground = useThemeColor('foreground');
  const [firstHeight, setFirstHeight] = useState(0);

  const handleFirstLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = Math.round(event.nativeEvent.layout.height);
    setFirstHeight((currentHeight) => (currentHeight === nextHeight ? currentHeight : nextHeight));
  }, []);

  const connectorStyle = useMemo(() => {
    const secondAvatarTop = firstHeight + secondAvatarCenterY - FEED_AVATAR_SIZE / 2;
    const connectorBottom = secondAvatarTop - FEED_THREAD_CONNECTOR_AVATAR_GAP;
    return [
      styles.threadPairConnector,
      {
        backgroundColor: opacity(foreground, 0.28),
        height: Math.max(0, connectorBottom - FEED_THREAD_CONNECTOR_TOP),
      },
    ];
  }, [firstHeight, foreground, secondAvatarCenterY]);

  return (
    <View style={styles.threadPair}>
      {firstHeight > 0 ? <View pointerEvents="none" style={connectorStyle} /> : null}
      <View onLayout={handleFirstLayout}>{first}</View>
      {second}
    </View>
  );
}

// ============================================================================
// Main HomeFeed Component
// ============================================================================

export function HomeFeed({ activeFilter }: HomeFeedProps) {
  useBackgroundConfig(BG_CONFIG);
  const foreground = useThemeColor('foreground');
  const imageOverlay = useImageOverlay();
  const { keys: nostrKeys } = useNostrKeysContext();
  const userPubkey = nostrKeys?.pubkey;
  const [, startTransition] = useTransition();
  const feedSpecs = DEFAULT_FEED_SPECS;
  const activeSpecIndex = useMemo(() => {
    if (!activeFilter) return 0;
    const idx = feedSpecs.findIndex((s) => s.name === activeFilter);
    return idx >= 0 ? idx : 0;
  }, [activeFilter, feedSpecs]);
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [metricsMap, setMetricsMap] = useState<Map<string, NoteMetrics>>(new Map());
  const [quotedEventsMap, setQuotedEventsMap] = useState<Map<string, FeedEvent>>(new Map());
  const [profilesMap, setProfilesMap] = useState<Map<string, ProfileInfo>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const hasMoreRef = useRef(true);
  const paginationUntilRef = useRef(0);
  const paginationOffsetRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const feedItemIdsRef = useRef(new Set<string>());
  // Tracks the request prefix of the most recently started loadFeed/loadMoreItems
  // — onUpdate callbacks captured by an older request bail out when this drifts.
  const activeLoadIdRef = useRef<string | null>(null);

  const metricsRef = useLatestRef(metricsMap);
  const quotedRef = useLatestRef(quotedEventsMap);
  const profilesRef = useLatestRef(profilesMap);
  const feedRowsRef = useRef<FeedRow[]>([]);

  const isFirstRender = useRef(true);

  const listRef = useRef<LegendListRef>(null);

  const scrollOffsetRef = useRef(0);
  const loadSequenceRef = useRef(0);
  const activeAbortControllerRef = useRef<AbortController | null>(null);

  const beginNetworkLoad = useCallback(() => {
    const requestId = `${Date.now().toString(36)}:${++loadSequenceRef.current}`;
    activeLoadIdRef.current = requestId;
    activeAbortControllerRef.current?.abort();
    const controller = new AbortController();
    activeAbortControllerRef.current = controller;
    return { requestId, controller };
  }, []);

  const isActiveLoad = useCallback(
    (requestId: string) => activeLoadIdRef.current === requestId,
    []
  );

  useEffect(() => {
    return () => {
      activeLoadIdRef.current = null;
      activeAbortControllerRef.current?.abort();
      activeAbortControllerRef.current = null;
    };
  }, []);

  // ── Phase 1–3: Load feed content for selected spec ──

  const loadFeed = useCallback(
    async (specIndex: number, isRefresh = false) => {
      const spec = feedSpecs[specIndex]?.spec;
      if (!spec) return;
      if (!isRefresh) setIsLoading(true);
      isFirstRender.current = true;
      hasMoreRef.current = true;
      paginationUntilRef.current = 0;
      paginationOffsetRef.current = 0;
      feedItemIdsRef.current.clear();
      loadingMoreRef.current = false;
      setIsLoadingMore(false);

      const { requestId, controller } = beginNetworkLoad();
      const client = getFeedClient();
      let didApplyPage = false;

      try {
        const phase1 = await client.getFeed({
          spec,
          userPubkey,
          limit: 30,
          refresh: isRefresh,
          signal: controller.signal,
        });

        if (!isActiveLoad(requestId)) return;

        paginationUntilRef.current = phase1.paginationUntil;
        hasMoreRef.current = phase1.paginationUntil > 0 && phase1.orderedFeedItems.length > 0;
        paginationOffsetRef.current = phase1.paginationOffset;
        feedItemIdsRef.current = new Set(
          phase1.orderedFeedItems.map((item) =>
            item.type === 'note' ? item.event.id : item.repostEvent.id
          )
        );

        setFeedItems(phase1.orderedFeedItems);
        setMetricsMap(phase1.metricsMap);
        setQuotedEventsMap(phase1.quotedEventsMap);
        setProfilesMap(phase1.profilesMap);
        didApplyPage = true;
        setIsLoading(false);
        setIsRefreshing(false);
        requestAnimationFrame(() => {
          isFirstRender.current = false;
        });

        const updates = await client.enrich({
          missingQuotedIds: phase1.missingQuotedIds,
          missingProfilePubkeys: phase1.missingProfilePubkeys,
          refresh: isRefresh,
          signal: controller.signal,
        });
        if (!isActiveLoad(requestId)) return;
        startTransition(() => {
          if (updates.quotedEvents) {
            setQuotedEventsMap((prev) => {
              const n = new Map(prev);
              for (const [k, v] of updates.quotedEvents!) n.set(k, v);
              return n;
            });
          }
          if (updates.metrics) {
            setMetricsMap((prev) => {
              const n = new Map(prev);
              for (const [k, v] of updates.metrics!) n.set(k, v);
              return n;
            });
          }
          if (updates.profiles) {
            setProfilesMap((prev) => {
              const n = new Map(prev);
              for (const [k, v] of updates.profiles!) n.set(k, v);
              return n;
            });
          }
        });
      } catch (error) {
        if (!isActiveLoad(requestId)) return;
        log.error('feed.home.load_failed', {
          message: error instanceof Error ? error.message : String(error),
        });
        if (!isRefresh && !didApplyPage) {
          setFeedItems([]);
          setMetricsMap(new Map());
          setQuotedEventsMap(new Map());
          setProfilesMap(new Map());
        }
        setIsLoading(false);
        setIsRefreshing(false);
      } finally {
        if (activeAbortControllerRef.current === controller) {
          activeAbortControllerRef.current = null;
        }
        client.dispose?.();
      }
    },
    [beginNetworkLoad, feedSpecs, isActiveLoad, userPubkey]
  );

  // Trigger feed load when spec (page) changes
  const currentSpec = feedSpecs[activeSpecIndex]?.spec;
  const prevSpecRef = useRef<string | undefined>(undefined);
  const prevPubkeyRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!currentSpec) return;
    if (currentSpec === prevSpecRef.current && userPubkey === prevPubkeyRef.current) return;
    prevSpecRef.current = currentSpec;
    prevPubkeyRef.current = userPubkey;
    void loadFeed(activeSpecIndex);
  }, [activeSpecIndex, currentSpec, userPubkey, loadFeed]);

  const handleRefresh = useCallback(() => {
    if (!currentSpec || isRefreshing) return;
    setIsRefreshing(true);
    void loadFeed(activeSpecIndex, true);
  }, [activeSpecIndex, currentSpec, isRefreshing, loadFeed]);

  // Reset feed items when the active filter changes
  const prevActiveSpecIndex = useRef(activeSpecIndex);
  useEffect(() => {
    if (prevActiveSpecIndex.current !== activeSpecIndex) {
      prevActiveSpecIndex.current = activeSpecIndex;
      setIsLoading(true);
      setFeedItems([]);
    }
  }, [activeSpecIndex]);

  // ── Pagination: load older items ──

  const loadMoreItems = useCallback(async (): Promise<FeedItem[]> => {
    if (
      loadingMoreRef.current ||
      !hasMoreRef.current ||
      !currentSpec ||
      paginationUntilRef.current === 0
    )
      return [];

    loadingMoreRef.current = true;
    setIsLoadingMore(true);
    const { requestId, controller } = beginNetworkLoad();
    const client = getFeedClient();

    try {
      const page = await client.getFeed({
        spec: currentSpec,
        userPubkey,
        limit: 20,
        until: paginationUntilRef.current,
        offset: paginationOffsetRef.current > 0 ? paginationOffsetRef.current : undefined,
        signal: controller.signal,
      });

      if (!isActiveLoad(requestId)) return [];

      if (page.orderedFeedItems.length === 0) {
        hasMoreRef.current = false;
        return [];
      }

      if (page.paginationUntil > 0 && page.paginationUntil < paginationUntilRef.current) {
        paginationUntilRef.current = page.paginationUntil;
        paginationOffsetRef.current = page.paginationOffset;
      } else if (page.paginationUntil === paginationUntilRef.current) {
        paginationOffsetRef.current += page.paginationOffset;
      } else {
        let oldest = paginationUntilRef.current;
        for (const item of page.orderedFeedItems) {
          if (item.timestamp < oldest) oldest = item.timestamp;
        }
        if (oldest >= paginationUntilRef.current) {
          hasMoreRef.current = false;
          return [];
        }
        paginationUntilRef.current = oldest;
        paginationOffsetRef.current = page.paginationOffset;
      }

      const newItems = page.orderedFeedItems.filter((item) => {
        const id = item.type === 'note' ? item.event.id : item.repostEvent.id;
        return !feedItemIdsRef.current.has(id);
      });

      if (newItems.length === 0) {
        hasMoreRef.current = false;
        return [];
      }

      for (const item of newItems) {
        feedItemIdsRef.current.add(item.type === 'note' ? item.event.id : item.repostEvent.id);
      }

      startTransition(() => {
        setFeedItems((prev) => [...prev, ...newItems]);
        setMetricsMap((prev) => {
          const n = new Map(prev);
          for (const [k, v] of page.metricsMap) n.set(k, v);
          return n;
        });
        setQuotedEventsMap((prev) => {
          const n = new Map(prev);
          for (const [k, v] of page.quotedEventsMap) n.set(k, v);
          return n;
        });
        setProfilesMap((prev) => {
          const n = new Map(prev);
          for (const [k, v] of page.profilesMap) n.set(k, v);
          return n;
        });
      });

      const missingQ = page.missingQuotedIds.filter((id) => !quotedRef.current.has(id));
      const missingP = page.missingProfilePubkeys.filter((pk) => !profilesRef.current.has(pk));
      const updates = await client.enrich({
        missingQuotedIds: missingQ,
        missingProfilePubkeys: missingP,
        signal: controller.signal,
      });
      if (!isActiveLoad(requestId)) return newItems;
      startTransition(() => {
        if (updates.quotedEvents) {
          setQuotedEventsMap((prev) => {
            const n = new Map(prev);
            for (const [k, v] of updates.quotedEvents!) n.set(k, v);
            return n;
          });
        }
        if (updates.metrics) {
          setMetricsMap((prev) => {
            const n = new Map(prev);
            for (const [k, v] of updates.metrics!) n.set(k, v);
            return n;
          });
        }
        if (updates.profiles) {
          setProfilesMap((prev) => {
            const n = new Map(prev);
            for (const [k, v] of updates.profiles!) n.set(k, v);
            return n;
          });
        }
      });
      return newItems;
    } catch (error) {
      if (!isActiveLoad(requestId)) return [];
      log.error('feed.home.load_more_failed', {
        message: error instanceof Error ? error.message : String(error),
      });
      return [];
    } finally {
      if (activeAbortControllerRef.current === controller) {
        activeAbortControllerRef.current = null;
      }
      client.dispose?.();
      loadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [beginNetworkLoad, currentSpec, isActiveLoad, userPubkey, startTransition]);

  const handleEndReached = useCallback(() => {
    void loadMoreItems();
  }, [loadMoreItems]);

  // ── Derived data ──

  const getMetrics = useCallback(
    (noteId: string): NoteMetrics => metricsRef.current.get(noteId) || DEFAULT_METRICS,
    []
  );

  const actionableEvents = useMemo(() => {
    const map = new Map<string, FeedEvent>();
    for (const item of feedItems) {
      if (item.rootEvent) {
        map.set(item.rootEvent.id, item.rootEvent);
      }
      if (item.type === 'note') {
        map.set(item.event.id, item.event);
      } else if (item.originalEvent) {
        map.set(item.originalEvent.id, item.originalEvent);
      }
    }
    return Array.from(map.values());
  }, [feedItems]);

  const { getDisplayMetrics, getEngagementState, toggleLike, toggleRepost } = useNostrEngagement(
    actionableEvents,
    getMetrics
  );
  const toggleLikeRef = useLatestRef(toggleLike);
  const toggleRepostRef = useLatestRef(toggleRepost);

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
        toggleRepost
      ),
    [feedItems, getDisplayMetrics, getEngagementState, toggleLike, toggleRepost]
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

  // ── Render ──

  const getThreadContext = useCallback(
    (replyPreviewEvents?: readonly FeedEvent[]) => {
      const allEvents = new Map<string, FeedEvent>();
      for (const it of feedItems) {
        if (it.rootEvent) {
          allEvents.set(it.rootEvent.id, it.rootEvent);
        }
        if (it.type === 'note') {
          allEvents.set(it.event.id, it.event);
          for (const replyPreviewEvent of it.replyPreviewEvents ?? []) {
            allEvents.set(replyPreviewEvent.id, replyPreviewEvent);
          }
        } else if (it.originalEvent) {
          allEvents.set(it.originalEvent.id, it.originalEvent);
        }
      }
      for (const replyPreviewEvent of replyPreviewEvents ?? []) {
        allEvents.set(replyPreviewEvent.id, replyPreviewEvent);
      }
      return {
        allEvents,
        profiles: profilesRef.current,
        metrics: metricsRef.current,
        quotedEvents: quotedRef.current,
        replyPreviewEventIds: replyPreviewEvents?.map((event) => event.id),
      };
    },
    [feedItems, profilesRef, metricsRef, quotedRef]
  );
  const getThreadContextRef = useLatestRef(getThreadContext);

  const resolveReposter = useCallback(
    (item: Extract<FeedItem, { type: 'repost' }>) => {
      const reposterProfile = profilesMap.get(item.repostEvent.pubkey);
      const reposterName =
        reposterProfile?.name || tryNpubEncode(item.repostEvent.pubkey).slice(0, 12) + '…';
      return {
        name: reposterName,
        pubkey: item.repostEvent.pubkey,
      };
    },
    [profilesMap]
  );

  const feedRows = useMemo(
    () =>
      buildFeedRows({
        items: feedItems,
        previousRows: feedRowsRef.current,
        profilesMap,
        quotedEventsMap,
        getDisplayMetrics,
        getEngagementState,
        resolveReposter,
      }),
    [
      feedItems,
      metricsMap,
      profilesMap,
      quotedEventsMap,
      getDisplayMetrics,
      getEngagementState,
      resolveReposter,
    ]
  );

  useEffect(() => {
    feedRowsRef.current = feedRows;
  }, [feedRows]);

  const renderFeedItem = useCallback(
    ({ item: row, index }: LegendListRenderItemProps<FeedRow, string | undefined>) => {
      const item = row.item;
      const feedIndex = index;
      if (item.type === 'note') {
        const metrics = row.metrics;
        const engagement = row.engagement;
        const contextRootEvent = row.rootEvent;
        const replyPreviewEvents = item.replyPreviewEvents ?? [];
        if (!contextRootEvent && replyPreviewEvents.length > 0) {
          return (
            <FeedThreadPair
              first={
                <PostCard
                  variant="feed"
                  event={item.event}
                  metrics={metrics}
                  index={index}
                  feedIndex={feedIndex}
                  onOverlayOpenedFromIndex={onOverlayOpenedFromIndex}
                  quotedEvents={row.quotedEvents}
                  profiles={row.profiles}
                  getMetrics={getMetrics}
                  liked={engagement.liked}
                  reposted={engagement.reposted}
                  likePending={engagement.likePending}
                  repostPending={engagement.repostPending}
                  likePendingDirection={engagement.likePendingDirection}
                  repostPendingDirection={engagement.repostPendingDirection}
                  onLikePress={() => toggleLikeRef.current(item.event)}
                  onRepostPress={() => toggleRepostRef.current(item.event)}
                  skipAnimation={!isFirstRender.current}
                  getThreadContext={() => getThreadContextRef.current(replyPreviewEvents)}
                  showFooterBorder={false}
                  fullBleedFooterBorder
                />
              }
              second={
                <>
                  {replyPreviewEvents.map((replyEvent, replyIndex) => {
                    const replyMetrics = getDisplayMetrics(replyEvent.id);
                    const replyEngagement = getEngagementState(replyEvent.id);
                    const isLastReply = replyIndex === replyPreviewEvents.length - 1;
                    return (
                      <PostCard
                        key={replyEvent.id}
                        variant="feed"
                        event={replyEvent}
                        metrics={replyMetrics}
                        index={index}
                        feedIndex={feedIndex}
                        onOverlayOpenedFromIndex={onOverlayOpenedFromIndex}
                        quotedEvents={row.quotedEvents}
                        profiles={row.profiles}
                        getMetrics={getMetrics}
                        liked={replyEngagement.liked}
                        reposted={replyEngagement.reposted}
                        likePending={replyEngagement.likePending}
                        repostPending={replyEngagement.repostPending}
                        likePendingDirection={replyEngagement.likePendingDirection}
                        repostPendingDirection={replyEngagement.repostPendingDirection}
                        onLikePress={() => toggleLikeRef.current(replyEvent)}
                        onRepostPress={() => toggleRepostRef.current(replyEvent)}
                        getThreadContext={() => getThreadContextRef.current()}
                        showFooterBorder={isLastReply}
                        fullBleedFooterBorder
                      />
                    );
                  })}
                </>
              }
            />
          );
        }
        if (contextRootEvent) {
          const rootEvent = contextRootEvent;
          const rootMetrics = row.rootMetrics ?? DEFAULT_METRICS;
          const rootEngagement = row.rootEngagement ?? DEFAULT_ENGAGEMENT_STATE;
          return (
            <FeedThreadPair
              first={
                <PostCard
                  variant="feed"
                  event={rootEvent}
                  metrics={rootMetrics}
                  index={index}
                  feedIndex={feedIndex}
                  onOverlayOpenedFromIndex={onOverlayOpenedFromIndex}
                  quotedEvents={row.quotedEvents}
                  profiles={row.profiles}
                  getMetrics={getMetrics}
                  liked={rootEngagement.liked}
                  reposted={rootEngagement.reposted}
                  likePending={rootEngagement.likePending}
                  repostPending={rootEngagement.repostPending}
                  likePendingDirection={rootEngagement.likePendingDirection}
                  repostPendingDirection={rootEngagement.repostPendingDirection}
                  onLikePress={() => toggleLikeRef.current(rootEvent)}
                  onRepostPress={() => toggleRepostRef.current(rootEvent)}
                  skipAnimation={!isFirstRender.current}
                  getThreadContext={() => getThreadContextRef.current()}
                  showFooterBorder={false}
                  fullBleedFooterBorder
                />
              }
              second={
                <PostCard
                  variant="feed"
                  event={item.event}
                  metrics={metrics}
                  index={index}
                  feedIndex={feedIndex}
                  onOverlayOpenedFromIndex={onOverlayOpenedFromIndex}
                  quotedEvents={row.quotedEvents}
                  profiles={row.profiles}
                  getMetrics={getMetrics}
                  liked={engagement.liked}
                  reposted={engagement.reposted}
                  likePending={engagement.likePending}
                  repostPending={engagement.repostPending}
                  likePendingDirection={engagement.likePendingDirection}
                  repostPendingDirection={engagement.repostPendingDirection}
                  onLikePress={() => toggleLikeRef.current(item.event)}
                  onRepostPress={() => toggleRepostRef.current(item.event)}
                  getThreadContext={() => getThreadContextRef.current()}
                  fullBleedFooterBorder
                />
              }
            />
          );
        }
        return (
          <PostCard
            variant="feed"
            event={item.event}
            metrics={metrics}
            index={index}
            feedIndex={feedIndex}
            onOverlayOpenedFromIndex={onOverlayOpenedFromIndex}
            quotedEvents={row.quotedEvents}
            profiles={row.profiles}
            getMetrics={getMetrics}
            liked={engagement.liked}
            reposted={engagement.reposted}
            likePending={engagement.likePending}
            repostPending={engagement.repostPending}
            likePendingDirection={engagement.likePendingDirection}
            repostPendingDirection={engagement.repostPendingDirection}
            onLikePress={() => toggleLikeRef.current(item.event)}
            onRepostPress={() => toggleRepostRef.current(item.event)}
            skipAnimation={!isFirstRender.current}
            getThreadContext={() => getThreadContextRef.current()}
            fullBleedFooterBorder
          />
        );
      }

      const originalEvent = item.originalEvent;
      const repostEngagement = row.engagement;
      const contextRootEvent = row.rootEvent;
      if (contextRootEvent && originalEvent) {
        const rootEvent = contextRootEvent;
        const rootMetrics = row.rootMetrics ?? DEFAULT_METRICS;
        const rootEngagement = row.rootEngagement ?? DEFAULT_ENGAGEMENT_STATE;
        return (
          <FeedThreadPair
            secondAvatarCenterY={FEED_REPOST_ORIGINAL_AVATAR_CENTER_Y}
            first={
              <PostCard
                variant="feed"
                event={rootEvent}
                metrics={rootMetrics}
                index={index}
                feedIndex={feedIndex}
                onOverlayOpenedFromIndex={onOverlayOpenedFromIndex}
                quotedEvents={row.quotedEvents}
                profiles={row.profiles}
                getMetrics={getMetrics}
                liked={rootEngagement.liked}
                reposted={rootEngagement.reposted}
                likePending={rootEngagement.likePending}
                repostPending={rootEngagement.repostPending}
                likePendingDirection={rootEngagement.likePendingDirection}
                repostPendingDirection={rootEngagement.repostPendingDirection}
                onLikePress={() => toggleLikeRef.current(rootEvent)}
                onRepostPress={() => toggleRepostRef.current(rootEvent)}
                skipAnimation={!isFirstRender.current}
                getThreadContext={() => getThreadContextRef.current()}
                showFooterBorder={false}
                fullBleedFooterBorder
              />
            }
            second={
              <RepostCard
                repostEvent={item.repostEvent}
                originalEvent={item.originalEvent}
                originalMetrics={row.metrics}
                index={index}
                feedIndex={feedIndex}
                onOverlayOpenedFromIndex={onOverlayOpenedFromIndex}
                quotedEvents={row.quotedEvents}
                profiles={row.profiles}
                getMetrics={getMetrics}
                reposterName={row.reposterName ?? ''}
                reposterPubkey={row.reposterPubkey ?? item.repostEvent.pubkey}
                liked={repostEngagement.liked}
                reposted={repostEngagement.reposted}
                likePending={repostEngagement.likePending}
                repostPending={repostEngagement.repostPending}
                likePendingDirection={repostEngagement.likePendingDirection}
                repostPendingDirection={repostEngagement.repostPendingDirection}
                onLikePress={() => toggleLikeRef.current(originalEvent)}
                onRepostPress={() => toggleRepostRef.current(originalEvent)}
                skipAnimation={!isFirstRender.current}
                getThreadContext={() => getThreadContextRef.current()}
                fullBleedFooterBorder
              />
            }
          />
        );
      }
      return (
        <RepostCard
          repostEvent={item.repostEvent}
          originalEvent={item.originalEvent}
          originalMetrics={row.metrics}
          index={index}
          feedIndex={feedIndex}
          onOverlayOpenedFromIndex={onOverlayOpenedFromIndex}
          quotedEvents={row.quotedEvents}
          profiles={row.profiles}
          getMetrics={getMetrics}
          reposterName={row.reposterName ?? ''}
          reposterPubkey={row.reposterPubkey ?? item.repostEvent.pubkey}
          liked={repostEngagement.liked}
          reposted={repostEngagement.reposted}
          likePending={repostEngagement.likePending}
          repostPending={repostEngagement.repostPending}
          likePendingDirection={repostEngagement.likePendingDirection}
          repostPendingDirection={repostEngagement.repostPendingDirection}
          onLikePress={originalEvent ? () => toggleLikeRef.current(originalEvent) : undefined}
          onRepostPress={originalEvent ? () => toggleRepostRef.current(originalEvent) : undefined}
          skipAnimation={!isFirstRender.current}
          getThreadContext={() => getThreadContextRef.current()}
          fullBleedFooterBorder
        />
      );
    },
    [
      getMetrics,
      getDisplayMetrics,
      getEngagementState,
      onOverlayOpenedFromIndex,
      toggleLikeRef,
      toggleRepostRef,
      getThreadContextRef,
    ]
  );

  const refreshTintColor = useMemo(() => opacity(foreground, 0.5), [foreground]);

  const pullToAi = usePullToAiRefreshControl({
    refreshing: isRefreshing,
    onRefresh: handleRefresh,
    tintColor: refreshTintColor,
  });

  const renderItem = renderFeedItem;

  const handleScroll = useCallback((e: { nativeEvent: { contentOffset: { y: number } } }) => {
    scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
  }, []);

  const onScroll = useCallback(
    (e: { nativeEvent: { contentOffset: { y: number } } }) => {
      handleScroll(e);
      if (imageOverlay?.scrollOffsetY != null) {
        imageOverlay.scrollOffsetY.value = e.nativeEvent.contentOffset.y;
      }
    },
    [handleScroll, imageOverlay]
  );

  return (
    <Log name="HomeFeed">
      <ImageOverlayProvider
        getDisplayMetrics={getDisplayMetrics}
        getEngagementState={getEngagementState}
        onSwipeUpToNextPost={onSwipeUpToNextPost}
        getVideoFeedLayoutsAndIndex={getVideoFeedLayoutsAndIndex}>
        <View style={styles.flex1}>
          <LegendList
            ref={listRef}
            data={feedRows}
            keyExtractor={getFeedRowKey}
            getItemType={getFeedRowItemType}
            estimatedItemSize={300}
            drawDistance={400}
            renderItem={renderItem}
            itemsAreEqual={feedRowsAreEqual}
            recycleItems
            ListEmptyComponent={
              isLoading ? <ActivityIndicator style={styles.loader} /> : <EmptyFeed />
            }
            ListFooterComponent={
              isLoadingMore ? <ActivityIndicator style={styles.loadMoreSpinner} /> : null
            }
            onEndReached={handleEndReached}
            onEndReachedThreshold={0.4}
            style={styles.flex1}
            contentContainerStyle={LIST_CONTENT_STYLE}
            showsVerticalScrollIndicator={false}
            onScroll={onScroll}
            scrollEventThrottle={16}
            refreshControl={pullToAi.refreshControl}
          />
        </View>
        <AnimatedImageOverlay />
      </ImageOverlayProvider>
    </Log>
  );
}

// ============================================================================
// Stable references — defined outside the component to avoid re-creation
// ============================================================================

const LIST_CONTENT_STYLE = { paddingBottom: 120 };

export const DEFAULT_FEED_SPECS: FeedSpec[] = [
  {
    name: FEED_FILTER_FOR_YOU,
    spec: JSON.stringify({ id: 'global-trending', kind: 'notes', hours: 24 }),
  },
  {
    name: FEED_FILTER_FOLLOWING_POPULAR,
    spec: JSON.stringify({ id: 'following-popular', kind: 'notes', hours: 24 }),
  },
  {
    name: FEED_FILTER_FOLLOWING_RECENT,
    spec: JSON.stringify({ id: 'following-recent', kind: 'notes' }),
  },
];

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  emptyState: {
    paddingVertical: 32,
    paddingHorizontal: 16,
  },
  emptyText: {
    textAlign: 'center',
    color: 'rgba(255,255,255,0.33)',
  },
  loader: {
    marginTop: 48,
  },
  loadMoreSpinner: {
    paddingVertical: 24,
  },
  threadPair: {
    position: 'relative',
  },
  threadPairConnector: {
    position: 'absolute',
    left: FEED_CARD_HORIZONTAL_PADDING + FEED_AVATAR_SIZE / 2 - 1,
    top: FEED_THREAD_CONNECTOR_TOP,
    width: 2,
    borderRadius: 1,
  },
  flex1: {
    flex: 1,
  },
});
