/**
 * @fileoverview Home Feed ("For You") Component
 *
 * Algorithmic feed served through the tier-selecting facade: nagg's REST
 * app-view returns one fully-bundled page (events + profiles + engagement
 * stats), with Primal cache / raw relays as fallback tiers.
 */

import { COMPOSE_FAB_CLEARANCE } from '@/features/composer/ui/ComposeFab';
import { useMemo, useRef, useEffect, useCallback, useState, type ReactNode } from 'react';
import { StyleSheet, type LayoutChangeEvent } from 'react-native';
import { usePullToAiRefreshControl } from '@/shared/blocks/PullToAiRefreshControl';
import { View } from '@/shared/ui/primitives/View/View';
import { withAlpha } from '@/shared/lib/color';
import { useLatestRef } from '@/shared/hooks/useLatestRef';
import { log, Log, feedLog } from '@/shared/lib/logger';
import { List } from '@/shared/ui/composed/List';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useBackgroundConfig } from '@/shared/providers/BackgroundProvider';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { Button } from 'heroui-native';
import { getFeedClient } from '@/features/feed/data/useFeedClient';
import type { FeedParseResult } from '@/features/feed/data/feedClient';
import {
  advancedPaginationState,
  emptyPaginationState,
  isRankedFeedSpec,
  seededPaginationState,
} from '@/features/feed/data/feedPagination';
import { feedPageCache, feedPageKey } from '@/features/feed/data/feedCache';
import { useFeedIgnoreStore } from '@/features/feed/stores/ignoreStore';
import { usePostActions } from '@/features/feed/hooks/usePostActions';
import { useNostrSocialStore } from '@/shared/stores/profile/nostrSocialStore';
import { EmptyState } from '@/shared/ui/composed/EmptyState';
import {
  selectFeedEmptyMode,
  FEED_EMPTY_COPY,
  type FeedEmptyMode,
} from '@/features/feed/lib/feedEmptyStates';

import type { FeedEvent, FeedItem, NoteMetrics } from './nostr/feedTypes';
import { DEFAULT_METRICS } from './nostr/feedTypes';
import { tryNpubEncode } from './nostr/feedParse';
import {
  DEFAULT_ENGAGEMENT_STATE,
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
  trackFeedScrollOffset,
} from './nostr/image-overlay';
import { useFeedCardProps } from '@/features/feed/hooks/useFeedCardProps';
import { useFeedContentState } from '@/features/feed/hooks/useFeedContentState';
import { useFeedInteractions } from '@/features/feed/hooks/useFeedInteractions';
import { useFeedRows } from '@/features/feed/hooks/useFeedRows';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Spinner } from '@/shared/ui/primitives/Spinner';

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

// How many posts each home feed (For You, Following Popular/Recent) requests.
// Kept deliberately small — the feed paints faster and pagination tops it up as
// the user scrolls, rather than fetching a large batch up front.
const FEED_INITIAL_LIMIT = 15;
const FEED_PAGE_LIMIT = 10;

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

