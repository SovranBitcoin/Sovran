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
import { StyleSheet } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { seedThread, type ThreadSeed } from '@/features/feed/lib/threadSeedCache';
import { useLatestRef } from '@/shared/hooks/useLatestRef';
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
import { useCardTapGesture } from '@/features/feed/hooks/useCardTapGesture';
import { GestureDetector } from 'react-native-gesture-handler';
import { iconSize, spacing } from '@/shared/styles/tokens';
import {
  POST_CONTENT_INDENT,
  POST_FONT_FAMILY,
  POST_PADDING_H,
  POST_PADDING_TOP,
  postInk,
  postType,
} from '@/features/feed/lib/postTypography';

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
  enrichUserFeedPage,
  fetchUserFeedPage,
  type UserFeedLoadCtx,
} from '@/features/feed/lib/loadUserFeed';
import { feedPageCache, feedPageKey } from '@/features/feed/data/feedCache';
import { peekProfileFeedSeed } from '@/features/feed/lib/profileFeedSeedCache';
import { readIsUnavailable, type FeedParseResult } from '@/features/feed/data/feedClient';
import { useCachedRead } from '@/shared/lib/read/useCachedRead';
import { useNostrSocialStore } from '@/shared/stores/profile/nostrSocialStore';
import { Button as PrimitiveButton } from '@/shared/ui/primitives/Button';
import {
  DEFAULT_ENGAGEMENT_STATE,
  getFeedRowItemType,
  type FeedRow,
} from '@/features/feed/lib/feedRows';

import { PostCard, PostCardSkeleton } from './nostr/PostCard';
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
  getThreadContext,
  showLineAbove = false,
}: {
  repostEvent: FeedEvent;
  originalEvent: FeedEvent | undefined;
  originalMetrics: NoteMetrics;
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
  getThreadContext?: () => ThreadSeed | null;
  showLineAbove?: boolean;
}) {
  const [foreground, surface, surfaceTertiary] = useThemeColor([
    'foreground',
    'surface',
    'surface-tertiary',
  ] as const);
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

  const {
    gesture: tapGesture,
    suppress: suppressThreadTapStart,
    begin: beginThreadTap,
    probe: probeThreadTap,
  } = useCardTapGesture(navigateToThread);

  return (
    <GestureDetector gesture={tapGesture}>
      <View
        onStartShouldSetResponderCapture={beginThreadTap}
        onStartShouldSetResponder={probeThreadTap}>
        {/* Repost header */}
        <Pressable
          testID={`repost-header-${_repostEvent.id}`}
          accessibilityRole="button"
          accessibilityLabel={`${repostHeaderText}. Open ${primaryReposter.name}'s profile`}
          activeOpacity={0.7}
          onPressIn={suppressThreadTapStart}
          onPress={() =>
            router.push({
              pathname: '/(user-flow)/profile',
              params: { pubkey: primaryReposter.pubkey },
            })
          }>
          <HStack align="center" gap={spacing.xs} style={styles.repostHeader}>
            <Icon
              name="tabler:repeat"
              size={iconSize.sm}
              color={withAlpha(foreground, postInk.secondary)}
            />
            <Text
              family={POST_FONT_FAMILY}
              medium
              size={postType.meta.size}
              numberOfLines={1}
              style={[
                styles.repostHeaderText,
                { color: withAlpha(foreground, postInk.secondary) },
              ]}>
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
            getThreadContext={getThreadContext}
            showLineAbove={showLineAbove}
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
            <HStack align="center" gap={spacing.xs}>
              <Icon
                name="mdi:message-text"
                size={iconSize.sm}
                color={withAlpha(foreground, postInk.tertiary)}
              />
              <Text
                family={POST_FONT_FAMILY}
                size={postType.meta.size}
                italic
                style={{ color: withAlpha(foreground, postInk.tertiary) }}>
                Original post unavailable
              </Text>
            </HStack>
          </View>
        )}
      </View>
    </GestureDetector>
  );
});

// ============================================================================
// Empty State
// ============================================================================

