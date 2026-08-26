/**
 * @fileoverview User Feed Component
 *
 * Displays a Nostr user's Kind 1 (text note) feed with engagement metrics
 * and rich content rendering.
 *
 * ## Engagement metrics
 * - Like count (Kind 7 reactions)
 * - Repost count (Kind 6 reposts)
 * - Reply count (Kind 1 replies referencing the post)
 *
 * ## Rich content parsing (NIP-19/NIP-27 + media)
 * - nostr:npub / nostr:nprofile → tappable @mention linking to profile
 * - nostr:nevent / nostr:note   → inline quoted-post preview card with avatar
 * - nostr:naddr                 → article reference badge
 * - Image URLs                  → inline image (expo-image)
 * - Video URLs                  → inline video player (expo-video)
 * - Regular URLs                → tappable link
 * - #hashtags                   → styled hashtag text
 * - Lightning invoices (lnbc…)  → tappable payment card
 * - Newlines                    → preserved
 *
 * Uses the swappable FeedClient boundary for bundled feed lookups.
 */

import React, { useMemo, useRef, useEffect, useCallback, useState } from 'react';
import { StyleSheet, InteractionManager } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { seedThread, type ThreadSeed } from '@/features/feed/lib/threadSeedCache';
import { useLatestRef } from '@/shared/hooks/useLatestRef';
import { useFadeRevealProbe } from '@/shared/lib/debug/fadeRevealProbe';
import { log, Log, feedLog } from '@/shared/lib/logger';
import { resolveIdentityName } from '@/shared/lib/identity';
import { Text } from '@/shared/ui/primitives/Text';
import { Spinner } from '@/shared/ui/primitives/Spinner';
import { Button } from 'heroui-native';
import { EmptyState } from '@/shared/ui/composed/EmptyState';
import { useOpenComposer } from '@/features/composer/publish/useComposerActions';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import Icon from 'assets/icons';
import { withAlpha } from '@/shared/lib/color';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withTiming,
  runOnJS,
  Easing,
} from 'react-native-reanimated';

// ============================================================================
// Shared module — types, constants, utils, rendering components
// ============================================================================

import type {
  FeedEvent,
  FeedItem,
  NoteMetrics,
  ProfileInfo,
  VideoPostRecord,
} from './nostr/feedTypes';
import { DEFAULT_METRICS } from './nostr/feedTypes';
import { buildDedupedVideoPosts } from './nostr/videoLayout';
import { getFeedClient } from '@/features/feed/data/useFeedClient';
import {
  DEFAULT_ENGAGEMENT_STATE,
  getFeedRowItemType,
  getFeedRowKey,
  type FeedRow,
} from '@/features/feed/lib/feedRows';

import { PostCard } from './nostr/PostCard';
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
import { usePostActions } from '@/features/feed/hooks/usePostActions';
import { useNostrSocialStore } from '@/shared/stores/profile/nostrSocialStore';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { List } from '@/shared/ui/composed/List';

// ============================================================================
// Types (UserFeed-specific)
// ============================================================================

interface UserFeedProps {
  pubkey: string;
  authorName?: string;
  authorPicture?: string;
  isOwnProfile?: boolean;
  ListHeaderComponent?: React.ReactElement | null;
  onVideoPostsReady?: (videoPosts: VideoPostRecord[]) => void;
}

// ============================================================================
// Repost Card — thin wrapper: animation + "reposted by" header + PostCard
// ============================================================================