function EmptyFeed({
  mode,
  onRefresh,
  onFindPeople,
}: {
  mode: FeedEmptyMode;
  onRefresh: () => void;
  onFindPeople: () => void;
}) {
  if (mode === 'loading') return null;
  const copy = FEED_EMPTY_COPY[mode];
  const action = copy.ctaLabel ? (
    <Button
      variant="secondary"
      size="sm"
      onPress={copy.ctaAction === 'find-people' ? onFindPeople : onRefresh}>
      <Button.Label>{copy.ctaLabel}</Button.Label>
    </Button>
  ) : undefined;
  return (
    <EmptyState icon={copy.icon} title={copy.title} subtitle={copy.subtitle} action={action} />
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
    // The first post's height drives the connector line length AND the
    // second (reply) post's vertical offset. When it changes after async
    // content settles, the whole pair reflows below it.
    setFirstHeight((currentHeight) => (currentHeight === nextHeight ? currentHeight : nextHeight));
  }, []);

  const connectorStyle = useMemo(() => {
    const secondAvatarTop = firstHeight + secondAvatarCenterY - FEED_AVATAR_SIZE / 2;
    const connectorBottom = secondAvatarTop - FEED_THREAD_CONNECTOR_AVATAR_GAP;
    return [
      styles.threadPairConnector,
      {
        backgroundColor: withAlpha(foreground, 0.28),
        height: Math.max(0, connectorBottom - FEED_THREAD_CONNECTOR_TOP),
      },
    ];
  }, [firstHeight, foreground, secondAvatarCenterY]);

  return (
    <View>
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
  const ignoredPubkeysKey = useFeedIgnoreStore((state) => state.ignoredPubkeys.join('\u0000'));
  const ignoredEventIdsKey = useFeedIgnoreStore((state) => state.ignoredEventIds.join('\u0000'));
  const feedSpecs = DEFAULT_FEED_SPECS;
  const activeSpecIndex = useMemo(() => {
    if (!activeFilter) return 0;
    const idx = feedSpecs.findIndex((s) => s.name === activeFilter);
    return idx >= 0 ? idx : 0;
  }, [activeFilter, feedSpecs]);
  // Warm-navigation seed: if this spec's page-0 was cached earlier this session
  // (not a cold start), initialise state + pagination refs straight from it so a
  // remount (e.g. closing search) paints instantly instead of flashing a
  // spinner. The trigger effect below still runs loadFeed, but its isFresh gate
  // makes that a no-op (fresh) or a silent revalidate (stale). Consumed only by
  // the lazy initialisers / ref defaults, so it's captured once at mount.
  const initialSpec = feedSpecs[activeSpecIndex]?.spec;
  const initialCacheKey = initialSpec ? feedPageKey(initialSpec, userPubkey) : null;
  const seed =
    initialCacheKey && !feedPageCache.isColdStart(initialCacheKey)
      ? feedPageCache.getEntry(initialCacheKey)?.data
      : undefined;

  const {
    feedItems,
    metricsMap,
    quotedEventsMap,
    profilesMap,
    metricsRef,
    quotedRef,
    profilesRef,
    resetContent,
    applyPage,
    appendPage,
    applyEnrichment,
  } = useFeedContentState(seed);
  const [isLoading, setIsLoading] = useState(() => !seed);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const followCount = useNostrSocialStore((s) => Object.keys(s.followingPubkeys).length);
  const isFollowingFeed =
    activeFilter === FEED_FILTER_FOLLOWING_POPULAR || activeFilter === FEED_FILTER_FOLLOWING_RECENT;
  const openPostActions = usePostActions();
  const paginationRef = useRef(
    seed ? seededPaginationState(seed, isRankedFeedSpec(initialSpec)) : emptyPaginationState()
  );
  const loadingMoreRef = useRef(false);
  const feedItemIdsRef = useRef(
    new Set<string>(
      seed
        ? seed.orderedFeedItems.map((item) =>
            item.type === 'note' ? item.event.id : item.repostEvent.id
          )
        : []
    )
  );
  // Tracks the request prefix of the most recently started loadFeed/loadMoreItems
  // — onUpdate callbacks captured by an older request bail out when this drifts.
  const activeLoadIdRef = useRef<string | null>(null);

  const isFirstRender = useRef(true);

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
  // Body lives in module-scope `loadFeedImpl` — try/finally inside the
  // component would make the React Compiler skip the whole component.

  const loadFeed = useCallback(
    (specIndex: number, isRefresh = false) =>
      loadFeedImpl(
        {
          userPubkey,
          paginationRef,
          feedItemIdsRef,
          loadingMoreRef,
          isFirstRender,
          activeAbortControllerRef,
          activeLoadIdRef,
          quotedRef,
          profilesRef,
          applyPage,
          appendPage,
          applyEnrichment,
          resetContent,
          setIsLoading,
          setIsLoadingMore,
          setIsRefreshing,
          setLoadError,
          beginNetworkLoad,
          isActiveLoad,
        },
        specIndex,
        isRefresh
      ),
    [
      applyEnrichment,
      applyPage,
      appendPage,
      beginNetworkLoad,
      isActiveLoad,
      profilesRef,
      quotedRef,
      resetContent,
      userPubkey,
    ]
  );

  // Trigger feed load when spec (page) changes
  const currentSpec = feedSpecs[activeSpecIndex]?.spec;
  const prevSpecRef = useRef<string | undefined>(undefined);
  const prevPubkeyRef = useRef<string | undefined>(undefined);
  const prevPreferenceKeyRef = useRef<string | undefined>(undefined);
  const preferenceKey = `${ignoredPubkeysKey}|${ignoredEventIdsKey}`;
  useEffect(() => {
    if (!currentSpec) return;
    if (
      currentSpec === prevSpecRef.current &&
      userPubkey === prevPubkeyRef.current &&
      preferenceKey === prevPreferenceKeyRef.current
    )
      return;
    prevSpecRef.current = currentSpec;
    prevPubkeyRef.current = userPubkey;
    prevPreferenceKeyRef.current = preferenceKey;
    void loadFeed(activeSpecIndex);
  }, [activeSpecIndex, currentSpec, userPubkey, preferenceKey, loadFeed]);

  const handleRefresh = useCallback(() => {
    if (!currentSpec || isRefreshing) return;
    setIsRefreshing(true);
    void loadFeed(activeSpecIndex, true);
  }, [activeSpecIndex, currentSpec, isRefreshing, loadFeed]);

  // ── Pagination: load older items ──

  const loadMoreItems = useCallback(
    (): Promise<FeedItem[]> =>
      loadMoreItemsImpl(
        {
          userPubkey,
          paginationRef,
          feedItemIdsRef,
          loadingMoreRef,
          isFirstRender,
          activeAbortControllerRef,
          activeLoadIdRef,
          quotedRef,
          profilesRef,
          applyPage,
          appendPage,
          applyEnrichment,
          resetContent,
          setIsLoading,
          setIsLoadingMore,
          setIsRefreshing,
          setLoadError,
          beginNetworkLoad,
          isActiveLoad,
        },
        currentSpec
      ),
    [
      appendPage,
      applyEnrichment,
      applyPage,
      beginNetworkLoad,
      currentSpec,
      isActiveLoad,
      profilesRef,
      quotedRef,
      resetContent,
      userPubkey,
    ]
  );

  const handleEndReached = useCallback(() => {
    // Don't start pagination while the first page is still loading or a refresh
    // is in flight — otherwise the footer spinner stacks on top of the
    // empty-state / refresh spinner (duplicate spinners).
    if (isLoading || isRefreshing) return;
    void loadMoreItems();
  }, [loadMoreItems, isLoading, isRefreshing]);

  // ── Derived data ──

  // Read the live `metricsMap` state (not `metricsRef`): this accessor feeds the
  // render path via `getDisplayMetrics` → `feedRows`. `useLatestRef` writes its
  // ref in `useInsertionEffect`, i.e. AFTER commit, so during the render where a
  // late `setMetricsMap` lands, `metricsRef.current` is still the previous map.
  // Reading the ref here left rows rendered with DEFAULT_METRICS until an
  // unrelated re-render (a scroll-refresh) rebuilt `feedRows` once the ref had
  // caught up — the "metrics only appear after pull-to-refresh" bug. Depending on
  // `metricsMap` instead changes this callback's identity the moment metrics
  // arrive, so `feedRows` recomputes against fresh aggregate counts immediately.
  const getMetrics = useCallback(
    (noteId: string): NoteMetrics => metricsMap.get(noteId) || DEFAULT_METRICS,
    [metricsMap]
  );

  const {
    getDisplayMetrics,
    getEngagementState,
    getZapState,
    toggleLikeRef,
    toggleRepostRef,
    openZapMenuRef,
    onOverlayOpenedFromIndex,
    getVideoFeedLayoutsAndIndex,
    onSwipeUpToNextPost,
  } = useFeedInteractions({ feedItems, getMetrics, profilesRef });

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

  const feedRows = useFeedRows({
    items: feedItems,
    profilesMap,
    quotedEventsMap,
    metricsMap,
    getDisplayMetrics,
    getEngagementState,
    resolveReposter,
  });

  // Render boundary: how many feed items became rendered rows, and whether the
  // screen is currently showing the empty state. `feedItems > 0 && rows === 0`
  // means a render-stage drop; `empty: true` with items 0 after load means the
  // data layer returned nothing (cross-check feed.nagg.* logs above).
  useEffect(() => {
    feedLog.info('feed.ui.render', {
      spec: feedSpecs[activeSpecIndex]?.name,
      feedItems: feedItems.length,
      rows: feedRows.length,
      isLoading,
      empty: !isLoading && feedRows.length === 0,
    });
  }, [feedItems.length, feedRows.length, isLoading, activeSpecIndex, feedSpecs]);

  const { feedPostCardProps, repostCardProps } = useFeedCardProps({
    getMetrics,
    getZapState,
    onOverlayOpenedFromIndex,
    toggleLikeRef,
    toggleRepostRef,
    openZapMenuRef,
    openPostActions,
    fallbackReposterName: '',
  });

  const renderFeedItem = useCallback(
    ({ item: row, index }: { item: FeedRow; index: number }) => {
      const item = row.item;
      // Both root-context pairs (reply-with-root, repost-with-root) open with
      // the same "root post as first card" head.
      const rootFirstCard = (rootEvent: FeedEvent) => (
        <PostCard
          variant="feed"
          {...feedPostCardProps(
            row,
            index,
            rootEvent,
            row.rootMetrics ?? DEFAULT_METRICS,
            row.rootEngagement ?? DEFAULT_ENGAGEMENT_STATE
          )}
          skipAnimation={!isFirstRender.current}
          getThreadContext={() => getThreadContextRef.current()}
          showFooterBorder={false}
          fullBleedFooterBorder
        />
      );
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
                  {...feedPostCardProps(row, index, item.event, metrics, engagement)}
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
                        {...feedPostCardProps(
                          row,
                          index,
                          replyEvent,
                          replyMetrics,
                          replyEngagement
                        )}
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
          return (
            <FeedThreadPair
              first={rootFirstCard(contextRootEvent)}
              second={
                <PostCard
                  variant="feed"
                  {...feedPostCardProps(row, index, item.event, metrics, engagement)}
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
            {...feedPostCardProps(row, index, item.event, metrics, engagement)}
            skipAnimation={!isFirstRender.current}
            getThreadContext={() => getThreadContextRef.current()}
            fullBleedFooterBorder
          />
        );
      }

      const originalEvent = item.originalEvent;
      const contextRootEvent = row.rootEvent;
      if (contextRootEvent && originalEvent) {
        return (
          <FeedThreadPair
            secondAvatarCenterY={FEED_REPOST_ORIGINAL_AVATAR_CENTER_Y}
            first={rootFirstCard(contextRootEvent)}
            second={
              <RepostCard
                {...repostCardProps(row, index, item)}
                onMorePress={() => openPostActions(originalEvent)}
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
          {...repostCardProps(row, index, item)}
          skipAnimation={!isFirstRender.current}
          getThreadContext={() => getThreadContextRef.current()}
          fullBleedFooterBorder
        />
      );
    },
    [
      feedPostCardProps,
      repostCardProps,
      getDisplayMetrics,
      getEngagementState,
      getThreadContextRef,
      openPostActions,
    ]
  );

  const refreshTintColor = useMemo(() => withAlpha(foreground, 0.5), [foreground]);

  const pullToAi = usePullToAiRefreshControl({
    // Suppress the pull-to-refresh spinner during the initial (cold-start) load
    // so it never stacks on the centered empty-state spinner.
    refreshing: isRefreshing && !isLoading,
    onRefresh: handleRefresh,
    tintColor: refreshTintColor,
  });

  const onScroll = useCallback(
    (e: { nativeEvent: { contentOffset: { y: number } } }) =>
      trackFeedScrollOffset(scrollOffsetRef, imageOverlay, e.nativeEvent.contentOffset.y),
    [imageOverlay]
  );

  return (
    <Log name="HomeFeed">
      <ImageOverlayProvider
        getDisplayMetrics={getDisplayMetrics}
        getEngagementState={getEngagementState}
        onSwipeUpToNextPost={onSwipeUpToNextPost}
        getVideoFeedLayoutsAndIndex={getVideoFeedLayoutsAndIndex}>
        <View style={styles.flex1}>
          <List
            screen
            bottomSpacing={COMPOSE_FAB_CLEARANCE}
            data={feedRows}
            keyExtractor={getFeedRowKey}
            getItemType={getFeedRowItemType}
            drawDistance={400}
            renderItem={renderFeedItem}
            ListEmptyComponent={
              isLoading ? (
                <Spinner size={22} style={styles.loader} />
              ) : (
                <EmptyFeed
                  mode={selectFeedEmptyMode({
                    isLoading,
                    hasError: loadError,
                    rowCount: 0,
                    isFollowingFeed,
                    followCount,
                  })}
                  onRefresh={handleRefresh}
                  onFindPeople={() => router.push('/contacts')}
                />
              )
            }
            ListFooterComponent={
              // Only show the pagination spinner once there's content — never
              // alongside the empty-state spinner.
              isLoadingMore && feedRows.length > 0 ? (
                <Spinner size={18} style={styles.loadMoreSpinner} />
              ) : null
            }
            onEndReached={handleEndReached}
            onEndReachedThreshold={0.4}
            style={styles.flex1}
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

const DEFAULT_FEED_SPECS: FeedSpec[] = [
  {
    name: FEED_FILTER_FOR_YOU,
    spec: JSON.stringify({ id: 'for-you', kind: 'notes', hours: 24 }),
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
// Feed loading — module scope
// ============================================================================
// These bodies contain try/finally, which the React Compiler cannot lower
// (BuildHIR TryStatement); keeping them inside HomeFeed made it skip the whole
// component. Hoisted here, the component compiles and the loaders stay plain
// async functions over an explicit context.

type FeedPaginationState = ReturnType<typeof emptyPaginationState>;
type FeedContentState = ReturnType<typeof useFeedContentState>;

interface HomeFeedLoadCtx {
  userPubkey: string | undefined;
  paginationRef: { current: FeedPaginationState };
  feedItemIdsRef: { current: Set<string> };
  loadingMoreRef: { current: boolean };
  isFirstRender: { current: boolean };
  activeAbortControllerRef: { current: AbortController | null };
  activeLoadIdRef: { current: string | null };
  quotedRef: FeedContentState['quotedRef'];
  profilesRef: FeedContentState['profilesRef'];
  applyPage: FeedContentState['applyPage'];
  appendPage: FeedContentState['appendPage'];
  applyEnrichment: FeedContentState['applyEnrichment'];
  resetContent: FeedContentState['resetContent'];
  setIsLoading: (value: boolean) => void;
  setIsLoadingMore: (value: boolean) => void;
  setIsRefreshing: (value: boolean) => void;
  setLoadError: (value: boolean) => void;
  beginNetworkLoad: () => { requestId: string; controller: AbortController };
  isActiveLoad: (requestId: string) => boolean;
}

async function loadFeedImpl(
  ctx: HomeFeedLoadCtx,
  specIndex: number,
  isRefresh: boolean
): Promise<void> {
  const {
    userPubkey,
    paginationRef,
    feedItemIdsRef,
    loadingMoreRef,
    isFirstRender,
    activeAbortControllerRef,
    activeLoadIdRef,
    applyPage,
    applyEnrichment,
    resetContent,
    setIsLoading,
    setIsLoadingMore,
    setIsRefreshing,
    setLoadError,
    beginNetworkLoad,
    isActiveLoad,
  } = ctx;
  const feedSpecs = DEFAULT_FEED_SPECS;
  const spec = feedSpecs[specIndex]?.spec;
  if (!spec) return;
  feedLog.info('feed.ui.load', {
    spec: feedSpecs[specIndex]?.name,
    specIndex,
    isRefresh,
    hasViewer: !!userPubkey,
  });
  const cacheKey = feedPageKey(spec, userPubkey);

  // Applies a page-0 result to state + pagination refs. Used both for the
  // instant warm-nav paint and for the fresh fetch.
  const applyPhase1 = (phase1: FeedParseResult) => {
    paginationRef.current = seededPaginationState(phase1, isRankedFeedSpec(spec));
    feedItemIdsRef.current = new Set(
      phase1.orderedFeedItems.map((item) =>
        item.type === 'note' ? item.event.id : item.repostEvent.id
      )
    );
    applyPage(phase1);
  };

  isFirstRender.current = true;
  loadingMoreRef.current = false;
  setIsLoadingMore(false);

  // Warm navigation (key touched earlier this session): paint the cached
  // page-0 instantly (keeping its pagination cursor). If it's still fresh,
  // that paint is authoritative and we skip the network entirely; if stale,
  // we revalidate silently below (no spinner). Cold start / refresh: show
  // loading, never a stale first paint.
  let paintedFromCache = false;
  const cachedEntry =
    !isRefresh && !feedPageCache.isColdStart(cacheKey)
      ? feedPageCache.getEntry(cacheKey)
      : undefined;
  if (cachedEntry) {
    applyPhase1(cachedEntry.data);
    setIsLoading(false);
    paintedFromCache = true;
  }
  if (!paintedFromCache) {
    if (!isRefresh) {
      setIsLoading(true);
      // Cold load for this spec: clear the previous spec's rows so they don't
      // linger under the spinner. (Replaces the old reset effect, which clobbered
      // the warm paint on every tab change.) On pull-to-refresh we keep the
      // current rows visible while the refresh spinner runs.
      resetContent();
    }
    paginationRef.current = emptyPaginationState();
    feedItemIdsRef.current.clear();
  } else if (feedPageCache.isFresh(cachedEntry)) {
    // Warm + fresh: the instant paint above is complete and authoritative.
    // Cancel any in-flight load so a slower previous fetch can't overwrite
    // this paint, then skip the network — no spinner, no request.
    activeAbortControllerRef.current?.abort();
    activeAbortControllerRef.current = null;
    activeLoadIdRef.current = null;
    requestAnimationFrame(() => {
      isFirstRender.current = false;
    });
    return;
  }

  const { requestId, controller } = beginNetworkLoad();
  const client = getFeedClient();
  let didApplyPage = paintedFromCache;

  try {
    const phase1 = await client.getFeed({
      spec,
      userPubkey,
      limit: FEED_INITIAL_LIMIT,
      refresh: isRefresh,
      signal: controller.signal,
    });

    if (!isActiveLoad(requestId)) return;

    feedLog.info('feed.ui.fetch.applied', {
      spec: feedSpecs[specIndex]?.name,
      items: phase1.orderedFeedItems.length,
      paginationUntil: phase1.paginationUntil,
      isRefresh,
    });
    applyPhase1(phase1);
    feedPageCache.setEntry(cacheKey, phase1, { viewerKey: userPubkey || '' });
    feedPageCache.markTouched(cacheKey);
    didApplyPage = true;
    setLoadError(false);
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
    // Enrichment arrives after the first paint: quoted posts resolve from
    // placeholders, mention/author names and avatars fill in. Each updates
    // a map that re-renders rows and can grow their height — log the counts
    // so a post-paint shift can be tied to which enrichment landed.
    feedLog.info('feed.shift.enrich', {
      spec: feedSpecs[specIndex]?.name,
      quotedEvents: updates.quotedEvents?.size ?? 0,
      metrics: updates.metrics?.size ?? 0,
      profiles: updates.profiles?.size ?? 0,
      isRefresh,
    });
    applyEnrichment(updates);
  } catch (error) {
    if (!isActiveLoad(requestId)) return;
    log.error('feed.home.load_failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    if (!isRefresh && !didApplyPage) {
      resetContent();
    }
    setLoadError(true);
    setIsLoading(false);
    setIsRefreshing(false);
  } finally {
    if (activeAbortControllerRef.current === controller) {
      activeAbortControllerRef.current = null;
    }
    client.dispose?.();
  }
}

async function loadMoreItemsImpl(
  ctx: HomeFeedLoadCtx,
  currentSpec: string | undefined
): Promise<FeedItem[]> {
  const {
    userPubkey,
    paginationRef,
    feedItemIdsRef,
    loadingMoreRef,
    activeAbortControllerRef,
    quotedRef,
    profilesRef,
    appendPage,
    applyEnrichment,
    setIsLoadingMore,
    beginNetworkLoad,
    isActiveLoad,
  } = ctx;
  const ranked = isRankedFeedSpec(currentSpec);
  if (
    loadingMoreRef.current ||
    !paginationRef.current.hasMore ||
    !currentSpec ||
    (!ranked && paginationRef.current.until === 0)
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
      limit: FEED_PAGE_LIMIT,
      until: paginationRef.current.until > 0 ? paginationRef.current.until : undefined,
      offset: paginationRef.current.offset > 0 ? paginationRef.current.offset : undefined,
      signal: controller.signal,
    });

    if (!isActiveLoad(requestId)) return [];

    const advanced = advancedPaginationState(paginationRef.current, page, ranked);
    paginationRef.current = advanced;
    if (!advanced.hasMore) return [];

    const newItems = page.orderedFeedItems.filter((item) => {
      const id = item.type === 'note' ? item.event.id : item.repostEvent.id;
      return !feedItemIdsRef.current.has(id);
    });

    if (newItems.length === 0) {
      paginationRef.current = { ...paginationRef.current, hasMore: false };
      return [];
    }

    for (const item of newItems) {
      feedItemIdsRef.current.add(item.type === 'note' ? item.event.id : item.repostEvent.id);
    }

    // Appending a page extends the list below the fold. With a stable
    // `estimatedItemSize`/key list this should not move the viewport, but a
    // mismatch between estimated and real row heights does — log the append
    // so a scroll jump on "load more" can be correlated.
    feedLog.info('feed.shift.append', {
      appended: newItems.length,
      total: feedItemIdsRef.current.size,
      paginationUntil: page.paginationUntil,
    });
    appendPage(page, newItems);

    const missingQ = page.missingQuotedIds.filter((id) => !quotedRef.current.has(id));
    const missingP = page.missingProfilePubkeys.filter((pk) => !profilesRef.current.has(pk));
    const updates = await client.enrich({
      missingQuotedIds: missingQ,
      missingProfilePubkeys: missingP,
      signal: controller.signal,
    });
    if (!isActiveLoad(requestId)) return newItems;
    applyEnrichment(updates);
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
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  loader: {
    alignSelf: 'center',
    marginTop: 48,
  },
  loadMoreSpinner: {
    alignSelf: 'center',
    paddingVertical: 24,
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