type UserFeedListRow = FeedRow | { key: string; skeleton: true };

/** Stable first-paint rows; fixed keys keep FlashList identities across the swap. */
const SKELETON_ROWS: UserFeedListRow[] = Array.from({ length: 4 }, (_, i) => ({
  key: `skeleton-${i}`,
  skeleton: true as const,
}));
const getListRowKey = (row: UserFeedListRow) => row.key;
const getListRowItemType = (row: UserFeedListRow) =>
  'skeleton' in row ? 'skeleton' : getFeedRowItemType(row);

function EmptyFeed({ isOwnProfile }: { isOwnProfile?: boolean }) {
  const openComposer = useOpenComposer();
  const action = isOwnProfile ? (
    <Button
      testID="profile-feed-write-post"
      variant="secondary"
      size="sm"
      onPress={() => openComposer({ mode: 'new' })}>
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
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const hasMoreRef = useRef(true);
  const paginationCursorRef =
    useRef<import('../data/feedClient').FeedParseResult['paginationCursor']>(null);
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

  // Page 0 comes from the read lifecycle: the cached page for this author
  // paints synchronously on re-entry, a hand-over seed (the author's notes the
  // previous screen already had) paints as a partial on first open, and only a
  // true first load shows skeleton rows. Pagination stays with the refs below.
  const read = useCachedRead<FeedParseResult>({
    store: feedPageCache,
    surface: 'profileFeed',
    key: pubkey ? feedPageKey(`user:${pubkey}`, undefined) : null,
    viewerKey: '',
    seed: () => peekProfileFeedSeed(pubkey),
    classify: (page) =>
      readIsUnavailable(page.read) && page.orderedFeedItems.length === 0
        ? 'error'
        : page.orderedFeedItems.length === 0
          ? 'empty'
          : 'ready',
    fetcher: ({ signal, readId }) =>
      fetchUserFeedPage({ pubkey, authorName, authorPicture, signal, readId }).then((page) => ({
        data: page,
      })),
  });
  const isLoading = read.status === 'loading';

  // An author switch drops the previous author's rows before the new page
  // (cache, seed or network) applies below in the same commit.
  const appliedPageRef = useRef<FeedParseResult | null>(null);
  useEffect(() => {
    resetContent();
    appliedPageRef.current = null;
    deletedRepostIdsRef.current = null;
  }, [pubkey, resetContent]);

  useEffect(() => {
    const page = read.data;
    if (!page || appliedPageRef.current === page) return;
    appliedPageRef.current = page;
    isFirstRender.current = true;
    hasMoreRef.current = page.paginationUntil > 0 && page.orderedFeedItems.length > 0;
    paginationCursorRef.current = page.paginationCursor;
    paginationUntilRef.current = page.paginationUntil;
    paginationOffsetRef.current = page.paginationOffset;
    feedItemIdsRef.current = new Set(
      page.orderedFeedItems.map((item) =>
        item.type === 'note' ? item.event.id : item.repostEvent.id
      )
    );
    loadingMoreRef.current = false;
    activeLoadMoreIdRef.current = null;
    if (isOwnProfile && deletedRepostIdsRef.current === null) {
      deletedRepostIdsRef.current = useNostrSocialStore.getState().deletedRepostOriginalIds;
    }
    const displayItems =
      isOwnProfile && deletedRepostIdsRef.current
        ? page.orderedFeedItems.filter((item) => {
            if (item.type !== 'repost') return true;
            return !deletedRepostIdsRef.current![item.originalEventId];
          })
        : page.orderedFeedItems;
    applyPage(page, displayItems);
    // After initial render, mark first render done so subsequent items skip animation
    requestAnimationFrame(() => {
      isFirstRender.current = false;
    });
    // A hand-over seed is a partial page: the network page that supersedes it
    // brings its own enrichment; enriching the seed would be wasted work.
    if (read.source === 'seed') return;
    let cancelled = false;
    void enrichUserFeedPage(page, { isCancelled: () => cancelled, applyEnrichment });
    return () => {
      cancelled = true;
    };
  }, [read.data, read.source, isOwnProfile, applyPage, applyEnrichment]);

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
        paginationCursorRef,
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

  // Live `metricsMap` state, not `metricsRef`: the ref is written after commit,
  // so reading it here left every card on DEFAULT_METRICS (no counts) until an
  // unrelated re-render — the same bug HomeFeed fixed. Depending on the map
  // recomputes the rows the moment a page's stats land.
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
              showLineBelow
              getThreadContext={() => getThreadContextRef.current()}
            />
            <RepostCard
              {...repostCardProps(row, index, item)}
              onMorePress={() => openPostActions(originalEvent)}
              getThreadContext={() => getThreadContextRef.current()}
              showLineAbove
            />
          </View>
        );
      }
      return (
        <RepostCard
          {...repostCardProps(row, index, item)}
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
        {read.status === 'error' && feedItems.length === 0 ? (
          <EmptyState
            icon="mdi:cloud-off-outline"
            title="Posts unavailable"
            subtitle="Couldn't load this profile's posts right now."
            action={
              <PrimitiveButton
                text="Try again"
                variant="secondary"
                onPress={read.refresh}
                testID="profile-feed-retry"
              />
            }
          />
        ) : !isLoading && feedItems.length === 0 && read.status !== 'error' ? (
          <EmptyFeed isOwnProfile={isOwnProfile} />
        ) : null}
      </View>
    </View>
  );

  // First paint with nothing cached: skeleton rows as list items through the
  // shared PostCardSkeleton, never a spinner over an empty list.
  const listRows: UserFeedListRow[] = isLoading && feedRows.length === 0 ? SKELETON_ROWS : feedRows;
  const renderListRow = useCallback(
    ({ item, index }: { item: UserFeedListRow; index: number }) =>
      'skeleton' in item ? (
        <PostCardSkeleton variant="thread-reply" index={index} />
      ) : (
        renderFeedItem({ item, index })
      ),
    [renderFeedItem]
  );

  const feedList =
    listRows.length === 0 ? (
      // Empty or failed: header-only mode (the header carries the state).
      <List
        screen
        data={[] as UserFeedListRow[]}
        renderItem={() => null}
        ListHeaderComponent={feedHeader}
        style={styles.flexOne}
        showsVerticalScrollIndicator={false}
        onScroll={handleListScroll}
        scrollEventThrottle={16}
      />
    ) : (
      <List
        screen
        data={listRows}
        keyExtractor={getListRowKey}
        getItemType={getListRowItemType}
        drawDistance={500}
        renderItem={renderListRow}
        ListHeaderComponent={feedHeader}
        ListFooterComponent={
          isLoadingMore ? <Spinner size={18} style={{ paddingVertical: 24 }} /> : null
        }
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.4}
        style={styles.flexOne}
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

async function loadMoreUserItemsImpl(ctx: UserFeedLoadCtx): Promise<FeedItem[]> {
  const {
    pubkey,
    authorName,
    authorPicture,
    isOwnProfile,
    hasMoreRef,
    paginationUntilRef,
    paginationCursorRef,
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
      cursor: paginationCursorRef.current,
      until: paginationUntilRef.current,
      offset: paginationOffsetRef.current > 0 ? paginationOffsetRef.current : undefined,
    });

    paginationCursorRef.current = page.paginationCursor;
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
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginHorizontal: POST_PADDING_H,
    marginVertical: spacing.sm,
  },
  /** Sits on the content keyline; the glyph overhangs into the avatar gutter
   *  by the same nudge the action bar uses, so its outline lines up with the
   *  name below (Bluesky pulls its repost line left the same way). */
  repostHeader: {
    paddingHorizontal: POST_PADDING_H,
    paddingTop: POST_PADDING_TOP,
    marginLeft: POST_CONTENT_INDENT - 4,
  },
  repostHeaderText: {
    lineHeight: postType.meta.lineHeight,
    flexShrink: 1,
  },
});
