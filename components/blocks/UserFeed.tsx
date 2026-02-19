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

import React, {
  useMemo,
  useRef,
  useEffect,
  useCallback,
  useState,
  useTransition,
  memo,
} from 'react';
import {
  StyleSheet,
  InteractionManager,
  TouchableOpacity,
  Linking,
  Platform,
  AppState,
  AppStateStatus,
  useWindowDimensions,
  ActivityIndicator,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { router } from 'expo-router';
import { useTheme } from 'providers/ThemeProvider';
import { Text } from 'components/ui/Text';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import { Spacer } from 'components/ui/View/Spacer';
import { Avatar } from 'components/ui/Avatar';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';
import { ShortTextNote, Repost, GenericRepost, Metadata } from 'nostr-tools/kinds';
import { LegendList, LegendListRef, type LegendListRenderItemProps } from '@legendapp/list';
import { FullWindowOverlay } from 'react-native-screens';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withTiming,
  withRepeat,
  withSpring,
  interpolate,
  Extrapolation,
  cancelAnimation,
  runOnJS,
  Easing,
  type SharedValue,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
  getVideoUrlsFromContent,
} from './nostr/shared';

import { PostCard } from './nostr/PostCard';
import { useNostrEngagement, type EngagementViewState } from '@/hooks/useNostrEngagement';
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

/** One entry shown in the full-screen video feed overlay */
export interface VideoPost {
  eventId: string;
  videoUrl: string;
  content: string;
  pubkey: string;
  created_at: number;
}

/** Sentinel appended to the video feed for infinite scroll loading */
interface VideoLoadingSlot {
  slotType: 'loading';
}

type VideoFeedSlot = VideoPost | VideoLoadingSlot;

const LOADING_SLOT: VideoLoadingSlot = { slotType: 'loading' };

