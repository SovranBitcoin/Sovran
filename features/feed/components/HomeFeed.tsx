/**
 * @fileoverview Home Feed ("For You") Component
 *
 * Algorithmic feed powered by Primal's mega_feed_directive endpoint.
 * Fetches available feed configurations, then loads a paginated
 * multi-author feed using the same event format as UserFeed.
 */

import { useMemo, useRef, useEffect, useCallback, useState, useTransition } from 'react';
import { StyleSheet, ActivityIndicator } from 'react-native';
import { usePullToAiRefreshControl } from '@/shared/blocks/PullToAiRefreshControl';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';
import { useLatestRef } from '@/shared/hooks/useLatestRef';
import { log, Log } from '@/shared/lib/logger';
import { LegendList, type LegendListRenderItemProps, type LegendListRef } from '@legendapp/list';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useBackgroundConfig } from '@/shared/providers/BackgroundProvider';
import { isNostrPubkeyHex } from '@/shared/lib/nostr/secureStorage';

import type { FeedEvent, FeedItem, NoteMetrics, ProfileInfo } from './nostr/feedTypes';
import { DEFAULT_METRICS } from './nostr/feedTypes';
import {
  createPrimalRelayClient,
  PRIMAL_CACHE_RELAY_URL,
  PRIMAL_KIND_FEED_RANGE,
} from './nostr/primalRelay';
import { parseJson, tryNpubEncode } from './nostr/feedParse';
import {
  buildVideoOverlayLayout,
  computeFeedIndicesWithVideo,
  MAX_VIDEO_FEED_PAGES,
} from './nostr/videoLayout';
import { enrichFeedPage, parseFeedPage } from './nostr/parseFeedPage';
import { CATEGORY_PUBKEYS } from './nostr/categoryNpubs';

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

// Stable config object — avoids re-triggering useBackgroundConfig every render
const BG_CONFIG = { blurMode: 'full' as const };

// ============================================================================
// Helpers
// ============================================================================

/**
 * Inject user pubkey into feed specs that require it.
 * Specs with `"id":"feed"` are user-specific (latest from follows, etc.)
 * and need a `pubkey` field to know whose network to query.
 */
function hydrateSpecWithPubkey(spec: string, pubkey: string): string {
  const parsed = parseJson<Record<string, unknown>>(spec);
  if (!parsed || typeof parsed !== 'object') return spec;
  const hasExplicitPubkeys = Array.isArray(parsed.pubkeys);
  if (parsed.id === 'feed' && !parsed.pubkey && !hasExplicitPubkeys) {
    return JSON.stringify({ ...parsed, pubkey });
  }
  return spec;
}

export function categoryToLabel(category: string): string {
  return category
    .split('_')
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(' ');
}

