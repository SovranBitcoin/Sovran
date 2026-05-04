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
 * Uses Primal's cache relay API for bundled feed lookups.
 */

import React, { useMemo, useRef, useEffect, useCallback, useState, useTransition } from 'react';
import { StyleSheet, InteractionManager, ActivityIndicator } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useLatestRef } from '@/shared/hooks/useLatestRef';
import { log, Log } from '@/shared/lib/logger';
import { resolveIdentityName } from '@/shared/lib/identity';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';
import { LegendList, LegendListRef, type LegendListRenderItemProps } from '@legendapp/list';
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

import {
  type FeedEvent,
  type FeedItem,
  type NoteMetrics,
  type ProfileInfo,
  type RawPrimalEvent,
  DEFAULT_METRICS,
  PRIMAL_CACHE_RELAY_URL,
  MAX_VIDEO_FEED_PAGES,
  createPrimalRelayClient,
  buildVideoOverlayLayout,
  computeFeedIndicesWithVideo,
  enrichFeedPage,
  parseFeedPage,
  buildDedupedVideoPosts,
  type VideoPostRecord,
} from './nostr/shared';

import { PostCard } from './nostr/PostCard';
import {
  ImageOverlayProvider,
  useImageOverlay,
  AnimatedImageOverlay,
  type ImageOverlayReplaceLayout,
} from './nostr/image-overlay';
import { useNostrEngagement } from '@/features/feed/hooks/useNostrEngagement';
import { useNostrSocialStore } from '@/shared/stores/profile/nostrSocialStore';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

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
// UserFeed-only helpers
// ============================================================================

function isRootNote(event: FeedEvent): boolean {
  const eTags = (event.tags || []).filter((t) => t[0] === 'e');
  if (eTags.length === 0) return true;
  return eTags.every((t) => t[3] === 'mention');
}

function parseUserFeedPage(
  feedRawEvents: RawPrimalEvent[],
  pubkey: string,
  authorName?: string,
  authorPicture?: string
) {
  return parseFeedPage(feedRawEvents, {
    includeNote: (ev) => ev.pubkey === pubkey && isRootNote(ev),
    includeRepost: (ev) => ev.pubkey === pubkey,
    extraProfile: authorName
      ? { pubkey, profile: { name: authorName, picture: authorPicture } }
      : undefined,
  });
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
  feedIndex,
  onOverlayOpenedFromIndex,
  onVideoTap,
  liked = false,
  reposted = false,
  likePending = false,
  repostPending = false,
  likePendingDirection,
  repostPendingDirection,
  onLikePress,
  onRepostPress,
  skipAnimation,
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
  feedIndex?: number;
  onOverlayOpenedFromIndex?: (index: number) => void;
  onVideoTap?: (url: string) => void;
  liked?: boolean;
  reposted?: boolean;
  likePending?: boolean;
  repostPending?: boolean;
  likePendingDirection?: 'activating' | 'deactivating';
  repostPendingDirection?: 'activating' | 'deactivating';
  onLikePress?: () => void;
  onRepostPress?: () => void;
  skipAnimation?: boolean;
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

  const animStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ translateY: (1 - progress.get()) * 12 }],
  }));

  const threadEventId = originalEvent?.id || _repostEvent.id;

  const navigateToThread = useCallback(() => {
    router.navigate({
      pathname: '/(user-flow)/thread',
      params: { eventId: threadEventId },
    });
  }, [threadEventId]);

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
              params: { pubkey: reposterPubkey },
            })
          }>
          <HStack
            align="center"
            gap={6}
            style={{ paddingHorizontal: 16, paddingTop: 10, marginLeft: 36 + 12 }}>
            <Icon name="garden:arrow-retweet-fill-16" size={14} color={opacity(foreground, 0.33)} />
            <Text size={12} semibold style={{ color: opacity(foreground, 0.33) }}>
              {reposterName} reposted
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
            reposted={reposted}
            likePending={likePending}
            repostPending={repostPending}
            likePendingDirection={likePendingDirection}
            repostPendingDirection={repostPendingDirection}
            onLikePress={onLikePress}
            onRepostPress={onRepostPress}
            onNestedProfilePressIn={suppressThreadTapStart}
            onNestedProfilePressOut={suppressThreadTapEnd}
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
              <Icon name="mdi:message-text" size={14} color={opacity(foreground, 0.33)} />
              <Text size={13} italic style={{ color: opacity(foreground, 0.33) }}>
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
      <Text size={13} style={[styles.textAlignCenter, { color: opacity(foreground, 0.33) }]}>
        {"This user hasn't posted any notes."}
      </Text>
    </VStack>
  );
}

// ============================================================================
// Main UserFeed Component
// ============================================================================