function isLoadingSlot(item: VideoFeedSlot): item is VideoLoadingSlot {
  return 'slotType' in item && item.slotType === 'loading';
}

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
  onVideoTap,
  liked = false,
  reposted = false,
  likePending = false,
  repostPending = false,
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
  onVideoTap?: (url: string) => void;
  liked?: boolean;
  reposted?: boolean;
  likePending?: boolean;
  repostPending?: boolean;
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
    router.push({
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
            router.push({
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
            onVideoTap={onVideoTap}
            liked={liked}
            reposted={reposted}
            likePending={likePending}
            repostPending={repostPending}
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
// Video Feed Overlay — TikTok-style full-screen paging video feed
// ============================================================================

const VIDEO_URL_STRIP_REGEX = /https?:\/\/\S+\.(mp4|webm|mov|m4v|avi)(\?\S*)?/gi;

function formatVideoCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

// ── Custom timeline scrubber ────────────────────────────────────────────────
// Uses Reanimated shared values for 60fps-smooth progress updates and a Pan
// gesture so users can scrub through the video by dragging on the bar.

const SCRUBBER_HEIGHT = 3;
const SCRUBBER_HIT_SLOP = 14; // extra touch area above/below the thin bar
const SCRUBBER_ACTIVE_HEIGHT = 5;

/** Format seconds → "M:SS" */
function formatDuration(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface TimelineScrubberProps {
  progress: SharedValue<number>; // 0..1
  duration: number;
  currentTime: number;
  onSeek: (fraction: number) => void;
  barWidth: number;
}

const TimelineScrubber = memo(function TimelineScrubber({
  progress,
  duration,
  currentTime,
  onSeek,
  barWidth,
}: TimelineScrubberProps) {
  const isScrubbing = useSharedValue(false);
  const scrubX = useSharedValue(0);

  const filledStyle = useAnimatedStyle(() => {
    const fraction = isScrubbing.get() ? scrubX.get() / barWidth : progress.get();
    const clampedFraction = Math.max(0, Math.min(1, fraction));
    return {
      width: clampedFraction * barWidth,
    };
  });

  const trackStyle = useAnimatedStyle(() => ({
    height: isScrubbing.get() ? SCRUBBER_ACTIVE_HEIGHT : SCRUBBER_HEIGHT,
  }));

  const scrubGesture = Gesture.Pan()
    .hitSlop({ top: SCRUBBER_HIT_SLOP, bottom: SCRUBBER_HIT_SLOP })
    .onStart((e) => {
      'worklet';
      isScrubbing.set(true);
      scrubX.set(Math.max(0, Math.min(barWidth, e.x)));
    })
    .onUpdate((e) => {
      'worklet';
      scrubX.set(Math.max(0, Math.min(barWidth, e.x)));
    })
    .onEnd(() => {
      'worklet';
      const fraction = Math.max(0, Math.min(1, scrubX.get() / barWidth));
      isScrubbing.set(false);
      runOnJS(onSeek)(fraction);
    })
    .onFinalize(() => {
      'worklet';
      isScrubbing.set(false);
    });

  // Tap gesture — tap anywhere on the bar to jump
  const tapGesture = Gesture.Tap().onEnd((e) => {
    'worklet';
    const fraction = Math.max(0, Math.min(1, e.x / barWidth));
    runOnJS(onSeek)(fraction);
  });

  const composed = Gesture.Race(scrubGesture, tapGesture);

  const remaining = duration > 0 ? duration - currentTime : 0;

  return (
    <View>
      {/* Scrubber track */}
      <GestureDetector gesture={composed}>
        <View style={{ height: SCRUBBER_HIT_SLOP * 2, justifyContent: 'center' }}>
          <Reanimated.View
            style={[
              {
                width: barWidth,
                borderRadius: 2,
                backgroundColor: 'rgba(255,255,255,0.2)',
                overflow: 'hidden',
              },
              trackStyle,
            ]}>
            <Reanimated.View
              style={[
                {
                  height: '100%',
                  backgroundColor: '#fff',
                  borderRadius: 2,
                },
                filledStyle,
              ]}
            />
          </Reanimated.View>
        </View>
      </GestureDetector>

      {/* Time labels */}
      <View style={vCtrl.timeRow}>
        <Text size={11} style={vCtrl.timeText}>
          {formatDuration(currentTime)}
        </Text>
        <Text size={11} style={vCtrl.timeText}>
          -{formatDuration(remaining)}
        </Text>
      </View>
    </View>
  );
});

// ── VideoFeedItem ───────────────────────────────────────────────────────────

interface VideoFeedItemProps {
  item: VideoPost;
  index: number;
  activeIndex: number;
  isAppActive: boolean;
  profile: ProfileInfo | undefined;
  metrics: NoteMetrics;
  engagement: EngagementViewState;
  onLikePress?: () => void;
  onRepostPress?: () => void;
  screenHeight: number;
  screenWidth: number;
}

const VideoFeedItem = memo(function VideoFeedItem({
  item,
  index,
  activeIndex,
  isAppActive,
  profile,
  metrics,
  engagement,
  onLikePress,
  onRepostPress,
  screenHeight,
  screenWidth,
}: VideoFeedItemProps) {
  const insets = useSafeAreaInsets();
  const isActive = index === activeIndex;

  const [isPaused, setIsPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Reanimated shared value for smooth progress bar (updated on UI-thread-friendly interval)
  const progress = useSharedValue(0);

  const player = useVideoPlayer(item.videoUrl, (p) => {
    p.loop = true;
    p.muted = true;
  });

  // Auto-play lifecycle
  const wasActive = useRef(false);

  useEffect(() => {
    const shouldPlay = isActive && !isPaused && isAppActive;

    try {
      if (shouldPlay) {
        player.muted = isMuted;
        const id = setTimeout(
          () => {
            try {
              player.play();
            } catch {
              // ignore
            }
          },
          wasActive.current ? 0 : 80
        );
        wasActive.current = true;
        return () => clearTimeout(id);
      } else {
        player.pause();
        if (!isActive) {
          player.muted = true;
          wasActive.current = false;
        }
      }
    } catch {
      // ignore
    }
  }, [isActive, isPaused, isAppActive, isMuted, player]);

  // Poll playback progress at ~15fps for the scrubber.
  // Only runs while the item is the active one.
  useEffect(() => {
    if (!isActive) return;

    const poll = setInterval(() => {
      try {
        const ct = player.currentTime ?? 0;
        const dur = player.duration ?? 0;
        setCurrentTime(ct);
        setDuration(dur);
        if (dur > 0) {
          progress.set(ct / dur);
        }
      } catch {
        // player not ready
      }
    }, 66); // ~15fps — smooth enough for a thin bar, cheap on JS thread

    return () => clearInterval(poll);
  }, [isActive, player, progress]);

  // ── Handlers ──

  const handlePlayPause = useCallback(() => {
    if (!isActive) return;
    setIsPaused((prev) => {
      const next = !prev;
      try {
        if (next) player.pause();
        else player.play();
      } catch {
        // ignore
      }
      return next;
    });
  }, [isActive, player]);

  const handleMuteToggle = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      try {
        player.muted = next;
      } catch {
        // ignore
      }
      return next;
    });
  }, [player]);

  const handleSeek = useCallback(
    (fraction: number) => {
      try {
        const dur = player.duration ?? 0;
        if (dur > 0) {
          player.currentTime = fraction * dur;
          setCurrentTime(fraction * dur);
          progress.set(fraction);
        }
      } catch {
        // ignore
      }
    },
    [player, progress]
  );

  const handleFullscreen = useCallback(() => {
    // Could trigger a native fullscreen mode — for now this is a placeholder
    // that users can hook into.
  }, []);

  const handlePopOut = useCallback(() => {
    try {
      Linking.openURL(item.videoUrl).catch(() => {});
    } catch {
      // ignore
    }
  }, [item.videoUrl]);

  // Tap on video area = toggle play/pause
  const handleVideoTap = useCallback(() => {
    handlePlayPause();
  }, [handlePlayPause]);

  // ── Derived display values ──

  const displayName = profile?.name ?? `${item.pubkey.slice(0, 8)}…`;
  const npubShort = tryNpubEncode(item.pubkey);
  const displayHandle = npubShort ? `@${npubShort.slice(5, 15)}…` : '';
  const displayContent = item.content.replace(VIDEO_URL_STRIP_REGEX, '').trim();

  const infoPanelPaddingBottom = insets.bottom + 8;
  const barWidth = screenWidth - 32; // 16px padding each side

  return (
    <View style={{ width: screenWidth, height: screenHeight, backgroundColor: '#000' }}>
      {/* Video area — fills all space above the info panel, no native controls */}
      <TouchableOpacity
        activeOpacity={1}
        onPress={handleVideoTap}
        style={{ flex: 1, backgroundColor: '#000' }}>
        <VideoView
          player={player}
          style={{ flex: 1 }}
          contentFit="contain"
          nativeControls={false}
        />

        {/* Paused overlay indicator */}
        {isPaused && isActive && (
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 32,
                backgroundColor: 'rgba(0,0,0,0.5)',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <Icon name="mdi:pause" size={36} color="rgba(255,255,255,0.9)" />
            </View>
          </View>
        )}
      </TouchableOpacity>

      {/* ── Info panel ── */}
      <View
        style={{
          backgroundColor: '#111',
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: infoPanelPaddingBottom,
        }}>
        {/* Profile row */}
        <HStack align="center" gap={10} style={{ marginBottom: 8 }}>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() =>
              router.push({
                pathname: '/(user-flow)/profile' as any,
                params: { pubkey: item.pubkey },
              })
            }>
            <Avatar
              picture={profile?.picture}
              seed={item.pubkey}
              size={40}
              variant="person"
              name={displayName}
            />
          </TouchableOpacity>
          <VStack style={{ flex: 1 }}>
            <Text bold size={15} style={{ color: '#fff' }}>
              {displayName}
            </Text>
            {displayHandle.length > 0 && (
              <Text size={12} style={{ color: 'rgba(255,255,255,0.45)' }}>
                {displayHandle}
              </Text>
            )}
          </VStack>
        </HStack>

        {/* Post content */}
        {displayContent.length > 0 && (
          <Text
            size={13}
            style={{ color: 'rgba(255,255,255,0.7)', lineHeight: 19, marginBottom: 10 }}
            numberOfLines={1}>
            {displayContent}
          </Text>
        )}

        {/* Engagement metrics — pill-shaped buttons */}
        <HStack gap={8} style={{ marginBottom: 12, flexWrap: 'wrap' }}>
          <View style={vCtrl.metricPill}>
            <Icon name="iconamoon:comment-fill" size={15} color="rgba(255,255,255,0.7)" />
            <Text size={12} style={vCtrl.metricText}>
              {metrics.replyCount > 0 ? formatVideoCount(metrics.replyCount) : '0'}
            </Text>
          </View>
          <TouchableOpacity
            activeOpacity={onRepostPress ? 0.7 : 1}
            onPress={onRepostPress}
            disabled={!onRepostPress || engagement.repostPending}
            style={[
              vCtrl.metricPill,
              engagement.reposted ? { backgroundColor: 'rgba(76,217,100,0.25)' } : undefined,
            ]}>
            <Icon
              name="garden:arrow-retweet-fill-16"
              size={15}
              color={engagement.reposted ? '#4cd964' : 'rgba(255,255,255,0.7)'}
            />
            <Text
              size={12}
              style={[vCtrl.metricText, engagement.reposted ? { color: '#4cd964' } : undefined]}>
              {metrics.repostCount > 0 ? formatVideoCount(metrics.repostCount) : '0'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={onLikePress ? 0.7 : 1}
            onPress={onLikePress}
            disabled={!onLikePress || engagement.likePending}
            style={[
              vCtrl.metricPill,
              engagement.liked ? { backgroundColor: 'rgba(255,90,122,0.25)' } : undefined,
            ]}>
            <Icon
              name="iconamoon:heart-fill"
              size={15}
              color={engagement.liked ? '#ff5a7a' : 'rgba(255,255,255,0.7)'}
            />
            <Text
              size={12}
              style={[vCtrl.metricText, engagement.liked ? { color: '#ff5a7a' } : undefined]}>
              {metrics.likeCount > 0 ? formatVideoCount(metrics.likeCount) : '0'}
            </Text>
          </TouchableOpacity>
        </HStack>

        {/* Timeline scrubber */}
        <TimelineScrubber
          progress={progress}
          duration={duration}
          currentTime={currentTime}
          onSeek={handleSeek}
          barWidth={barWidth}
        />

        {/* Transport controls row */}
        <HStack align="center" style={{ marginTop: 4 }}>
          {/* Play / Pause */}
          <TouchableOpacity
            onPress={handlePlayPause}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={vCtrl.controlBtn}>
            <Icon
              name={isPaused ? 'mdi:play' : 'mdi:pause'}
              size={24}
              color="rgba(255,255,255,0.85)"
            />
          </TouchableOpacity>

          <View style={{ flex: 1 }} />

          {/* Volume */}
          <TouchableOpacity
            onPress={handleMuteToggle}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={vCtrl.controlBtn}>
            <Icon
              name={isMuted ? 'mdi:volume-off' : 'mdi:volume-high'}
              size={22}
              color="rgba(255,255,255,0.7)"
            />
          </TouchableOpacity>

          {/* Fullscreen */}
          <TouchableOpacity
            onPress={handleFullscreen}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={vCtrl.controlBtn}>
            <Icon name="mdi:fullscreen" size={22} color="rgba(255,255,255,0.7)" />
          </TouchableOpacity>

          {/* Pop-out / open externally */}
          <TouchableOpacity
            onPress={handlePopOut}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={vCtrl.controlBtn}>
            <Icon name="mdi:open-in-new" size={20} color="rgba(255,255,255,0.7)" />
          </TouchableOpacity>
        </HStack>
      </View>
    </View>
  );
});

// The full-screen overlay component
interface VideoFeedOverlayProps {
  videoPosts: VideoPost[];
  profilesMap: Map<string, ProfileInfo>;
  metricsMap: Map<string, NoteMetrics>;
  startIndex: number;
  onClose: () => void;
  onEndReached?: () => void;
  getDisplayMetrics?: (eventId: string) => NoteMetrics;
  getEngagementState?: (eventId: string) => EngagementViewState;
  onLikePress?: (eventId: string) => void;
  onRepostPress?: (eventId: string) => void;
  engagementRevision?: number;
}

export function VideoFeedOverlay({
  videoPosts,
  profilesMap,
  metricsMap,
  startIndex,
  onClose,
  onEndReached: onEndReachedProp,
  getDisplayMetrics,
  getEngagementState,
  onLikePress,
  onRepostPress,
  engagementRevision = 0,
}: VideoFeedOverlayProps) {
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [activeIndex, setActiveIndex] = useState(startIndex);
  const [isAppActive, setIsAppActive] = useState(true);
  const listRef = useRef<LegendListRef>(null);
  // Gate: suppress onViewableItemsChanged until after the initial scroll settles.
  // LegendList fires it for index 0 immediately on mount before scrollToIndex completes,
  // which would reset activeIndex to 0 and cause a blank first screen.
  const scrollSettled = useRef(startIndex === 0);

  // Slide-up animation: 0 = off-screen below, 1 = fully visible
  const slideAnim = useSharedValue(0);
  // Horizontal drag for swipe-right-to-close
  const dragX = useSharedValue(0);
  // Loading-slot media skeleton pulse (0..1)
  const loadingSkeletonPulse = useSharedValue(0);

  // FIX #5: Track whether the gesture direction has been committed (worklet-safe).
  // Once the initial swipe direction is determined, we commit to it for the
  // duration of the gesture so ambiguous diagonals don't flip between axes.
  const gestureCommitted = useSharedValue(false);

  // Mount: slide in from bottom
  useEffect(() => {
    slideAnim.set(withSpring(1, { damping: 26, stiffness: 220 }));
  }, [slideAnim]);

  useEffect(() => {
    loadingSkeletonPulse.set(
      withRepeat(
        withTiming(1, {
          duration: 900,
          easing: Easing.inOut(Easing.ease),
        }),
        -1,
        true
      )
    );
    return () => {
      cancelAnimation(loadingSkeletonPulse);
      loadingSkeletonPulse.set(0);
    };
  }, [loadingSkeletonPulse]);

  // Imperatively scroll to startIndex after mount, then open the gate.
  useEffect(() => {
    if (startIndex === 0) return;
    // Small delay lets LegendList finish its initial layout before we scroll.
    const id = setTimeout(() => {
      listRef.current?.scrollToIndex({ index: startIndex, animated: false });
      // Allow a second frame for the scroll to physically complete before
      // we start honouring viewability callbacks.
      setTimeout(() => {
        scrollSettled.current = true;
      }, 100);
    }, 50);
    return () => clearTimeout(id);
  }, [startIndex]);

  // AppState: pause when backgrounded
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      setIsAppActive(next === 'active');
    });
    return () => sub.remove();
  }, []);

  // Infinite scroll: show a loading slot at the end of the list when loading.
  // Uses index-based keys so that when the loading slot "becomes" a video
  // (same array index, different content), the cell re-renders in place
  // without any scroll position shift.
  const [showLoadingSlot, setShowLoadingSlot] = useState(false);
  const videoCountAtLoadStart = useRef(0);
  const loadTriggeredForLength = useRef(0);

  useEffect(() => {
    if (
      videoPosts.length > 0 &&
      activeIndex >= videoPosts.length - 1 &&
      !showLoadingSlot &&
      videoPosts.length > loadTriggeredForLength.current
    ) {
      loadTriggeredForLength.current = videoPosts.length;
      videoCountAtLoadStart.current = videoPosts.length;
      setShowLoadingSlot(true);
      onEndReachedProp?.();
    }
  }, [activeIndex, videoPosts.length, showLoadingSlot, onEndReachedProp]);

  // Hide loading slot once new videos have actually arrived
  useEffect(() => {
    if (showLoadingSlot && videoPosts.length > videoCountAtLoadStart.current) {
      setShowLoadingSlot(false);
    }
  }, [videoPosts.length, showLoadingSlot]);

  const displayItems: VideoFeedSlot[] = useMemo(() => {
    const items = showLoadingSlot ? [...videoPosts, LOADING_SLOT] : videoPosts;
    return items;
  }, [videoPosts, showLoadingSlot]);

  const close = useCallback(() => {
    cancelAnimation(slideAnim);
    slideAnim.set(
      withTiming(0, { duration: 260 }, (finished) => {
        'worklet';
        if (finished) runOnJS(onClose)();
      })
    );
  }, [slideAnim, onClose]);

  // Animated container style
  const containerStyle = useAnimatedStyle(() => {
    const slide = slideAnim.get();
    const drag = dragX.get();

    const translateY = interpolate(slide, [0, 1], [screenHeight, 0], Extrapolation.CLAMP);
    // Translate X for drag: only positive (right) values
    const translateX = drag > 0 ? drag : 0;
    // Fade out as user drags right (starts fading after 40px)
    const dragOpacity = interpolate(drag, [0, screenWidth * 0.5], [1, 0.4], Extrapolation.CLAMP);

    return {
      transform: [{ translateY }, { translateX }],
      opacity: dragOpacity,
    };
  });

  const loadingMediaSkeletonStyle = useAnimatedStyle(() => ({
    opacity: interpolate(loadingSkeletonPulse.get(), [0, 1], [0.45, 0.8], Extrapolation.CLAMP),
  }));

  // FIX #5: Improved gesture controls with proper direction locking.
  const panGesture = Gesture.Pan()
    .manualActivation(true)
    .onTouchesMove((e, stateManager) => {
      'worklet';
      // Already committed — keep going
      if (gestureCommitted.get()) return;

      if (e.numberOfTouches !== 1) {
        stateManager.fail();
        return;
      }

      // touch position available via e.allTouches[0] if needed
    })
    .activeOffsetX([25, Infinity]) // require 25px rightward before considering
    .failOffsetX([-Infinity, -10]) // fail immediately on leftward swipes
    .failOffsetY([-8, 8]) // fail fast if primarily vertical (8px Y before 25px X)
    .onStart(() => {
      'worklet';
      gestureCommitted.set(true);
    })
    .onUpdate((e) => {
      'worklet';
      if (e.translationX > 0) {
        dragX.set(e.translationX);
      }
    })
    .onEnd((e) => {
      'worklet';
      gestureCommitted.set(false);

      // Close if dragged far enough or with enough velocity
      if (e.translationX > screenWidth * 0.3 || e.velocityX > 800) {
        runOnJS(close)();
      } else {
        dragX.set(withSpring(0, { damping: 22, stiffness: 240 }));
      }
    })
    .onFinalize(() => {
      'worklet';
      gestureCommitted.set(false);
    });

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: { index: number | null }[] }) => {
      if (!scrollSettled.current) return;
      const first = viewableItems[0];
      if (first?.index != null) {
        setActiveIndex(first.index);
      }
    },
    []
  );

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  const renderItem = useCallback(
    ({ item, index }: LegendListRenderItemProps<VideoFeedSlot, string | undefined>) => {
      if (isLoadingSlot(item)) {
        return (
          <View style={{ width: screenWidth, height: screenHeight, backgroundColor: '#000' }}>
            <Reanimated.View
              style={[
                { flex: 1, backgroundColor: 'rgba(255,255,255,0.14)' },
                loadingMediaSkeletonStyle,
              ]}
            />
            <View
              style={{
                backgroundColor: '#111',
                paddingHorizontal: 16,
                paddingTop: 12,
                paddingBottom: insets.bottom + 8,
              }}>
              <HStack align="center" gap={10} style={{ marginBottom: 8 }}>
                <View style={vCtrl.skeletonAvatar} />
                <VStack style={{ flex: 1, gap: 6 }}>
                  <View style={[vCtrl.skeletonLine, { width: '42%', height: 15 }]} />
                  <View style={[vCtrl.skeletonLine, { width: '30%', height: 12 }]} />
                </VStack>
              </HStack>

              <View style={[vCtrl.skeletonLine, { width: '88%', height: 14, marginBottom: 10 }]} />

              <HStack gap={8} style={{ marginBottom: 12 }}>
                <View style={[vCtrl.skeletonPill, { width: 56 }]} />
                <View style={[vCtrl.skeletonPill, { width: 62 }]} />
                <View style={[vCtrl.skeletonPill, { width: 60 }]} />
              </HStack>

              <View style={[vCtrl.skeletonScrubber, { marginBottom: 10 }]} />

              <HStack align="center" style={{ marginTop: 4 }}>
                <View style={[vCtrl.skeletonControlButton, { marginLeft: 0 }]} />
                <View style={{ flex: 1 }} />
                <View style={vCtrl.skeletonControlButton} />
                <View style={vCtrl.skeletonControlButton} />
                <View style={vCtrl.skeletonControlButton} />
              </HStack>
            </View>
          </View>
        );
      }
      const profile = profilesMap.get(item.pubkey);
      const metrics = getDisplayMetrics
        ? getDisplayMetrics(item.eventId)
        : (metricsMap.get(item.eventId) ?? DEFAULT_METRICS);
      const engagement = getEngagementState
        ? getEngagementState(item.eventId)
        : {
            liked: false,
            reposted: false,
            likePending: false,
            repostPending: false,
          };
      return (
        <VideoFeedItem
          item={item}
          index={index}
          activeIndex={activeIndex}
          isAppActive={isAppActive}
          profile={profile}
          metrics={metrics}
          engagement={engagement}
          onLikePress={onLikePress ? () => onLikePress(item.eventId) : undefined}
          onRepostPress={onRepostPress ? () => onRepostPress(item.eventId) : undefined}
          screenHeight={screenHeight}
          screenWidth={screenWidth}
        />
      );
    },
    [
      activeIndex,
      getDisplayMetrics,
      getEngagementState,
      insets.bottom,
      isAppActive,
      loadingMediaSkeletonStyle,
      metricsMap,
      onLikePress,
      onRepostPress,
      profilesMap,
      screenHeight,
      screenWidth,
    ]
  );

  const overlay = (
    <GestureHandlerRootView style={StyleSheet.absoluteFill}>
      <GestureDetector gesture={panGesture}>
        <Reanimated.View
          style={[StyleSheet.absoluteFill, containerStyle, { backgroundColor: '#000' }]}>
          <LegendList
            ref={listRef}
            data={displayItems}
            keyExtractor={(_: VideoFeedSlot, index: number) => String(index)}
            getItemType={(item: VideoFeedSlot) => (isLoadingSlot(item) ? 'loading' : 'video')}
            estimatedItemSize={screenHeight}
            drawDistance={screenHeight * 2}
            pagingEnabled
            snapToInterval={screenHeight}
            snapToAlignment="start"
            decelerationRate={0.98}
            disableIntervalMomentum={Platform.OS === 'android'}
            scrollEventThrottle={16}
            initialScrollIndex={startIndex}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            renderItem={renderItem}
            extraData={`${activeIndex}:${engagementRevision}`}
            showsVerticalScrollIndicator={false}
            style={{ flex: 1 }}
          />

          {/* Close button */}
          <TouchableOpacity
            onPress={close}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{
              position: 'absolute',
              top: insets.top + 8,
              right: 16,
              width: 36,
              height: 36,
              borderRadius: 18,
              overflow: 'hidden',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
            <Icon name="material-symbols:close-rounded" size={22} color="#fff" />
          </TouchableOpacity>
        </Reanimated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );

  if (Platform.OS === 'web') {
    return overlay;
  }

  return <FullWindowOverlay>{overlay}</FullWindowOverlay>;
}