export const RepostCard = React.memo(function RepostCard({
  repostEvent: _repostEvent,
  originalEvent,
  originalMetrics,
  index,
  quotedEvents,
  profiles,
  getMetrics,
  reposterName,
  reposterPubkey,
  reposters,
  feedIndex,
  onOverlayOpenedFromIndex,
  onVideoTap,
  liked = false,
  replied = false,
  reposted = false,
  zapped = false,
  likePending = false,
  repostPending = false,
  zapPending = false,
  likePendingDirection,
  repostPendingDirection,
  onLikePress,
  onRepostPress,
  onZapPress,
  onMorePress,
  skipAnimation,
  getThreadContext,
  showLineAbove = false,
  fullBleedFooterBorder = false,
}: {
  repostEvent: FeedEvent;
  originalEvent: FeedEvent | undefined;
  originalMetrics: NoteMetrics;
  index: number;
  quotedEvents: Map<string, FeedEvent>;
  profiles: Map<string, ProfileInfo>;
  getMetrics: (eventId: string) => NoteMetrics;
  reposterName: string;
  reposterPubkey: string;
  reposters?: { name: string; pubkey: string }[];
  feedIndex?: number;
  onOverlayOpenedFromIndex?: (index: number) => void;
  onVideoTap?: (url: string) => void;
  liked?: boolean;
  replied?: boolean;
  reposted?: boolean;
  zapped?: boolean;
  likePending?: boolean;
  repostPending?: boolean;
  zapPending?: boolean;
  likePendingDirection?: 'activating' | 'deactivating';
  repostPendingDirection?: 'activating' | 'deactivating';
  onLikePress?: () => void;
  onRepostPress?: () => void;
  onZapPress?: () => void;
  onMorePress?: () => void;
  skipAnimation?: boolean;
  getThreadContext?: () => ThreadSeed | null;
  showLineAbove?: boolean;
  fullBleedFooterBorder?: boolean;
}) {
  const [foreground, surface, surfaceTertiary] = useThemeColor([
    'foreground',
    'surface',
    'surface-tertiary',
  ] as const);
  const progress = useSharedValue(skipAnimation ? 1 : 0);

  useEffect(() => {
    if (skipAnimation) return;
    progress.set(
      withDelay(
        Math.min(index * 60, 300),
        withTiming(1, { duration: 350, easing: Easing.out(Easing.cubic) })
      )
    );
  }, [progress, index, skipAnimation]);
  // [DEBUG-inv] catches the card entrance animation never flushing (invisible feed rows)
  useFadeRevealProbe(`feed.card:${index}`, progress, {
    enabled: !skipAnimation,
    deadlineMs: 1600,
  });

  const animStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ translateY: (1 - progress.get()) * 12 }],
  }));

  const threadEventId = originalEvent?.id || _repostEvent.id;
  const primaryReposter = reposters?.[0] ?? { name: reposterName, pubkey: reposterPubkey };
  const repostHeaderText =
    reposters && reposters.length > 1
      ? `${primaryReposter.name} and ${reposters.length - 1} ${
          reposters.length === 2 ? 'other' : 'others'
        } reposted`
      : `${primaryReposter.name} reposted`;

  const navigateToThread = useCallback(() => {
    const ctx = getThreadContext?.() ?? null;
    const allEvents = new Map(ctx?.allEvents ?? []);
    if (originalEvent) allEvents.set(originalEvent.id, originalEvent);
    allEvents.set(_repostEvent.id, _repostEvent);
    seedThread(threadEventId, {
      allEvents,
      profiles: ctx?.profiles ?? new Map(),
      metrics: ctx?.metrics ?? new Map(),
      quotedEvents: ctx?.quotedEvents ?? new Map(),
    });
    router.push({
      pathname: '/(user-flow)/thread',
      params: { eventId: threadEventId },
    });
  }, [threadEventId, getThreadContext, originalEvent, _repostEvent]);

  const suppressThreadTapRef = useRef(false);

  const suppressThreadTapStart = useCallback(() => {
    suppressThreadTapRef.current = true;
  }, []);

  const suppressThreadTapEnd = useCallback(() => {
    setTimeout(() => {
      suppressThreadTapRef.current = false;
    }, 0);
  }, []);

  const handleThreadPress = useCallback(() => {
    if (suppressThreadTapRef.current) return;
    navigateToThread();
  }, [navigateToThread]);

  const tapGesture = useMemo(
    () =>
      Gesture.Tap().onEnd(() => {
        'worklet';
        runOnJS(handleThreadPress)();
      }),
    [handleThreadPress]
  );

  return (
    <GestureDetector gesture={tapGesture}>
      <Reanimated.View style={animStyle}>
        {/* Repost header */}
        <Pressable
          activeOpacity={0.7}
          onPressIn={suppressThreadTapStart}
          onPressOut={suppressThreadTapEnd}
          onPress={() =>
            router.push({
              pathname: '/(user-flow)/profile',
              params: { pubkey: primaryReposter.pubkey },
            })
          }>
          <HStack
            align="center"
            gap={6}
            style={{ paddingHorizontal: 16, paddingTop: 10, marginLeft: 36 + 12 }}>
            <Icon
              name="garden:arrow-retweet-fill-16"
              size={14}
              color={withAlpha(foreground, 0.33)}
            />
            <Text size={12} semibold style={{ color: withAlpha(foreground, 0.33) }}>
              {repostHeaderText}
            </Text>
          </HStack>
        </Pressable>

        {originalEvent ? (
          <PostCard
            variant="repost-original"
            event={originalEvent}
            metrics={originalMetrics}
            quotedEvents={quotedEvents}
            profiles={profiles}
            getMetrics={getMetrics}
            feedIndex={feedIndex}
            onOverlayOpenedFromIndex={onOverlayOpenedFromIndex}
            onVideoTap={onVideoTap}
            liked={liked}
            replied={replied}
            reposted={reposted}
            zapped={zapped}
            likePending={likePending}
            repostPending={repostPending}
            zapPending={zapPending}
            likePendingDirection={likePendingDirection}
            repostPendingDirection={repostPendingDirection}
            onLikePress={onLikePress}
            onRepostPress={onRepostPress}
            onZapPress={onZapPress}
            onMorePress={onMorePress}
            onNestedProfilePressIn={suppressThreadTapStart}
            onNestedProfilePressOut={suppressThreadTapEnd}
            getThreadContext={getThreadContext}
            showLineAbove={showLineAbove}
            fullBleedFooterBorder={fullBleedFooterBorder}
          />
        ) : (
          <View
            style={[
              styles.missingRepost,
              {
                backgroundColor: surface,
                borderColor: surfaceTertiary,
              },
            ]}>
            <HStack align="center" gap={6}>
              <Icon name="mdi:message-text" size={14} color={withAlpha(foreground, 0.33)} />
              <Text size={13} italic style={{ color: withAlpha(foreground, 0.33) }}>
                Original post unavailable
              </Text>
            </HStack>
          </View>
        )}
      </Reanimated.View>
    </GestureDetector>
  );
});