function UserFeedInner({
  pubkey,
  authorName,
  authorPicture,
  isOwnProfile,
  ListHeaderComponent,
  onVideoPostsReady,
}: UserFeedProps) {
  const foreground = useThemeColor('foreground');
  const imageOverlay = useImageOverlay();
  const [, startTransition] = useTransition();
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [metricsMap, setMetricsMap] = useState<Map<string, NoteMetrics>>(new Map());
  const [quotedEventsMap, setQuotedEventsMap] = useState<Map<string, FeedEvent>>(new Map());
  const [profilesMap, setProfilesMap] = useState<Map<string, ProfileInfo>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const hasMoreRef = useRef(true);
  const paginationUntilRef = useRef(0);
  const paginationOffsetRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const feedItemIdsRef = useRef(new Set<string>());
  // Tracks the prefix of the most recent loadMoreItems request so its
  // enrichFeedPage onUpdate cannot write into a feed reset by a later author switch.
  const activeLoadMoreIdRef = useRef<string | null>(null);

  // Stable refs for renderItem — avoids re-creating renderItem on every Map update
  const metricsRef = useLatestRef(metricsMap);
  const quotedRef = useLatestRef(quotedEventsMap);
  const profilesRef = useLatestRef(profilesMap);
  const [dataVersion, setDataVersion] = useState(0);

  // Track whether initial load has completed — skip fade-in for items after first render
  const isFirstRender = useRef(true);

  // Snapshot of deleted-repost IDs taken at first feed load. Using a snapshot
  // rather than live state means unreposting while viewing won't yank items away
  // (protects against accidental taps). Primal's cache will catch up eventually.
  const deletedRepostIdsRef = useRef<Record<string, number> | null>(null);

  const feedListRef = useRef<LegendListRef>(null);
  const overlaySourceIndexRef = useRef(-1);

  useEffect(() => {
    if (!pubkey) {
      setFeedItems([]);
      setMetricsMap(new Map());
      setQuotedEventsMap(new Map());
      setProfilesMap(new Map());
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

    const loadFeedFromPrimal = async () => {
      const client = createPrimalRelayClient(PRIMAL_CACHE_RELAY_URL);

      try {
        const requestPrefix = Date.now().toString(36);
        const feedRawEvents = await client.request(`${requestPrefix}_feed`, {
          cache: ['feed', { pubkey, notes: 'authored', limit: 50 }],
        });
        if (cancelled) return;

        const phase1 = parseUserFeedPage(feedRawEvents, pubkey, authorName, authorPicture);

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

        setFeedItems(displayItems);
        setMetricsMap(phase1.metricsMap);
        setQuotedEventsMap(phase1.quotedEventsMap);
        setProfilesMap(phase1.profilesMap);
        setDataVersion((v) => v + 1);
        setIsLoading(false);
        // After initial render, mark first render done so subsequent items skip animation
        requestAnimationFrame(() => {
          isFirstRender.current = false;
        });

        if (!cancelled) {
          await enrichFeedPage(
            client,
            requestPrefix,
            phase1.missingQuotedIds,
            phase1.missingProfilePubkeys,
            phase1.quotedEventsMap,
            phase1.profilesMap,
            (updates) => {
              if (cancelled) return;
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
        }
      } catch (error) {
        log.error('feed.user.load_failed', { error });
        if (!cancelled) {
          setFeedItems([]);
          setMetricsMap(new Map());
          setQuotedEventsMap(new Map());
          setProfilesMap(new Map());
          setIsLoading(false);
        }
      } finally {
        client.close();
      }
    };

    const task = InteractionManager.runAfterInteractions(() => {
      loadFeedFromPrimal();
    });

    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [authorName, authorPicture, isOwnProfile, pubkey]);

  // ── Pagination: load older items ──

  const loadMoreItems = useCallback(async (): Promise<FeedItem[]> => {
    if (
      loadingMoreRef.current ||
      !hasMoreRef.current ||
      !pubkey ||
      paginationUntilRef.current === 0
    )
      return [];

    loadingMoreRef.current = true;
    setIsLoadingMore(true);
    const client = createPrimalRelayClient(PRIMAL_CACHE_RELAY_URL);
    const rp = Date.now().toString(36);
    activeLoadMoreIdRef.current = rp;

    try {
      const payload: Record<string, unknown> = {
        pubkey,
        notes: 'authored',
        limit: 30,
        until: paginationUntilRef.current,
      };
      if (paginationOffsetRef.current > 0) payload.offset = paginationOffsetRef.current;

      const rawEvents = await client.request(`${rp}_more`, { cache: ['feed', payload] });
      const page = parseUserFeedPage(rawEvents, pubkey, authorName, authorPicture);

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

      startTransition(() => {
        if (newItems.length > 0) setFeedItems((prev) => [...prev, ...newItems]);
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
          if (activeLoadMoreIdRef.current !== rp) return;
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
      return dedupedItems;
    } catch (error) {
      log.error('feed.user.load_more_failed', { error });
      return [];
    } finally {
      client.close();
      loadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [pubkey, authorName, authorPicture, isOwnProfile, startTransition]);

  const handleEndReached = useCallback(() => {
    loadMoreItems();
  }, [loadMoreItems]);

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

  const videoPosts = useMemo((): VideoPostRecord[] => {
    const sourceEvents: FeedEvent[] = [];
    for (const item of feedItems) {
      const event = item.type === 'note' ? item.event : item.originalEvent;
      if (event) sourceEvents.push(event);
    }
    return buildDedupedVideoPosts(sourceEvents);
  }, [feedItems]);

  useEffect(() => {
    onVideoPostsReady?.(videoPosts);
  }, [videoPosts, onVideoPostsReady]);

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

  // ---------------------------
  // Render
  // ---------------------------
  const displayName = resolveIdentityName({
    pubkey,
    overrideName: authorName,
  });
  const renderFeedItem = useCallback(
    ({ item, index }: LegendListRenderItemProps<FeedItem, string | undefined>) => {
      if (item.type === 'note') {
        const metrics = getDisplayMetrics(item.event.id);
        const engagement = getEngagementState(item.event.id);
        return (
          <PostCard
            variant="feed"
            event={item.event}
            metrics={metrics}
            index={index}
            feedIndex={index}
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
          />
        );
      }
      const engagement = getEngagementState(item.originalEventId);
      const originalEvent = item.originalEvent;
      return (
        <RepostCard
          repostEvent={item.repostEvent}
          originalEvent={item.originalEvent}
          originalMetrics={getDisplayMetrics(item.originalEventId)}
          index={index}
          feedIndex={index}
          onOverlayOpenedFromIndex={onOverlayOpenedFromIndex}
          quotedEvents={quotedRef.current}
          profiles={profilesRef.current}
          getMetrics={getMetrics}
          reposterName={displayName}
          reposterPubkey={pubkey}
          liked={engagement.liked}
          reposted={engagement.reposted}
          likePending={engagement.likePending}
          repostPending={engagement.repostPending}
          likePendingDirection={engagement.likePendingDirection}
          repostPendingDirection={engagement.repostPendingDirection}
          onLikePress={originalEvent ? () => toggleLike(originalEvent) : undefined}
          onRepostPress={originalEvent ? () => toggleRepost(originalEvent) : undefined}
          skipAnimation={!isFirstRender.current}
        />
      );
    },
    [
      getDisplayMetrics,
      getEngagementState,
      getMetrics,
      displayName,
      pubkey,
      toggleLike,
      toggleRepost,
      onOverlayOpenedFromIndex,
    ]
  );

  const feedHeader = (
    <View>
      {ListHeaderComponent}
      <View style={styles.feedContainer}>
        <Text medium size={13} style={[styles.sectionTitle, { color: opacity(foreground, 0.5) }]}>
          Notes
        </Text>
        {isLoading ? (
          <ActivityIndicator style={{ marginTop: 32 }} />
        ) : feedItems.length === 0 ? (
          <EmptyFeed />
        ) : null}
      </View>
    </View>
  );

  const feedList =
    isLoading || feedItems.length === 0 ? (
      // When loading or empty, render without LegendList (header-only mode)
      <LegendList
        data={[] as FeedItem[]}
        estimatedItemSize={200}
        renderItem={() => null}
        ListHeaderComponent={feedHeader}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        onScroll={
          imageOverlay?.scrollOffsetY != null
            ? (e: { nativeEvent: { contentOffset: { y: number } } }) => {
                imageOverlay.scrollOffsetY.value = e.nativeEvent.contentOffset.y;
              }
            : undefined
        }
        scrollEventThrottle={16}
      />
    ) : (
      <LegendList
        ref={feedListRef}
        data={feedItems}
        keyExtractor={feedKeyExtractor}
        getItemType={feedItemType}
        estimatedItemSize={300}
        drawDistance={500}
        maintainVisibleContentPosition
        renderItem={renderFeedItem}
        extraData={`${dataVersion}:${engagementRevision}`}
        recycleItems
        ListHeaderComponent={feedHeader}
        ListFooterComponent={
          isLoadingMore ? <ActivityIndicator style={{ paddingVertical: 24 }} /> : null
        }
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.4}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        onScroll={
          imageOverlay?.scrollOffsetY != null
            ? (e: { nativeEvent: { contentOffset: { y: number } } }) => {
                imageOverlay.scrollOffsetY.value = e.nativeEvent.contentOffset.y;
              }
            : undefined
        }
        scrollEventThrottle={16}
      />
    );

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

function UserFeedComponent(props: UserFeedProps) {
  return <UserFeedInner {...props} />;
}

export const UserFeed = React.memo(UserFeedComponent);

// ============================================================================
// Stable list references
// ============================================================================

const feedKeyExtractor = (item: FeedItem) =>
  item.type === 'note' ? item.event.id : item.repostEvent.id;
const feedItemType = (item: FeedItem) => item.type;

// ============================================================================
// Styles (UserFeed-specific only — shared styles live in nostr/shared.tsx)
// ============================================================================

const styles = StyleSheet.create({
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
