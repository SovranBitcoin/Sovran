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
import { StyleSheet, InteractionManager, TouchableOpacity, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from 'providers/ThemeProvider';
import { Text } from 'components/ui/Text';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import { Spacer } from 'components/ui/View/Spacer';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';
import { ShortTextNote, Repost, GenericRepost, Metadata } from 'nostr-tools/kinds';
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
  type NoteMetrics,
  type ProfileInfo,
  type RawPrimalEvent,
  type ContentSegment,
  type RelayMessage,
  DEFAULT_METRICS,
  EMPTY_QUOTED_EVENTS,
  PRIMAL_CACHE_RELAY_URL,
  PRIMAL_KIND_NOTE_STATS,
  PRIMAL_KIND_MENTIONS,
  PRIMAL_KIND_FEED_RANGE,
  createPrimalRelayClient,
  parseContent,
  collectReferencedIds,
  formatTimestamp,
  formatCount,
  normalizeFeedEvent,
  parseJson,
  getFirstTagValue,
  parseProfileFromRaw,
  parseNoteMetrics,
  tryNpubEncode,
  buildDedupedVideoPosts,
  getVideoUrlsFromContent,
  type VideoPostRecord,
} from './nostr/shared';

import { PostCard } from './nostr/PostCard';
import {
  ImageOverlayProvider,
  useImageOverlay,
  AnimatedImageOverlay,
  type ImageOverlayReplaceLayout,
} from './nostr/image-overlay';
import { useNostrEngagement } from '@/hooks/useNostrEngagement';
import { useNostrSocialStore } from '@/stores/nostrSocialStore';

// ============================================================================
// Re-exports for backward compatibility (ThreadView imports from './UserFeed')
// ============================================================================

export type { FeedEvent, NoteMetrics, ProfileInfo, RawPrimalEvent, ContentSegment, RelayMessage };
export {
  DEFAULT_METRICS,
  EMPTY_QUOTED_EVENTS,
  PRIMAL_CACHE_RELAY_URL,
  PRIMAL_KIND_NOTE_STATS,
  PRIMAL_KIND_MENTIONS,
  createPrimalRelayClient,
  parseContent,
  collectReferencedIds,
  formatTimestamp,
  formatCount,
  normalizeFeedEvent,
  parseJson,
  parseProfileFromRaw,
  tryNpubEncode,
};

// ============================================================================
// Types (UserFeed-specific)
// ============================================================================

interface UserFeedProps {
  pubkey: string;
  /** Author info passed from the profile screen so we don't re-fetch */
  authorName?: string;
  authorPicture?: string;
  /** When true, repost items that were locally unreposted are filtered out on load */
  isOwnProfile?: boolean;
  /** Optional header rendered above the feed inside the LegendList */
  ListHeaderComponent?: React.ReactElement | null;
  /** Called when video posts are computed from the feed (e.g. for profile story ring). */
  onVideoPostsReady?: (videoPosts: VideoPostRecord[]) => void;
}

/** Unified feed item — either an original note or a repost (Kind 6/16) */
type FeedItem =
  | { type: 'note'; event: FeedEvent; timestamp: number }
  | {
      type: 'repost';
      repostEvent: FeedEvent;
      originalEvent: FeedEvent | undefined;
      originalEventId: string;
      timestamp: number;
    };

// ============================================================================
// UserFeed-only helpers
// ============================================================================

function isRootNote(event: FeedEvent): boolean {
  const eTags = (event.tags || []).filter((t) => t[0] === 'e');
  if (eTags.length === 0) return true;
  return eTags.every((t) => t[3] === 'mention');
}

function getEmbeddedRepostEvent(
  repostEvent: FeedEvent,
  expectedEventId?: string
): FeedEvent | undefined {
  if (!repostEvent.content) return undefined;
  const parsed = normalizeFeedEvent(parseJson<unknown>(repostEvent.content));
  if (!parsed) return undefined;
  if (expectedEventId && parsed.id !== expectedEventId) return undefined;
  return parsed;
}