// ============================================================================
// Empty State
// ============================================================================

function EmptyFeed({ isOwnProfile }: { isOwnProfile?: boolean }) {
  const openComposer = useOpenComposer();
  const action = isOwnProfile ? (
    <Button variant="secondary" size="sm" onPress={() => openComposer({ mode: 'new' })}>
      <Button.Label>Write a post</Button.Label>
    </Button>
  ) : undefined;
  return (
    <EmptyState
      icon="mdi:message-text"
      title="No posts yet"
      subtitle={
        isOwnProfile
          ? 'Share your first note with the world.'
          : "This user hasn't posted any notes."
      }
      action={action}
    />
  );
}

// ============================================================================
// Main UserFeed Component
// ============================================================================

export function UserFeed({
  pubkey,
  authorName,
  authorPicture,
  isOwnProfile,
  ListHeaderComponent,
  onVideoPostsReady,
}: UserFeedProps) {
  const foreground = useThemeColor('foreground');
  const imageOverlay = useImageOverlay();
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
  } = useFeedContentState();
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const hasMoreRef = useRef(true);
  const paginationUntilRef = useRef(0);
  const paginationOffsetRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const feedItemIdsRef = useRef(new Set<string>());
  // Tracks the prefix of the most recent loadMoreItems request so enrichment
  // cannot write into a feed reset by a later author switch.
  const activeLoadMoreIdRef = useRef<string | null>(null);

  // Track whether initial load has completed — skip fade-in for items after first render
  const isFirstRender = useRef(true);

  // Snapshot of deleted-repost IDs taken at first feed load. Using a snapshot
  // rather than live state means unreposting while viewing won't yank items away
  // (protects against accidental taps). Nagg's app-view cache will catch up eventually.
  const deletedRepostIdsRef = useRef<Record<string, number> | null>(null);

  const scrollOffsetRef = useRef(0);

  useEffect(() => {
    if (!pubkey) {
      resetContent();
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    isFirstRender.current = true;
    hasMoreRef.current = true;
    paginationUntilRef.current = 0;
    paginationOffsetRef.current = 0;
    feedItemIdsRef.current.clear();
    loadingMoreRef.current = false;
    activeLoadMoreIdRef.current = null;
    deletedRepostIdsRef.current = null;

    // Body lives in module-scope `loadUserFeedImpl` — try/finally inside the
    // component would make the React Compiler skip the whole component.
    const task = InteractionManager.runAfterInteractions(() => {
      void loadUserFeedImpl(
        {
          pubkey,
          authorName,
          authorPicture,
          isOwnProfile,
          hasMoreRef,
          paginationUntilRef,
          paginationOffsetRef,
          loadingMoreRef,
          feedItemIdsRef,
          activeLoadMoreIdRef,
          isFirstRender,
          deletedRepostIdsRef,
          quotedRef,
          profilesRef,
          applyPage,
          appendPage,
          applyEnrichment,
          resetContent,
          setIsLoading,
          setIsLoadingMore,
        },
        () => cancelled
      );
    });

    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [
    appendPage,
    applyEnrichment,
    applyPage,
    authorName,
    authorPicture,
    isOwnProfile,
    profilesRef,
    pubkey,
    quotedRef,
    resetContent,
  ]);

  // ── Pagination: load older items ──

  const loadMoreItems = useCallback(
    (): Promise<FeedItem[]> =>
      loadMoreUserItemsImpl({
        pubkey,
        authorName,
        authorPicture,
        isOwnProfile,
        hasMoreRef,
        paginationUntilRef,
        paginationOffsetRef,
        loadingMoreRef,
        feedItemIdsRef,
        activeLoadMoreIdRef,
        isFirstRender,
        deletedRepostIdsRef,
        quotedRef,
        profilesRef,
        applyPage,
        appendPage,
        applyEnrichment,
        resetContent,
        setIsLoading,
        setIsLoadingMore,
      }),
    [
      appendPage,
      applyEnrichment,
      applyPage,
      authorName,
      authorPicture,
      isOwnProfile,
      profilesRef,
      pubkey,
      quotedRef,
      resetContent,
    ]
  );

  const handleEndReached = useCallback(() => {
    // Defensive: never paginate during the first load (the footer spinner would
    // otherwise be able to stack on the header/empty spinner).
    if (isLoading) return;
    void loadMoreItems();
  }, [loadMoreItems, isLoading]);

  const getMetrics = useCallback(
    (noteId: string): NoteMetrics => metricsRef.current.get(noteId) || DEFAULT_METRICS,
    [metricsRef]
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
  const openPostActions = usePostActions();

  const videoPosts = useMemo((): VideoPostRecord[] => {
    const sourceEvents: FeedEvent[] = [];
    for (const item of feedItems) {
      if (item.rootEvent) sourceEvents.push(item.rootEvent);
      const event = item.type === 'note' ? item.event : item.originalEvent;
      if (event) sourceEvents.push(event);
    }
    return buildDedupedVideoPosts(sourceEvents);
  }, [feedItems]);

  useEffect(() => {
    onVideoPostsReady?.(videoPosts);
  }, [videoPosts, onVideoPostsReady]);

  // ---------------------------
  // Render
  // ---------------------------
  const displayName = resolveIdentityName({
    pubkey,
    overrideName: authorName,
  });

  const getThreadContext = useCallback(() => {
    const allEvents = new Map<string, FeedEvent>();
    for (const it of feedItems) {
      if (it.rootEvent) {
        allEvents.set(it.rootEvent.id, it.rootEvent);
      }
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
  const getThreadContextRef = useLatestRef(getThreadContext);

  const resolveReposter = useCallback(
    () => ({
      name: displayName,
      pubkey,
    }),
    [displayName, pubkey]
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

  // Render boundary / skeleton→content swap: mirrors HomeFeed's `feed.ui.render`
  // so a profile-feed content shift can be traced the same way.
  useEffect(() => {
    feedLog.info('feed.shift.render', {
      surface: 'user',
      feedItems: feedItems.length,
      rows: feedRows.length,
      isLoading,
      empty: !isLoading && feedRows.length === 0,
    });
  }, [feedItems.length, feedRows.length, isLoading]);

  const { feedPostCardProps, repostCardProps } = useFeedCardProps({
    getMetrics,
    getZapState,
    onOverlayOpenedFromIndex,
    toggleLikeRef,
    toggleRepostRef,
    openZapMenuRef,
    openPostActions,
    fallbackReposterName: displayName,
    fallbackReposterPubkey: pubkey,
  });

  const renderFeedItem = useCallback(
    ({ item: row, index }: { item: FeedRow; index: number }) => {
      const item = row.item;
      if (item.type === 'note') {
        const metrics = row.metrics;
        const engagement = row.engagement;
        const contextRootEvent = row.rootEvent;
        if (contextRootEvent) {
          const rootEvent = contextRootEvent;
          const rootMetrics = row.rootMetrics ?? DEFAULT_METRICS;
          const rootEngagement = row.rootEngagement ?? DEFAULT_ENGAGEMENT_STATE;
          return (
            <View>
              <PostCard
                variant="feed"
                {...feedPostCardProps(row, index, rootEvent, rootMetrics, rootEngagement)}
                skipAnimation={!isFirstRender.current}
                showLineBelow
                getThreadContext={() => getThreadContextRef.current()}
              />
              <PostCard
                variant="thread-reply"
                {...feedPostCardProps(row, index, item.event, metrics, engagement)}
                showLineAbove
                getThreadContext={() => getThreadContextRef.current()}
              />
            </View>
          );
        }
        return (
          <PostCard
            variant="feed"
            {...feedPostCardProps(row, index, item.event, metrics, engagement)}
            skipAnimation={!isFirstRender.current}
            getThreadContext={() => getThreadContextRef.current()}
          />
        );
      }
      const originalEvent = item.originalEvent;
      const contextRootEvent = row.rootEvent;
      if (contextRootEvent && originalEvent) {
        const rootEvent = contextRootEvent;
        const rootMetrics = row.rootMetrics ?? DEFAULT_METRICS;
        const rootEngagement = row.rootEngagement ?? DEFAULT_ENGAGEMENT_STATE;
        return (
          <View>
            <PostCard
              variant="feed"
              {...feedPostCardProps(row, index, rootEvent, rootMetrics, rootEngagement)}
              skipAnimation={!isFirstRender.current}
              showLineBelow
              getThreadContext={() => getThreadContextRef.current()}
            />
            <RepostCard
              {...repostCardProps(row, index, item)}
              onMorePress={() => openPostActions(originalEvent)}
              skipAnimation={!isFirstRender.current}
              getThreadContext={() => getThreadContextRef.current()}
              showLineAbove
            />
          </View>
        );
      }
      return (
        <RepostCard
          {...repostCardProps(row, index, item)}
          skipAnimation={!isFirstRender.current}
          getThreadContext={() => getThreadContextRef.current()}
        />
      );
    },
    [feedPostCardProps, repostCardProps, getThreadContextRef, openPostActions]
  );

  const handleListScroll = useCallback(
    (e: { nativeEvent: { contentOffset: { y: number } } }) =>
      trackFeedScrollOffset(scrollOffsetRef, imageOverlay, e.nativeEvent.contentOffset.y),
    [imageOverlay]
  );

  const feedHeader = (
    <View>
      {ListHeaderComponent}
      <View style={styles.feedContainer}>
        <Text medium size={13} style={[styles.sectionTitle, { color: withAlpha(foreground, 0.5) }]}>
          Notes
        </Text>
        {isLoading ? (
          <Spinner size={22} style={{ marginTop: 32 }} />
        ) : feedItems.length === 0 ? (
          <EmptyFeed isOwnProfile={isOwnProfile} />
        ) : null}
      </View>
    </View>
  );

  const feedList =
    isLoading || feedItems.length === 0 ? (
      // Loading or empty: header-only mode (no rows to render).
      <List
        data={[] as FeedRow[]}
        renderItem={() => null}
        ListHeaderComponent={feedHeader}
        style={styles.flexOne}
        contentContainerStyle={USER_FEED_CONTENT_STYLE}
        showsVerticalScrollIndicator={false}
        onScroll={handleListScroll}
        scrollEventThrottle={16}
      />
    ) : (
      <List
        data={feedRows}
        keyExtractor={getFeedRowKey}
        getItemType={getFeedRowItemType}
        drawDistance={500}
        renderItem={renderFeedItem}
        ListHeaderComponent={feedHeader}
        ListFooterComponent={
          isLoadingMore ? <Spinner size={18} style={{ paddingVertical: 24 }} /> : null
        }
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.4}
        style={styles.flexOne}
        contentContainerStyle={USER_FEED_CONTENT_STYLE}
        showsVerticalScrollIndicator={false}
        onScroll={handleListScroll}
        scrollEventThrottle={16}
      />
    );

  return (
    <Log name="UserFeed">
      <ImageOverlayProvider
        getDisplayMetrics={getDisplayMetrics}
        getEngagementState={getEngagementState}
        onSwipeUpToNextPost={onSwipeUpToNextPost}
        getVideoFeedLayoutsAndIndex={getVideoFeedLayoutsAndIndex}>
        {feedList}
        <AnimatedImageOverlay />
      </ImageOverlayProvider>
    </Log>
  );
}

// ============================================================================
// Feed loading — module scope
// ============================================================================
// These bodies contain try/finally, which the React Compiler cannot lower
// (BuildHIR TryStatement); keeping them inside UserFeed made it skip the whole
// component. Hoisted here, the component compiles and the loaders stay plain
// async functions over an explicit context.

type UserFeedContentState = ReturnType<typeof useFeedContentState>;

interface UserFeedLoadCtx {
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

async function loadUserFeedImpl(ctx: UserFeedLoadCtx, isCancelled: () => boolean): Promise<void> {
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
    log.error('feed.user.load_failed', { error });
    if (!isCancelled()) {
      resetContent();
      setIsLoading(false);
    }
  } finally {
    client.dispose?.();
  }
}

async function loadMoreUserItemsImpl(ctx: UserFeedLoadCtx): Promise<FeedItem[]> {
  const {
    pubkey,
    authorName,
    authorPicture,
    isOwnProfile,
    hasMoreRef,
    paginationUntilRef,
    paginationOffsetRef,
    loadingMoreRef,
    feedItemIdsRef,
    activeLoadMoreIdRef,
    deletedRepostIdsRef,
    quotedRef,
    profilesRef,
    appendPage,
    applyEnrichment,
    setIsLoadingMore,
  } = ctx;
  if (loadingMoreRef.current || !hasMoreRef.current || !pubkey || paginationUntilRef.current === 0)
    return [];

  loadingMoreRef.current = true;
  setIsLoadingMore(true);
  const rp = Date.now().toString(36);
  activeLoadMoreIdRef.current = rp;
  const client = getFeedClient();

  try {
    const page = await client.getUserFeed({
      pubkey,
      authorName,
      authorPicture,
      limit: 30,
      until: paginationUntilRef.current,
      offset: paginationOffsetRef.current > 0 ? paginationOffsetRef.current : undefined,
    });

    if (page.orderedFeedItems.length === 0) {
      hasMoreRef.current = false;
      return [];
    }

    if (page.paginationUntil > 0 && page.paginationUntil < paginationUntilRef.current) {
      paginationUntilRef.current = page.paginationUntil;
      paginationOffsetRef.current = page.paginationOffset;
    } else if (page.paginationUntil === paginationUntilRef.current) {
      // Same cursor (score-based feeds) — accumulate offset
      paginationOffsetRef.current += page.paginationOffset;
    } else {
      // No valid cursor from FeedRange — fallback to oldest item timestamp
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

    const dedupedItems = page.orderedFeedItems.filter((item) => {
      const id = item.type === 'note' ? item.event.id : item.repostEvent.id;
      return !feedItemIdsRef.current.has(id);
    });

    if (dedupedItems.length === 0) {
      hasMoreRef.current = false;
      return [];
    }

    for (const item of dedupedItems) {
      feedItemIdsRef.current.add(item.type === 'note' ? item.event.id : item.repostEvent.id);
    }

    const newItems =
      isOwnProfile && deletedRepostIdsRef.current
        ? dedupedItems.filter((item) => {
            if (item.type !== 'repost') return true;
            return !deletedRepostIdsRef.current![item.originalEventId];
          })
        : dedupedItems;

    feedLog.info('feed.shift.append', {
      surface: 'user',
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
    });
    if (activeLoadMoreIdRef.current !== rp) return dedupedItems;
    applyEnrichment(updates);
    return dedupedItems;
  } catch (error) {
    log.error('feed.user.load_more_failed', { error });
    return [];
  } finally {
    client.dispose?.();
    loadingMoreRef.current = false;
    setIsLoadingMore(false);
  }
}

// ============================================================================
// Stable list references
// ============================================================================

// ============================================================================
// Styles (UserFeed-specific only — shared styles live in nostr/shared.tsx)
// ============================================================================

const USER_FEED_CONTENT_STYLE = { paddingBottom: 120 };

const styles = StyleSheet.create({
  flexOne: {
    flex: 1,
  },
  emptyState: {
    paddingVertical: 32,
    paddingHorizontal: 16,
  },
  feedContainer: {},
  textAlignCenter: {
    textAlign: 'center',
  },
  sectionTitle: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 12,
    marginBottom: 8,
    marginLeft: 16,
  },
  missingRepost: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginHorizontal: 16,
    marginVertical: 10,
  },
});
