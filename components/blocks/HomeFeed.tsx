/**
 * @fileoverview Home Feed ("For You") Component
 *
 * Algorithmic feed powered by Primal's mega_feed_directive endpoint.
 * Fetches available feed configurations, then loads a paginated
 * multi-author feed using the same event format as UserFeed.
 */

import React, { useMemo, useRef, useEffect, useCallback, useState, useTransition } from 'react';
import { StyleSheet, ActivityIndicator, RefreshControl, ScrollView } from 'react-native';
import { useTheme } from 'providers/ThemeProvider';
import { Text } from 'components/ui/Text';
import { VStack } from 'components/ui/View/VStack';
import { View } from 'components/ui/View/View';
import { Spacer } from 'components/ui/View/Spacer';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';
import { ShortTextNote, Repost, GenericRepost, Metadata } from 'nostr-tools/kinds';
import { LegendList, type LegendListRenderItemProps } from '@legendapp/list';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { useBackgroundConfig } from 'providers/BackgroundProvider';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  runOnJS,
} from 'react-native-reanimated';

import {
  type FeedEvent,
  type NoteMetrics,
  type ProfileInfo,
  buildDedupedVideoPosts,
  type RawPrimalEvent,
  DEFAULT_METRICS,
  PRIMAL_CACHE_RELAY_URL,
  PRIMAL_KIND_NOTE_STATS,
  PRIMAL_KIND_MENTIONS,
  PRIMAL_KIND_FEED_RANGE,
  createPrimalRelayClient,
  collectReferencedIds,
  normalizeFeedEvent,
  parseJson,
  getFirstTagValue,
  parseProfileFromRaw,
  parseNoteMetrics,
  tryNpubEncode,
  getVideoUrlsFromContent,
} from './nostr/shared';

import { PostCard } from './nostr/PostCard';
import { RepostCard, VideoFeedOverlay, type VideoPost } from './UserFeed';
import { useNostrEngagement } from '@/hooks/useNostrEngagement';

// ============================================================================
// Types
// ============================================================================

type FeedItem =
  | { type: 'note'; event: FeedEvent; timestamp: number }
  | {
      type: 'repost';
      repostEvent: FeedEvent;
      originalEvent: FeedEvent | undefined;
      originalEventId: string;
      timestamp: number;
    };

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

/**
 * Inject user pubkey into feed specs that require it.
 * Specs with `"id":"feed"` are user-specific (latest from follows, etc.)
 * and need a `pubkey` field to know whose network to query.
 */
function hydrateSpecWithPubkey(spec: string, pubkey: string): string {
  const parsed = parseJson<Record<string, unknown>>(spec);
  if (!parsed || typeof parsed !== 'object') return spec;
  if (parsed.id === 'feed' && !parsed.pubkey) {
    return JSON.stringify({ ...parsed, pubkey });
  }
  return spec;
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

function parseMegaFeedResponse(feedRawEvents: RawPrimalEvent[]): Phase1Result {
  const eventMap = new Map<string, FeedEvent>();
  const notes: FeedEvent[] = [];
  const reposts: FeedEvent[] = [];
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

    if (ev.kind === ShortTextNote) {
      eventMap.set(ev.id, ev);
      notes.push(ev);
      continue;
    }

    if (ev.kind === Repost || ev.kind === GenericRepost) {
      eventMap.set(ev.id, ev);
      reposts.push(ev);
      continue;
    }

    if (ev.kind === Metadata) {
      const result = parseProfileFromRaw(raw);
      if (result) profilesMap.set(result[0], result[1]);
      continue;
    }
  }

  const nextFeedItems: FeedItem[] = [];
  const feedItemsByEventId = new Map<string, FeedItem>();

  for (const note of notes) {
    const item: FeedItem = { type: 'note', event: note, timestamp: note.created_at || 0 };
    nextFeedItems.push(item);
    feedItemsByEventId.set(note.id, item);
  }

  for (const repostEvent of reposts) {
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

  const contentSources = [...notes, ...repostedOriginalEvents];
  const { eventIds: referencedEventIds, pubkeys: inlineMentionPubkeys } =
    collectReferencedIds(contentSources);

  const quotedEventsMap = new Map<string, FeedEvent>(embeddedMentionEvents);
  const missingQuotedIds = referencedEventIds.filter((id) => !quotedEventsMap.has(id));

  const neededPubkeys = new Set(inlineMentionPubkeys);
  for (const ev of embeddedMentionEvents.values()) neededPubkeys.add(ev.pubkey);
  for (const ev of repostedOriginalEvents) neededPubkeys.add(ev.pubkey);
  for (const note of notes) neededPubkeys.add(note.pubkey);
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
// Feed Pill Selector
// ============================================================================

const FeedPill = React.memo(function FeedPill({
  label,
  isActive,
  onPress,
}: {
  label: string;
  isActive: boolean;
  onPress: () => void;
}) {
  const { getPrimaryColor } = useTheme();
  const pressed = useSharedValue(0);

  const tap = useMemo(
    () =>
      Gesture.Tap()
        .onBegin(() => {
          'worklet';
          pressed.set(withTiming(1, { duration: 100 }));
        })
        .onFinalize(() => {
          'worklet';
          pressed.set(withTiming(0, { duration: 180 }));
        })
        .onEnd(() => {
          'worklet';
          runOnJS(onPress)();
        }),
    [onPress, pressed]
  );

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(pressed.get(), [0, 1], [1, 0.92]) }],
    opacity: interpolate(pressed.get(), [0, 1], [1, 0.7]),
  }));

  return (
    <GestureDetector gesture={tap}>
      <Reanimated.View
        style={[
          styles.feedPill,
          {
            backgroundColor: isActive
              ? opacity(getPrimaryColor('0'), 0.12)
              : opacity(getPrimaryColor('0'), 0.04),
            borderColor: isActive ? opacity(getPrimaryColor('0'), 0.25) : 'transparent',
          },
          animStyle,
        ]}>
        <Text
          size={13}
          heavy={isActive}
          style={{
            color: isActive
              ? opacity(getPrimaryColor('0'), 0.8)
              : opacity(getPrimaryColor('0'), 0.4),
          }}>
          {label}
        </Text>
      </Reanimated.View>
    </GestureDetector>
  );
});