function getCategoryPubkeysFromSpec(spec: string): string[] {
  const parsed = parseJson<Record<string, unknown>>(spec);
  if (!parsed) return [];
  if (parsed.id !== 'feed' || parsed.kind !== 'notes' || parsed.notes !== 'authored') return [];
  if (!Array.isArray(parsed.pubkeys)) return [];

  const seen = new Set<string>();
  const pubkeys: string[] = [];
  for (const value of parsed.pubkeys) {
    if (!isNostrPubkeyHex(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    pubkeys.push(value);
  }
  return pubkeys;
}

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
  const [feedSpecs, setFeedSpecs] = useState<FeedSpec[]>([]);
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
  const [dataVersion, setDataVersion] = useState(0);

  const isFirstRender = useRef(true);

  const listRef = useRef<LegendListRef>(null);

  const scrollOffsetRef = useRef(0);

  const categoryFeedSpecs = useMemo<FeedSpec[]>(() => {
    return Object.entries(CATEGORY_PUBKEYS).map(([category, pubkeys]) => ({
      name: categoryToLabel(category),
      spec: JSON.stringify({
        id: 'feed',
        kind: 'notes',
        notes: 'authored',
        pubkeys,
      }),
    }));
  }, []);

  // ── Phase 0: Fetch available feed specs ──

  useEffect(() => {
    setFeedSpecs([...PRIMAL_FEED_SPECS, ...categoryFeedSpecs]);
  }, [categoryFeedSpecs]);

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

      const client = createPrimalRelayClient(PRIMAL_CACHE_RELAY_URL);
      const requestPrefix = Date.now().toString(36);
      activeLoadIdRef.current = requestPrefix;

      try {
        // Hydrate spec with user pubkey for personalized feeds
        const hydratedSpec = userPubkey ? hydrateSpecWithPubkey(spec, userPubkey) : spec;
        const parsedHydrated = parseJson<Record<string, unknown>>(hydratedSpec);
        if (
          parsedHydrated &&
          Array.isArray(parsedHydrated.pubkeys) &&
          parsedHydrated.pubkeys.length === 0
        ) {
          setFeedItems([]);
          setMetricsMap(new Map());
          setQuotedEventsMap(new Map());
          setProfilesMap(new Map());
          setDataVersion((v) => v + 1);
          setIsLoading(false);
          setIsRefreshing(false);
          hasMoreRef.current = false;
          return;
        }

        const categoryPubkeys = getCategoryPubkeysFromSpec(hydratedSpec);
        const feedRawEvents =
          categoryPubkeys.length > 0
            ? (
                await Promise.all(
                  categoryPubkeys.map((pubkey, index) =>
                    client.request(`${requestPrefix}_author_${index}`, {
                      cache: ['feed', { pubkey, notes: 'authored', limit: 6 }],
                    })
                  )
                )
              )
                .flat()
                .filter((event) => event.kind !== PRIMAL_KIND_FEED_RANGE)
            : await (async () => {
                const megaFeedPayload: Record<string, unknown> = {
                  spec: hydratedSpec,
                  limit: 30,
                };
                if (userPubkey) megaFeedPayload.user_pubkey = userPubkey;
                return client.request(`${requestPrefix}_mega`, {
                  cache: ['mega_feed_directive', megaFeedPayload],
                });
              })();

        const phase1 = parseFeedPage(feedRawEvents, { perfLogTag: 'feed.parse' });

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
        setDataVersion((v) => v + 1);
        setIsLoading(false);
        setIsRefreshing(false);
        requestAnimationFrame(() => {
          isFirstRender.current = false;
        });

        await enrichFeedPage(
          client,
          requestPrefix,
          phase1.missingQuotedIds,
          phase1.missingProfilePubkeys,
          phase1.quotedEventsMap,
          phase1.profilesMap,
          (updates) => {
            if (activeLoadIdRef.current !== requestPrefix) return;
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
              setDataVersion((v) => v + 1);
            });
          }
        );
      } catch (error) {
        log.error('feed.home.load_failed', {
          message: error instanceof Error ? error.message : String(error),
        });
        setFeedItems([]);
        setMetricsMap(new Map());
        setQuotedEventsMap(new Map());
        setProfilesMap(new Map());
        setIsLoading(false);
        setIsRefreshing(false);
      } finally {
        client.close();
      }
    },
    [feedSpecs, userPubkey]
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
    if (!currentSpec) return;
    setIsRefreshing(true);
    void loadFeed(activeSpecIndex, true);
  }, [activeSpecIndex, currentSpec, loadFeed]);

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
    const client = createPrimalRelayClient(PRIMAL_CACHE_RELAY_URL);
    const rp = Date.now().toString(36);
    activeLoadIdRef.current = rp;

    try {
      const hydratedSpec = userPubkey
        ? hydrateSpecWithPubkey(currentSpec, userPubkey)
        : currentSpec;
      const categoryPubkeys = getCategoryPubkeysFromSpec(hydratedSpec);
      const rawEvents =
        categoryPubkeys.length > 0
          ? (
              await Promise.all(
                categoryPubkeys.map((pubkey, index) =>
                  client.request(`${rp}_author_more_${index}`, {
                    cache: [
                      'feed',
                      {
                        pubkey,
                        notes: 'authored',
                        limit: 5,
                        until: paginationUntilRef.current,
                      },
                    ],
                  })
                )
              )
            )
              .flat()
              .filter((event) => event.kind !== PRIMAL_KIND_FEED_RANGE)
          : await (async () => {
              const payload: Record<string, unknown> = {
                spec: hydratedSpec,
                limit: 20,
                until: paginationUntilRef.current,
              };
              if (paginationOffsetRef.current > 0) payload.offset = paginationOffsetRef.current;
              if (userPubkey) payload.user_pubkey = userPubkey;
              return client.request(`${rp}_more`, {
                cache: ['mega_feed_directive', payload],
              });
            })();
      const page = parseFeedPage(rawEvents, { perfLogTag: 'feed.parse' });

      if (page.orderedFeedItems.length === 0) {
        hasMoreRef.current = false;
        return [];
      }

      if (categoryPubkeys.length > 0) {
        const oldest = page.orderedFeedItems.reduce(
          (acc, item) => (item.timestamp < acc ? item.timestamp : acc),
          paginationUntilRef.current
        );
        if (oldest >= paginationUntilRef.current) {
          hasMoreRef.current = false;
          return [];
        }
        paginationUntilRef.current = oldest;
        paginationOffsetRef.current = 0;
      } else if (page.paginationUntil > 0 && page.paginationUntil < paginationUntilRef.current) {
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
        setDataVersion((v) => v + 1);
      });

      const missingQ = page.missingQuotedIds.filter((id) => !quotedRef.current.has(id));
      const missingP = page.missingProfilePubkeys.filter((pk) => !profilesRef.current.has(pk));
      await enrichFeedPage(
        client,
        rp,
        missingQ,
        missingP,
        quotedRef.current,
        profilesRef.current,
        (updates) => {
          if (activeLoadIdRef.current !== rp) return;
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
            setDataVersion((v) => v + 1);
          });
        }
      );
      return newItems;
    } catch (error) {
      log.error('feed.home.load_more_failed', {
        message: error instanceof Error ? error.message : String(error),
      });
      return [];
    } finally {
      client.close();
      loadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [currentSpec, userPubkey, startTransition]);

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
      if (item.type === 'note') {
        map.set(item.event.id, item.event);
      } else if (item.originalEvent) {
        map.set(item.originalEvent.id, item.originalEvent);
      }
    }
    return Array.from(map.values());
  }, [feedItems]);

  const { getDisplayMetrics, getEngagementState, toggleLike, toggleRepost, engagementRevision } =
    useNostrEngagement(actionableEvents, getMetrics);

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

  const getThreadContext = useCallback(() => {
    const allEvents = new Map<string, FeedEvent>();
    for (const it of feedItems) {
      if (it.type === 'note') {
        allEvents.set(it.event.id, it.event);
      } else if (it.originalEvent) {
        allEvents.set(it.originalEvent.id, it.originalEvent);
      }
    }
    return {
      allEvents,
      profiles: profilesRef.current,
      metrics: metricsRef.current,
      quotedEvents: quotedRef.current,
    };
  }, [feedItems, profilesRef, metricsRef, quotedRef]);

  const renderFeedItem = useCallback(
    ({ item, index }: LegendListRenderItemProps<FeedItem, string | undefined>) => {
      const feedIndex = index;
      if (item.type === 'note') {
        const metrics = getDisplayMetrics(item.event.id);
        const engagement = getEngagementState(item.event.id);
        return (
          <PostCard
            variant="feed"
            event={item.event}
            metrics={metrics}
            index={index}
            feedIndex={feedIndex}
            onOverlayOpenedFromIndex={onOverlayOpenedFromIndex}
            quotedEvents={quotedRef.current}
            profiles={profilesRef.current}
            getMetrics={getMetrics}
            liked={engagement.liked}
            reposted={engagement.reposted}
            likePending={engagement.likePending}
            repostPending={engagement.repostPending}
            likePendingDirection={engagement.likePendingDirection}
            repostPendingDirection={engagement.repostPendingDirection}
            onLikePress={() => toggleLike(item.event)}
            onRepostPress={() => toggleRepost(item.event)}
            skipAnimation={!isFirstRender.current}
            getThreadContext={getThreadContext}
          />
        );
      }

      const reposterProfile = profilesRef.current.get(item.repostEvent.pubkey);
      const reposterName =
        reposterProfile?.name || tryNpubEncode(item.repostEvent.pubkey).slice(0, 12) + '…';

      const originalEvent = item.originalEvent;
      const repostEngagement = getEngagementState(item.originalEventId);
      return (
        <RepostCard
          repostEvent={item.repostEvent}
          originalEvent={item.originalEvent}
          originalMetrics={getDisplayMetrics(item.originalEventId)}
          index={index}
          feedIndex={feedIndex}
          onOverlayOpenedFromIndex={onOverlayOpenedFromIndex}
          quotedEvents={quotedRef.current}
          profiles={profilesRef.current}
          getMetrics={getMetrics}
          reposterName={reposterName}
          reposterPubkey={item.repostEvent.pubkey}
          liked={repostEngagement.liked}
          reposted={repostEngagement.reposted}
          likePending={repostEngagement.likePending}
          repostPending={repostEngagement.repostPending}
          likePendingDirection={repostEngagement.likePendingDirection}
          repostPendingDirection={repostEngagement.repostPendingDirection}
          onLikePress={originalEvent ? () => toggleLike(originalEvent) : undefined}
          onRepostPress={originalEvent ? () => toggleRepost(originalEvent) : undefined}
          skipAnimation={!isFirstRender.current}
          getThreadContext={getThreadContext}
        />
      );
    },
    [
      getDisplayMetrics,
      getEngagementState,
      getMetrics,
      onOverlayOpenedFromIndex,
      toggleLike,
      toggleRepost,
      getThreadContext,
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
            data={feedItems}
            keyExtractor={listKeyExtractor}
            getItemType={listGetItemType}
            estimatedItemSize={300}
            drawDistance={400}
            renderItem={renderItem}
            extraData={`${dataVersion}:${engagementRevision}`}
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
            onScrollBeginDrag={pullToAi.onScrollBeginDrag}
            onScrollEndDrag={pullToAi.onScrollEndDrag}
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

const listKeyExtractor = (item: FeedItem) =>
  item.type === 'note' ? item.event.id : item.repostEvent.id;
const listGetItemType = (item: FeedItem) => item.type;

export const PRIMAL_FEED_SPECS: FeedSpec[] = [
  {
    name: 'Trending',
    spec: JSON.stringify({ id: 'global-trending', kind: 'notes', hours: 24 }),
  },
  {
    name: 'Latest',
    spec: JSON.stringify({ id: 'feed', kind: 'notes', notes: 'follows' }),
  },
  {
    name: 'Latest with Replies',
    spec: JSON.stringify({ id: 'feed', kind: 'notes', notes: 'follows_replies' }),
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
  flex1: {
    flex: 1,
  },
});