interface Phase1Result {
  orderedFeedItems: FeedItem[];
  metricsMap: Map<string, NoteMetrics>;
  profilesMap: Map<string, ProfileInfo>;
  quotedEventsMap: Map<string, FeedEvent>;
  missingQuotedIds: string[];
  missingProfilePubkeys: string[];
  paginationUntil: number;
  paginationOffset: number;
}

function parsePhase1(
  feedRawEvents: RawPrimalEvent[],
  pubkey: string,
  authorName?: string,
  authorPicture?: string
): Phase1Result {
  const eventMap = new Map<string, FeedEvent>();
  const userAuthoredPosts: FeedEvent[] = [];
  const embeddedMentionEvents = new Map<string, FeedEvent>();
  const metricsMap = new Map<string, NoteMetrics>();
  const profilesMap = new Map<string, ProfileInfo>();
  let feedOrder: string[] = [];
  let paginationUntil = 0;

  for (const raw of feedRawEvents) {
    if (raw.kind === PRIMAL_KIND_NOTE_STATS) {
      const parsed = parseJson<Record<string, unknown>>(raw.content);
      const eventId = typeof parsed?.event_id === 'string' ? parsed.event_id : undefined;
      if (!eventId || !parsed) continue;
      metricsMap.set(eventId, parseNoteMetrics(parsed));
      continue;
    }

    if (raw.kind === PRIMAL_KIND_FEED_RANGE) {
      const parsed = parseJson<Record<string, unknown>>(raw.content);
      if (Array.isArray(parsed?.elements)) {
        feedOrder = parsed.elements.filter((id): id is string => typeof id === 'string');
      }
      const rawUntil = parsed?.until;
      if (typeof rawUntil === 'number' && rawUntil > 0) {
        paginationUntil = rawUntil;
      } else if (typeof rawUntil === 'string') {
        const num = Number(rawUntil);
        if (num > 0) paginationUntil = num;
      }
      continue;
    }

    if (raw.kind === PRIMAL_KIND_MENTIONS) {
      const mentionEvent = normalizeFeedEvent(parseJson<unknown>(raw.content));
      if (!mentionEvent) continue;
      embeddedMentionEvents.set(mentionEvent.id, mentionEvent);
      eventMap.set(mentionEvent.id, mentionEvent);
      continue;
    }

    const ev = normalizeFeedEvent(raw);
    if (!ev) continue;

    if (ev.kind === ShortTextNote || ev.kind === Repost || ev.kind === GenericRepost) {
      eventMap.set(ev.id, ev);
      if (ev.pubkey === pubkey) userAuthoredPosts.push(ev);
      continue;
    }

    if (ev.kind === Metadata) {
      const result = parseProfileFromRaw(raw);
      if (result) profilesMap.set(result[0], result[1]);
      continue;
    }
  }

  if (authorName) {
    profilesMap.set(pubkey, { name: authorName, picture: authorPicture });
  }

  const rootNotes = userAuthoredPosts.filter((ev) => ev.kind === ShortTextNote && isRootNote(ev));
  const userRepostEvents = userAuthoredPosts.filter(
    (ev) => ev.kind === Repost || ev.kind === GenericRepost
  );

  const nextFeedItems: FeedItem[] = [];
  const feedItemsByEventId = new Map<string, FeedItem>();

  for (const note of rootNotes) {
    const item: FeedItem = { type: 'note', event: note, timestamp: note.created_at || 0 };
    nextFeedItems.push(item);
    feedItemsByEventId.set(note.id, item);
  }

  for (const repostEvent of userRepostEvents) {
    const originalEventId = getFirstTagValue(repostEvent, 'e');
    if (!originalEventId) continue;
    let originalEvent = eventMap.get(originalEventId);
    if (!originalEvent) {
      originalEvent = getEmbeddedRepostEvent(repostEvent, originalEventId);
      if (originalEvent) eventMap.set(originalEvent.id, originalEvent);
    }

    const item: FeedItem = {
      type: 'repost',
      repostEvent,
      originalEvent,
      originalEventId,
      timestamp: repostEvent.created_at || 0,
    };
    nextFeedItems.push(item);
    feedItemsByEventId.set(repostEvent.id, item);
  }

  const orderedFeedItems =
    feedOrder.length > 0
      ? [
          ...feedOrder
            .map((id) => feedItemsByEventId.get(id))
            .filter((item): item is FeedItem => item !== undefined),
          ...nextFeedItems.filter(
            (item) =>
              !feedOrder.includes(item.type === 'note' ? item.event.id : item.repostEvent.id)
          ),
        ]
      : nextFeedItems;

  if (feedOrder.length === 0) {
    orderedFeedItems.sort((a, b) => b.timestamp - a.timestamp);
  }

  const repostedOriginalEvents = orderedFeedItems
    .filter((item): item is Extract<FeedItem, { type: 'repost' }> => item.type === 'repost')
    .map((item) => item.originalEvent)
    .filter((ev): ev is FeedEvent => ev !== undefined);

  const contentSources = [...rootNotes, ...repostedOriginalEvents];
  const { eventIds: referencedEventIds, pubkeys: inlineMentionPubkeys } =
    collectReferencedIds(contentSources);

  const quotedEventsMap = new Map<string, FeedEvent>(embeddedMentionEvents);
  const missingQuotedIds = referencedEventIds.filter((id) => !quotedEventsMap.has(id));

  const neededPubkeys = new Set(inlineMentionPubkeys);
  for (const ev of embeddedMentionEvents.values()) neededPubkeys.add(ev.pubkey);
  for (const ev of repostedOriginalEvents) neededPubkeys.add(ev.pubkey);
  const missingProfilePubkeys = Array.from(neededPubkeys).filter((pk) => !profilesMap.has(pk));

  for (const item of orderedFeedItems) {
    const metricId = item.type === 'note' ? item.event.id : item.originalEventId;
    if (!metricsMap.has(metricId)) metricsMap.set(metricId, { ...DEFAULT_METRICS });
  }

  // Fallback cursor: use oldest item timestamp when FeedRange didn't provide `until`
  if (paginationUntil === 0 && orderedFeedItems.length > 0) {
    for (const item of orderedFeedItems) {
      if (paginationUntil === 0 || item.timestamp < paginationUntil) {
        paginationUntil = item.timestamp;
      }
    }
  }

  return {
    orderedFeedItems,
    metricsMap,
    profilesMap,
    quotedEventsMap,
    missingQuotedIds,
    missingProfilePubkeys,
    paginationUntil,
    paginationOffset: feedOrder.length || orderedFeedItems.length,
  };
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
  const { getPrimaryColor } = useTheme();
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
      pathname: '/(user-flow)/thread' as any,
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
        <TouchableOpacity
          activeOpacity={0.7}
          onPressIn={suppressThreadTapStart}
          onPressOut={suppressThreadTapEnd}
          onPress={() =>
            router.navigate({
              pathname: '/(user-flow)/profile' as any,
              params: { pubkey: reposterPubkey },
            })
          }>
          <HStack
            align="center"
            gap={6}
            style={{ paddingHorizontal: 16, paddingTop: 10, marginLeft: 36 + 12 }}>
            <Icon
              name="garden:arrow-retweet-fill-16"
              size={14}
              color={opacity(getPrimaryColor('0'), 0.33)}
            />
            <Text size={12} semibold style={{ color: opacity(getPrimaryColor('0'), 0.33) }}>
              {reposterName} reposted
            </Text>
          </HStack>
        </TouchableOpacity>

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
                backgroundColor: getPrimaryColor('900'),
                borderColor: getPrimaryColor('700'),
              },
            ]}>
            <HStack align="center" gap={6}>
              <Icon name="mdi:message-text" size={14} color={opacity(getPrimaryColor('0'), 0.33)} />
              <Text size={13} italic style={{ color: opacity(getPrimaryColor('0'), 0.33) }}>
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
  const { getPrimaryColor } = useTheme();

  return (
    <VStack align="center" style={styles.emptyState}>
      <Icon name="mdi:message-text" size={40} color={getPrimaryColor('600')} />
      <Spacer size={8} />
      <Text bold size={16} style={{ color: opacity(getPrimaryColor('0'), 0.5) }}>
        No posts yet
      </Text>
      <Spacer size={4} />
      <Text
        size={13}
        style={[styles.textAlignCenter, { color: opacity(getPrimaryColor('0'), 0.33) }]}>
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
  const { getPrimaryColor } = useTheme();
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

  // Stable refs for renderItem — avoids re-creating renderItem on every Map update
  const metricsRef = useRef(metricsMap);
  metricsRef.current = metricsMap;
  const quotedRef = useRef(quotedEventsMap);
  quotedRef.current = quotedEventsMap;
  const profilesRef = useRef(profilesMap);
  profilesRef.current = profilesMap;
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
    deletedRepostIdsRef.current = null;

    const loadFeedFromPrimal = async () => {
      const client = createPrimalRelayClient(PRIMAL_CACHE_RELAY_URL);

      try {
        const requestPrefix = Date.now().toString(36);
        const feedRawEvents = await client.request(`${requestPrefix}_feed`, {
          cache: ['feed', { pubkey, notes: 'authored', limit: 50 }],
        });
        if (cancelled) return;

        const phase1 = parsePhase1(feedRawEvents, pubkey, authorName, authorPicture);

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

        const phase2Promise = (async () => {
          if (phase1.missingQuotedIds.length === 0) return;

          const referencedRawEvents = await client.request(`${requestPrefix}_quoted`, {
            cache: ['events', { event_ids: phase1.missingQuotedIds }],
          });
          if (cancelled) return;

          const nextQuoted = new Map(phase1.quotedEventsMap);
          const extraProfiles = new Map<string, ProfileInfo>();
          const extraMetrics = new Map<string, NoteMetrics>();

          for (const raw of referencedRawEvents) {
            if (raw.kind === PRIMAL_KIND_NOTE_STATS) {
              const parsed = parseJson<Record<string, unknown>>(raw.content);
              const eventId = typeof parsed?.event_id === 'string' ? parsed.event_id : undefined;
              if (!eventId || !parsed) continue;
              extraMetrics.set(eventId, parseNoteMetrics(parsed));
              continue;
            }

            if (raw.kind === Metadata) {
              const result = parseProfileFromRaw(raw);
              if (result) extraProfiles.set(result[0], result[1]);
              continue;
            }

            const ev = normalizeFeedEvent(raw);
            if (!ev) continue;
            nextQuoted.set(ev.id, ev);
          }

          if (cancelled) return;
          startTransition(() => {
            setQuotedEventsMap(nextQuoted);

            if (extraMetrics.size > 0) {
              setMetricsMap((prev) => {
                const next = new Map(prev);
                for (const [k, v] of extraMetrics) next.set(k, v);
                return next;
              });
            }

            if (extraProfiles.size > 0) {
              setProfilesMap((prev) => {
                const next = new Map(prev);
                for (const [k, v] of extraProfiles) next.set(k, v);
                return next;
              });
            }

            setDataVersion((v) => v + 1);
          });
        })();

        const phase3Promise = (async () => {
          if (phase1.missingProfilePubkeys.length === 0) return;

          const profileRawEvents = await client.request(`${requestPrefix}_profiles`, {
            cache: ['user_infos', { pubkeys: phase1.missingProfilePubkeys }],
          });
          if (cancelled) return;

          const extraProfiles = new Map<string, ProfileInfo>();
          for (const raw of profileRawEvents) {
            if (raw.kind !== Metadata) continue;
            const result = parseProfileFromRaw(raw);
            if (result) extraProfiles.set(result[0], result[1]);
          }

          if (cancelled || extraProfiles.size === 0) return;
          startTransition(() => {
            setProfilesMap((prev) => {
              const next = new Map(prev);
              for (const [k, v] of extraProfiles) next.set(k, v);
              return next;
            });
            setDataVersion((v) => v + 1);
          });
        })();

        await Promise.all([phase2Promise, phase3Promise]);
      } catch (error) {
        console.error('UserFeed: Failed to load Primal cached feed', error);
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

    try {
      const payload: Record<string, unknown> = {
        pubkey,
        notes: 'authored',
        limit: 30,
        until: paginationUntilRef.current,
      };
      if (paginationOffsetRef.current > 0) payload.offset = paginationOffsetRef.current;

      const rawEvents = await client.request(`${rp}_more`, { cache: ['feed', payload] });
      const page = parsePhase1(rawEvents, pubkey, authorName, authorPicture);

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

      // Enrichment for new page (quoted events + profiles)
      const missingQ = page.missingQuotedIds.filter((id) => !quotedRef.current.has(id));
      const missingP = page.missingProfilePubkeys.filter((pk) => !profilesRef.current.has(pk));
      const enrichTasks: Promise<void>[] = [];

      if (missingQ.length > 0) {
        enrichTasks.push(
          client
            .request(`${rp}_eq`, { cache: ['events', { event_ids: missingQ }] })
            .then((evts) => {
              const xQ = new Map<string, FeedEvent>();
              const xM = new Map<string, NoteMetrics>();
              const xP = new Map<string, ProfileInfo>();
              for (const raw of evts) {
                if (raw.kind === PRIMAL_KIND_NOTE_STATS) {
                  const p = parseJson<Record<string, unknown>>(raw.content);
                  const eid = typeof p?.event_id === 'string' ? p.event_id : undefined;
                  if (!eid || !p) continue;
                  xM.set(eid, parseNoteMetrics(p));
                  continue;
                }
                if (raw.kind === Metadata) {
                  const r = parseProfileFromRaw(raw);
                  if (r) xP.set(r[0], r[1]);
                  continue;
                }
                const ev = normalizeFeedEvent(raw);
                if (ev) xQ.set(ev.id, ev);
              }
              startTransition(() => {
                if (xQ.size > 0)
                  setQuotedEventsMap((prev) => {
                    const n = new Map(prev);
                    for (const [k, v] of xQ) n.set(k, v);
                    return n;
                  });
                if (xM.size > 0)
                  setMetricsMap((prev) => {
                    const n = new Map(prev);
                    for (const [k, v] of xM) n.set(k, v);
                    return n;
                  });
                if (xP.size > 0)
                  setProfilesMap((prev) => {
                    const n = new Map(prev);
                    for (const [k, v] of xP) n.set(k, v);
                    return n;
                  });
                setDataVersion((v) => v + 1);
              });
            })
        );
      }

      if (missingP.length > 0) {
        enrichTasks.push(
          client
            .request(`${rp}_ep`, { cache: ['user_infos', { pubkeys: missingP }] })
            .then((evts) => {
              const xP = new Map<string, ProfileInfo>();
              for (const raw of evts) {
                if (raw.kind !== Metadata) continue;
                const r = parseProfileFromRaw(raw);
                if (r) xP.set(r[0], r[1]);
              }
              if (xP.size > 0) {
                startTransition(() => {
                  setProfilesMap((prev) => {
                    const n = new Map(prev);
                    for (const [k, v] of xP) n.set(k, v);
                    return n;
                  });
                  setDataVersion((v) => v + 1);
                });
              }
            })
        );
      }

      await Promise.all(enrichTasks);
      return dedupedItems;
    } catch (error) {
      console.error('UserFeed: loadMore failed', error);
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

  const feedIndicesWithVideo = useMemo(() => {
    const out: number[] = [];
    feedItems.forEach((item, i) => {
      const ev = item.type === 'note' ? item.event : item.originalEvent;
      if (ev && getVideoUrlsFromContent(ev.content).length > 0) out.push(i);
    });
    return out;
  }, [feedItems]);

  const onOverlayOpenedFromIndex = useCallback((index: number) => {
    overlaySourceIndexRef.current = index;
  }, []);

  const MAX_VIDEO_FEED_PAGES = 20;

  const buildLayoutForVideoIndex = useCallback(
    (feedIndex: number): ImageOverlayReplaceLayout | null => {
      const item = feedItems[feedIndex];
      const event = item?.type === 'note' ? item.event : item?.originalEvent;
      if (!event) return null;
      const segments = parseContent(event.content);
      const blockSegments = segments.filter(
        (s): s is ContentSegment & { kind: 'image' | 'video'; url: string } =>
          s.kind === 'image' || s.kind === 'video'
      );
      if (blockSegments.length === 0) return null;
      const urls = blockSegments.map((s) => s.url);
      const mediaTypes = blockSegments.map((s) =>
        s.kind === 'video' ? ('video' as const) : ('image' as const)
      );
      const firstVideoIndex = mediaTypes.indexOf('video');
      if (firstVideoIndex === -1) return null;
      const metrics = getDisplayMetrics(event.id) || DEFAULT_METRICS;
      const engagement = getEngagementState(event.id);
      const profile = profilesRef.current.get(event.pubkey) ?? null;
      return {
        url: urls[firstVideoIndex],
        urls,
        mediaTypes,
        initialIndex: firstVideoIndex,
        aspectRatio: 16 / 9,
        post: {
          event: {
            id: event.id,
            pubkey: event.pubkey,
            content: event.content,
            created_at: event.created_at,
          },
          metrics: {
            replyCount: metrics.replyCount,
            repostCount: metrics.repostCount,
            likeCount: metrics.likeCount,
            satsZapped: metrics.satsZapped,
          },
          profile: profile ?? undefined,
          reposted: engagement.reposted,
          liked: engagement.liked,
          repostPending: engagement.repostPending,
          likePending: engagement.likePending,
          repostPendingDirection: engagement.repostPendingDirection,
          likePendingDirection: engagement.likePendingDirection,
          onCommentPress: () =>
            router.navigate({
              pathname: '/(user-flow)/thread' as any,
              params: { eventId: event.id },
            }),
          onRepostPress: () => toggleRepost(event),
          onLikePress: () => toggleLike(event),
        },
      };
    },
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
  const displayName = authorName || tryNpubEncode(pubkey).slice(0, 12) + '…';
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
        <Text
          medium
          overpass
          size={13}
          style={[styles.sectionTitle, { color: opacity(getPrimaryColor('0'), 0.5) }]}>
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
      const item = feedItems[nextVideoIndex];
      const event = item.type === 'note' ? item.event : item.originalEvent;
      if (!event) return;
      const segments = parseContent(event.content);
      const blockSegments = segments.filter(
        (s): s is ContentSegment & { kind: 'image' | 'video'; url: string } =>
          s.kind === 'image' || s.kind === 'video'
      );
      const media = blockSegments;
      if (media.length === 0) return;
      const urls = media.map((s) => s.url);
      const mediaTypes = media.map((s) =>
        s.kind === 'video' ? ('video' as const) : ('image' as const)
      );
      const firstVideoIndex = mediaTypes.indexOf('video');
      if (firstVideoIndex === -1) return;
      const metrics = getDisplayMetrics(event.id) || DEFAULT_METRICS;
      const engagement = getEngagementState(event.id);
      const profile = profilesRef.current.get(event.pubkey) ?? null;
      const layout: ImageOverlayReplaceLayout = {
        url: urls[firstVideoIndex],
        urls,
        mediaTypes,
        initialIndex: firstVideoIndex,
        aspectRatio: 16 / 9,
        post: {
          event: {
            id: event.id,
            pubkey: event.pubkey,
            content: event.content,
            created_at: event.created_at,
          },
          metrics: {
            replyCount: metrics.replyCount,
            repostCount: metrics.repostCount,
            likeCount: metrics.likeCount,
            satsZapped: metrics.satsZapped,
          },
          profile: profile ?? undefined,
          reposted: engagement.reposted,
          liked: engagement.liked,
          repostPending: engagement.repostPending,
          likePending: engagement.likePending,
          repostPendingDirection: engagement.repostPendingDirection,
          likePendingDirection: engagement.likePendingDirection,
          onCommentPress: () =>
            router.navigate({
              pathname: '/(user-flow)/thread' as any,
              params: { eventId: event.id },
            }),
          onRepostPress: () => toggleRepost(event),
          onLikePress: () => toggleLike(event),
        },
      };
      overlaySourceIndexRef.current = nextVideoIndex;
      openNext(layout);
    },
    [
      feedIndicesWithVideo,
      feedItems,
      getDisplayMetrics,
      getEngagementState,
      toggleLike,
      toggleRepost,
    ]
  );

  return (
    <ImageOverlayProvider
      getDisplayMetrics={getDisplayMetrics}
      getEngagementState={getEngagementState}
      onSwipeUpToNextPost={onSwipeUpToNextPost}
      getVideoFeedLayoutsAndIndex={getVideoFeedLayoutsAndIndex}>
      {feedList}
      <AnimatedImageOverlay />
    </ImageOverlayProvider>
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