// ============================================================================
// Empty / Error States
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
      <Text size={13} style={styles.emptyText}>
        Pull down to refresh or try a different feed.
      </Text>
    </VStack>
  );
}

// ============================================================================
// Main HomeFeed Component
// ============================================================================

function HomeFeedComponent() {
  useBackgroundConfig(BG_CONFIG);
  const { getPrimaryColor } = useTheme();
  const { keys: nostrKeys } = useNostrKeysContext();
  const userPubkey = nostrKeys?.pubkey;

  const [, startTransition] = useTransition();
  const [feedSpecs, setFeedSpecs] = useState<FeedSpec[]>([]);
  const [activeSpecIndex, setActiveSpecIndex] = useState(0);
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

  const metricsRef = useRef(metricsMap);
  metricsRef.current = metricsMap;
  const quotedRef = useRef(quotedEventsMap);
  quotedRef.current = quotedEventsMap;
  const profilesRef = useRef(profilesMap);
  profilesRef.current = profilesMap;
  const [dataVersion, setDataVersion] = useState(0);

  const isFirstRender = useRef(true);

  // Video overlay state
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [overlayStartIndex, setOverlayStartIndex] = useState(0);

  // Ref for handleVideoTap so renderFeedItem doesn't depend on videoPosts
  const videoPostsRef = useRef<VideoPost[]>([]);

  // ── Phase 0: Fetch available feed specs ──

  useEffect(() => {
    let cancelled = false;

    const fetchSpecs = async () => {
      const client = createPrimalRelayClient(PRIMAL_CACHE_RELAY_URL);
      try {
        const rawEvents = await client.request('home_feeds', {
          cache: ['get_home_feeds'],
        });
        if (cancelled) return;

        for (const raw of rawEvents) {
          const parsed = parseJson<FeedSpec[]>(raw.content);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const enabled = parsed.filter((s) => s.enabled !== false);
            if (enabled.length > 0) {
              setFeedSpecs(enabled);
              return;
            }
          }
        }

        setFeedSpecs(FALLBACK_SPECS);
      } catch (err) {
        console.error('HomeFeed: Failed to fetch feed specs', err);
        setFeedSpecs(FALLBACK_SPECS);
      } finally {
        client.close();
      }
    };

    fetchSpecs();

    return () => {
      cancelled = true;
    };
  }, []);

  // ── Phase 1–3: Load feed content for selected spec ──

  const loadFeed = useCallback(
    async (spec: string, isRefresh = false) => {
      if (!isRefresh) setIsLoading(true);
      isFirstRender.current = true;
      hasMoreRef.current = true;
      paginationUntilRef.current = 0;
      paginationOffsetRef.current = 0;
      feedItemIdsRef.current.clear();
      loadingMoreRef.current = false;

      const client = createPrimalRelayClient(PRIMAL_CACHE_RELAY_URL);
      const requestPrefix = Date.now().toString(36);

      try {
        // Hydrate spec with user pubkey for personalized feeds
        const hydratedSpec = userPubkey ? hydrateSpecWithPubkey(spec, userPubkey) : spec;

        const megaFeedPayload: Record<string, unknown> = {
          spec: hydratedSpec,
          limit: 30,
        };
        if (userPubkey) megaFeedPayload.user_pubkey = userPubkey;

        const feedRawEvents = await client.request(`${requestPrefix}_mega`, {
          cache: ['mega_feed_directive', megaFeedPayload],
        });

        const phase1 = parseMegaFeedResponse(feedRawEvents);

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

        // Phase 2 + 3 run in parallel on the same WS connection
        const phase2Promise = (async () => {
          if (phase1.missingQuotedIds.length === 0) return;

          const referencedRawEvents = await client.request(`${requestPrefix}_quoted`, {
            cache: ['events', { event_ids: phase1.missingQuotedIds }],
          });

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

          const extraProfiles = new Map<string, ProfileInfo>();
          for (const raw of profileRawEvents) {
            if (raw.kind !== Metadata) continue;
            const result = parseProfileFromRaw(raw);
            if (result) extraProfiles.set(result[0], result[1]);
          }

          if (extraProfiles.size === 0) return;
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
        console.error('HomeFeed: Failed to load feed', error);
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
    [userPubkey]
  );

  // Trigger feed load when spec changes
  const currentSpec = feedSpecs[activeSpecIndex]?.spec;
  useEffect(() => {
    if (!currentSpec) return;
    loadFeed(currentSpec);
  }, [currentSpec, loadFeed]);

  const handleRefresh = useCallback(() => {
    if (!currentSpec) return;
    setIsRefreshing(true);
    loadFeed(currentSpec, true);
  }, [currentSpec, loadFeed]);

  const handleSpecChange = useCallback(
    (index: number) => {
      if (index === activeSpecIndex) return;
      setActiveSpecIndex(index);
      setFeedItems([]);
    },
    [activeSpecIndex]
  );

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

    try {
      const hydratedSpec = userPubkey
        ? hydrateSpecWithPubkey(currentSpec, userPubkey)
        : currentSpec;
      const payload: Record<string, unknown> = {
        spec: hydratedSpec,
        limit: 20,
        until: paginationUntilRef.current,
      };
      if (paginationOffsetRef.current > 0) payload.offset = paginationOffsetRef.current;
      if (userPubkey) payload.user_pubkey = userPubkey;

      const rawEvents = await client.request(`${rp}_more`, {
        cache: ['mega_feed_directive', payload],
      });
      const page = parseMegaFeedResponse(rawEvents);

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
        setDataVersion((v) => v + 1);
      });

      // Enrichment for new page
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
      return newItems;
    } catch (error) {
      console.error('HomeFeed: loadMore failed', error);
      return [];
    } finally {
      client.close();
      loadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [currentSpec, userPubkey, startTransition]);

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

  const actionableEventsById = useMemo(() => {
    const map = new Map<string, FeedEvent>();
    for (const event of actionableEvents) map.set(event.id, event);
    return map;
  }, [actionableEvents]);

  const { getDisplayMetrics, getEngagementState, toggleLike, toggleRepost, engagementRevision } =
    useNostrEngagement(actionableEvents, getMetrics);

  const videoPosts = useMemo((): VideoPost[] => {
    const sourceEvents: FeedEvent[] = [];
    for (const item of feedItems) {
      const event = item.type === 'note' ? item.event : item.originalEvent;
      if (event) sourceEvents.push(event);
    }
    return buildDedupedVideoPosts(sourceEvents);
  }, [feedItems]);

  // Keep ref in sync — avoids renderFeedItem depending on videoPosts
  videoPostsRef.current = videoPosts;

  const handleVideoTap = useCallback((tappedUrl: string) => {
    const index = videoPostsRef.current.findIndex((vp) => vp.videoUrl === tappedUrl);
    if (index === -1) return;
    setOverlayStartIndex(index);
    setOverlayVisible(true);
  }, []);

  const closeOverlay = useCallback(() => setOverlayVisible(false), []);

  // ── Render ──

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
            likePendingDirection={engagement.likePendingDirection}
            repostPendingDirection={engagement.repostPendingDirection}
            onLikePress={() => toggleLike(item.event)}
            onRepostPress={() => toggleRepost(item.event)}
            skipAnimation={!isFirstRender.current}
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
          quotedEvents={quotedRef.current}
          profiles={profilesRef.current}
          getMetrics={getMetrics}
          reposterName={reposterName}
          reposterPubkey={item.repostEvent.pubkey}
          onVideoTap={handleVideoTap}
          liked={repostEngagement.liked}
          reposted={repostEngagement.reposted}
          likePending={repostEngagement.likePending}
          repostPending={repostEngagement.repostPending}
          likePendingDirection={repostEngagement.likePendingDirection}
          repostPendingDirection={repostEngagement.repostPendingDirection}
          onLikePress={originalEvent ? () => toggleLike(originalEvent) : undefined}
          onRepostPress={originalEvent ? () => toggleRepost(originalEvent) : undefined}
          skipAnimation={!isFirstRender.current}
        />
      );
    },
    [getDisplayMetrics, getEngagementState, getMetrics, handleVideoTap, toggleLike, toggleRepost]
  );

  const refreshTintColor = useMemo(() => opacity(getPrimaryColor('0'), 0.5), [getPrimaryColor]);

  const refreshControl = useMemo(
    () => (
      <RefreshControl
        refreshing={isRefreshing}
        onRefresh={handleRefresh}
        tintColor={refreshTintColor}
      />
    ),
    [isRefreshing, handleRefresh, refreshTintColor]
  );

  const feedHeader = useMemo(
    () => (
      <View>
        {feedSpecs.length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.feedPillsContainer}>
            {feedSpecs.map((spec, idx) => (
              <FeedPill
                key={spec.name}
                label={spec.name}
                isActive={idx === activeSpecIndex}
                onPress={() => handleSpecChange(idx)}
              />
            ))}
          </ScrollView>
        )}

        {isLoading ? (
          <ActivityIndicator style={styles.loader} />
        ) : feedItems.length === 0 ? (
          <EmptyFeed />
        ) : null}
      </View>
    ),
    [feedSpecs, activeSpecIndex, isLoading, feedItems.length, handleSpecChange]
  );

  const feedList =
    isLoading || feedItems.length === 0 ? (
      <LegendList
        data={EMPTY_FEED}
        estimatedItemSize={200}
        renderItem={NOOP_RENDER}
        ListHeaderComponent={feedHeader}
        style={styles.flex1}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={refreshControl}
      />
    ) : (
      <LegendList
        data={feedItems}
        keyExtractor={keyExtractor}
        getItemType={getItemType}
        estimatedItemSize={300}
        drawDistance={400}
        renderItem={renderFeedItem}
        extraData={`${dataVersion}:${engagementRevision}`}
        recycleItems
        ListHeaderComponent={feedHeader}
        ListFooterComponent={
          isLoadingMore ? <ActivityIndicator style={styles.loadMoreSpinner} /> : null
        }
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.4}
        style={styles.flex1}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        refreshControl={refreshControl}
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
          onClose={closeOverlay}
          onEndReached={loadMoreVideos}
          getDisplayMetrics={getDisplayMetrics}
          getEngagementState={getEngagementState}
          engagementRevision={engagementRevision}
          onLikePress={(eventId) => {
            const event = actionableEventsById.get(eventId);
            if (event) toggleLike(event);
          }}
          onRepostPress={(eventId) => {
            const event = actionableEventsById.get(eventId);
            if (event) toggleRepost(event);
          }}
        />
      )}
    </>
  );
}

export const HomeFeed = React.memo(HomeFeedComponent);

// ============================================================================
// Stable references — defined outside the component to avoid re-creation
// ============================================================================

const EMPTY_FEED: FeedItem[] = [];
const NOOP_RENDER = () => null;
const keyExtractor = (item: FeedItem) =>
  item.type === 'note' ? item.event.id : item.repostEvent.id;
const getItemType = (item: FeedItem) => item.type;

const FALLBACK_SPECS: FeedSpec[] = [
  {
    name: 'Trending',
    spec: JSON.stringify({ id: 'explore-global-trending-24h', kind: 'notes' }),
  },
  {
    name: 'Most Zapped',
    spec: JSON.stringify({ id: 'explore-global-mostzapped-4h', kind: 'notes' }),
  },
];

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  feedPillsContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 8,
  },
  feedPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
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
  listContent: {
    paddingBottom: 120,
  },
});