// ============================================================================
// Main UserFeed Component
// ============================================================================

function UserFeedComponent({
  pubkey,
  authorName,
  authorPicture,
  isOwnProfile,
  ListHeaderComponent,
}: UserFeedProps) {
  const { getPrimaryColor } = useTheme();
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

  // Video feed overlay state
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [overlayStartIndex, setOverlayStartIndex] = useState(0);

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

  const loadMoreVideos = useCallback(async () => {
    const MAX_ATTEMPTS = 5;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      if (!hasMoreRef.current) return;
      const newItems = await loadMoreItems();
      if (newItems.length === 0) return;
      const hasNew = newItems.some((item) => {
        const ev = item.type === 'note' ? item.event : item.originalEvent;
        return ev ? getVideoUrlsFromContent(ev.content).length > 0 : false;
      });
      if (hasNew) return;
    }
  }, [loadMoreItems]);

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

  // FIX #1: Build the video-only list for the full-screen video feed.
  // Deduplicate by videoUrl so that a repost of the same video doesn't
  // produce a second entry (which would show a black screen since both
  // items point to the same underlying content / eventId).
  const videoPosts = useMemo((): VideoPost[] => {
    const result: VideoPost[] = [];
    const seenUrls = new Set<string>();
    for (const item of feedItems) {
      const event = item.type === 'note' ? item.event : item.originalEvent;
      if (!event) continue;
      const videoUrls = getVideoUrlsFromContent(event.content);
      if (videoUrls.length === 0) continue;
      const url = videoUrls[0];
      // Skip duplicate video URLs (e.g. original note + its repost)
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);
      result.push({
        eventId: event.id,
        videoUrl: url,
        content: event.content,
        pubkey: event.pubkey,
        created_at: event.created_at,
      });
    }
    return result;
  }, [feedItems]);

  // Called when a user taps a video in the inline feed — opens the overlay
  const handleVideoTap = useCallback(
    (tappedUrl: string) => {
      const index = videoPosts.findIndex((vp) => vp.videoUrl === tappedUrl);
      if (index === -1) return;
      setOverlayStartIndex(index);
      setOverlayVisible(true);
    },
    [videoPosts]
  );

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
            quotedEvents={quotedRef.current}
            profiles={profilesRef.current}
            getMetrics={getMetrics}
            onVideoTap={handleVideoTap}
            liked={engagement.liked}
            reposted={engagement.reposted}
            likePending={engagement.likePending}
            repostPending={engagement.repostPending}
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
          quotedEvents={quotedRef.current}
          profiles={profilesRef.current}
          getMetrics={getMetrics}
          reposterName={displayName}
          reposterPubkey={pubkey}
          onVideoTap={handleVideoTap}
          liked={engagement.liked}
          reposted={engagement.reposted}
          likePending={engagement.likePending}
          repostPending={engagement.repostPending}
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
      handleVideoTap,
      displayName,
      pubkey,
      toggleLike,
      toggleRepost,
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
      />
    ) : (
      <LegendList
        data={feedItems}
        keyExtractor={(item) => (item.type === 'note' ? item.event.id : item.repostEvent.id)}
        getItemType={(item) => item.type}
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
        scrollEventThrottle={16}
      />
    );

  return (
    <>
      {feedList}
      {overlayVisible && (
        <VideoFeedOverlay
          videoPosts={videoPosts}
          profilesMap={profilesMap}
          metricsMap={metricsMap}
          startIndex={overlayStartIndex}
          onClose={() => setOverlayVisible(false)}
          onEndReached={loadMoreVideos}
          getDisplayMetrics={getDisplayMetrics}
          getEngagementState={getEngagementState}
          engagementRevision={engagementRevision}
          onLikePress={(eventId) => {
            const event = actionableEvents.find((e) => e.id === eventId);
            if (event) toggleLike(event);
          }}
          onRepostPress={(eventId) => {
            const event = actionableEvents.find((e) => e.id === eventId);
            if (event) toggleRepost(event);
          }}
        />
      )}
    </>
  );
}

export const UserFeed = React.memo(UserFeedComponent);

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

// Styles for the custom video player controls
const vCtrl = StyleSheet.create({
  metricPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
  },
  metricText: {
    color: 'rgba(255,255,255,0.7)',
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  timeText: {
    color: 'rgba(255,255,255,0.45)',
  },
  controlBtn: {
    padding: 6,
  },
  skeletonAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  skeletonLine: {
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  skeletonPill: {
    height: 30,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  skeletonScrubber: {
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
    width: '100%',
  },
  skeletonControlButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.14)',
    marginLeft: 8,
  },
});
