/**
 * @fileoverview Home Feed ("For You") Component
 *
 * Algorithmic feed powered by Primal's mega_feed_directive endpoint.
 * Fetches available feed configurations, then loads a paginated
 * multi-author feed using the same event format as UserFeed.
 */

import React, { useMemo, useRef, useEffect, useCallback, useState, useTransition } from 'react';
import {
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';
import { TouchableOpacity } from '@/shared/ui/primitives/TouchableOpacity';
import { ShortTextNote, Repost, GenericRepost, Metadata } from 'nostr-tools/kinds';
import { npubToPubkeySafe } from '@/shared/lib/nostr/client';
import { LegendList, type LegendListRenderItemProps, type LegendListRef } from '@legendapp/list';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useBackgroundConfig } from '@/shared/providers/BackgroundProvider';
import Reanimated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderHeight } from '@react-navigation/elements';

import {
  type FeedEvent,
  type FeedItem,
  type FeedParseResult,
  type NoteMetrics,
  type ProfileInfo,
  type RawPrimalEvent,
  DEFAULT_METRICS,
  PRIMAL_CACHE_RELAY_URL,
  PRIMAL_KIND_NOTE_STATS,
  PRIMAL_KIND_MENTIONS,
  PRIMAL_KIND_FEED_RANGE,
  MAX_VIDEO_FEED_PAGES,
  createPrimalRelayClient,
  collectReferencedIds,
  normalizeFeedEvent,
  parseJson,
  getFirstTagValue,
  parseProfileFromRaw,
  parseNoteMetrics,
  tryNpubEncode,
  getEmbeddedRepostEvent,
  buildVideoOverlayLayout,
  computeFeedIndicesWithVideo,
  enrichFeedPage,
} from './nostr/shared';
import { CATEGORY_NPUBS } from './nostr/categoryNpubs';

import { PostCard } from './nostr/PostCard';
import { RepostCard } from './UserFeed';
import {
  ImageOverlayProvider,
  useImageOverlay,
  AnimatedImageOverlay,
  type ImageOverlayReplaceLayout,
} from './nostr/image-overlay';
import { useNostrEngagement } from '@/features/feed/hooks/useNostrEngagement';
import { StoriesRow } from './nostr/StoriesRow';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

// ============================================================================
// Types
// ============================================================================

type HomeFeedListItem = { type: 'stories' } | { type: 'tabs' } | FeedItem;

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

function categoryToLabel(category: string): string {
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
    if (typeof value !== 'string' || value.length !== 64) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    pubkeys.push(value);
  }
  return pubkeys;
}

function parseMegaFeedResponse(feedRawEvents: RawPrimalEvent[]): FeedParseResult {
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
        feedOrder = parsed.elements
          .map((el: unknown) => {
            if (typeof el === 'string') return el;
            if (
              el &&
              typeof el === 'object' &&
              'id' in el &&
              typeof (el as Record<string, unknown>).id === 'string'
            )
              return (el as Record<string, unknown>).id as string;
            return null;
          })
          .filter((id): id is string => id !== null);
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

function HomeFeedInner() {
  useBackgroundConfig(BG_CONFIG);
  const [foreground, surface] = useThemeColor(['foreground', 'surface'] as const);
  const imageOverlay = useImageOverlay();
  const { keys: nostrKeys } = useNostrKeysContext();
  const userPubkey = nostrKeys?.pubkey;
  const insets = useSafeAreaInsets();
  const nativeHeaderHeight = useHeaderHeight();
  const topContentInset = Math.max(nativeHeaderHeight, insets.top + 56);

  const { height: screenHeight } = useWindowDimensions();
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

  const listRef = useRef<LegendListRef>(null);
  const [tabMeasurements, setTabMeasurements] = useState<
    Record<number, { x: number; width: number }>
  >({});
  const indicatorX = useSharedValue(0);
  const indicatorWidth = useSharedValue(0);

  const pendingScrollToTabsRef = useRef(false);
  const storiesHeightRef = useRef(0);
  const scrollOffsetRef = useRef(0);

  const categoryFeedSpecs = useMemo<FeedSpec[]>(() => {
    return Object.entries(CATEGORY_NPUBS).map(([category, npubs]) => {
      const pubkeys = npubs
        .map((npub) => npubToPubkeySafe(npub))
        .filter((pubkey): pubkey is string => !!pubkey);

      return {
        name: categoryToLabel(category),
        spec: JSON.stringify({
          id: 'feed',
          kind: 'notes',
          notes: 'authored',
          pubkeys,
        }),
      };
    });
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

        await enrichFeedPage(
          client,
          requestPrefix,
          phase1.missingQuotedIds,
          phase1.missingProfilePubkeys,
          phase1.quotedEventsMap,
          phase1.profilesMap,
          (updates) => {
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
    loadFeed(activeSpecIndex);
  }, [activeSpecIndex, currentSpec, userPubkey, loadFeed]);

  useEffect(() => {
    if (feedSpecs.length === 0) return;
    if (activeSpecIndex < feedSpecs.length) return;
    setActiveSpecIndex(0);
  }, [activeSpecIndex, feedSpecs.length]);

  const handleRefresh = useCallback(() => {
    if (!currentSpec) return;
    setIsRefreshing(true);
    loadFeed(activeSpecIndex, true);
  }, [activeSpecIndex, currentSpec, loadFeed]);

  const handleSpecChange = useCallback(
    (index: number) => {
      if (index === activeSpecIndex) return;
      const storiesWereHidden = scrollOffsetRef.current > storiesHeightRef.current;
      if (storiesWereHidden) {
        listRef.current?.scrollToOffset({
          offset: storiesHeightRef.current,
          animated: false,
        });
      }
      setActiveSpecIndex(index);
      setIsLoading(true);
      setFeedItems([]);
      pendingScrollToTabsRef.current = storiesWereHidden;
    },
    [activeSpecIndex]
  );

  const handleTabLayout = useCallback((index: number, x: number, width: number) => {
    setTabMeasurements((prev) => {
      const existing = prev[index];
      if (existing?.x === x && existing?.width === width) return prev;
      return { ...prev, [index]: { x, width } };
    });
  }, []);

  useEffect(() => {
    const measurement = tabMeasurements[activeSpecIndex];
    if (!measurement) return;
    indicatorX.set(withTiming(measurement.x, { duration: 220 }));
    indicatorWidth.set(withTiming(measurement.width, { duration: 220 }));
  }, [activeSpecIndex, indicatorWidth, indicatorX, tabMeasurements]);

  // Re-apply scroll position once new feed items arrive after a tab switch
  useEffect(() => {
    if (!pendingScrollToTabsRef.current || feedItems.length === 0) return;
    pendingScrollToTabsRef.current = false;
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({
        offset: storiesHeightRef.current,
        animated: false,
      });
    });
  }, [feedItems]);

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
      const page = parseMegaFeedResponse(rawEvents);

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
      console.error('HomeFeed: loadMore failed', error);
      return [];
    } finally {
      client.close();
      loadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [currentSpec, userPubkey, startTransition]);

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

  const { getDisplayMetrics, getEngagementState, toggleLike, toggleRepost, engagementRevision } =
    useNostrEngagement(actionableEvents, getMetrics);

  // listData = [tabs, ...feedItems] when stories are hidden, otherwise [stories, tabs, ...feedItems].
  const FEED_ITEM_OFFSET = SHOW_STORIES_ROW ? 2 : 1;
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

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: indicatorX.get() }],
    width: indicatorWidth.get(),
  }));

  const tabLabelActiveColor = useMemo(() => opacity(foreground, 0.95), [foreground]);
  const tabLabelInactiveColor = useMemo(() => opacity(foreground, 0.45), [foreground]);

  const tabsBar = useMemo(
    () =>
      feedSpecs.length > 1 ? (
        <View style={[styles.feedTabsContainer, { backgroundColor: surface }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.feedTabsRow}>
            {feedSpecs.map((spec, idx) => {
              const isActive = idx === activeSpecIndex;
              return (
                <TouchableOpacity
                  key={spec.name}
                  style={styles.feedTab}
                  onPress={() => handleSpecChange(idx)}
                  onLayout={(event) => {
                    const { x, width } = event.nativeEvent.layout;
                    handleTabLayout(idx, x, width);
                  }}>
                  <Text
                    size={14}
                    heavy
                    style={{
                      color: isActive ? tabLabelActiveColor : tabLabelInactiveColor,
                    }}>
                    {spec.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
            <Reanimated.View
              pointerEvents="none"
              style={[styles.feedTabIndicator, { backgroundColor: foreground }, indicatorStyle]}
            />
          </ScrollView>
        </View>
      ) : null,
    [
      activeSpecIndex,
      feedSpecs,
      foreground,
      surface,
      handleSpecChange,
      handleTabLayout,
      indicatorStyle,
      tabLabelActiveColor,
      tabLabelInactiveColor,
    ]
  );

  const renderFeedItem = useCallback(
    ({ item, index }: LegendListRenderItemProps<FeedItem, string | undefined>) => {
      const feedIndex = index - FEED_ITEM_OFFSET;
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
        />
      );
    },
    [
      FEED_ITEM_OFFSET,
      getDisplayMetrics,
      getEngagementState,
      getMetrics,
      onOverlayOpenedFromIndex,
      toggleLike,
      toggleRepost,
    ]
  );

  const refreshTintColor = useMemo(() => opacity(foreground, 0.5), [foreground]);

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

  // Tabs are always prepended; stories are currently feature-flagged off.
  // stickyHeaderIndices pins the tabs row at the top while scrolling.
  const listData = useMemo<HomeFeedListItem[]>(
    () => (SHOW_STORIES_ROW ? [STORIES_ITEM, TABS_ITEM, ...feedItems] : [TABS_ITEM, ...feedItems]),
    [feedItems]
  );

  const renderItem = useCallback(
    ({ item, index }: LegendListRenderItemProps<HomeFeedListItem, string | undefined>) => {
      if (item.type === 'stories') {
        return (
          <View
            onLayout={(e) => {
              storiesHeightRef.current = e.nativeEvent.layout.height;
            }}>
            <StoriesRow userPubkey={userPubkey} />
          </View>
        );
      }
      if (item.type === 'tabs') {
        return tabsBar;
      }
      return renderFeedItem({
        item,
        index,
      } as LegendListRenderItemProps<FeedItem, string | undefined>);
    },
    [userPubkey, tabsBar, renderFeedItem]
  );

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
    <ImageOverlayProvider
      getDisplayMetrics={getDisplayMetrics}
      getEngagementState={getEngagementState}
      onSwipeUpToNextPost={onSwipeUpToNextPost}
      getVideoFeedLayoutsAndIndex={getVideoFeedLayoutsAndIndex}>
      <View style={[styles.flex1, { paddingTop: topContentInset }]}>
        <LegendList
          ref={listRef}
          data={listData}
          keyExtractor={listKeyExtractor}
          getItemType={listGetItemType}
          estimatedItemSize={300}
          drawDistance={400}
          renderItem={renderItem}
          extraData={`${dataVersion}:${engagementRevision}`}
          recycleItems
          stickyHeaderIndices={STICKY_INDICES}
          ListFooterComponent={
            isLoading ? (
              <View style={{ height: screenHeight }}>
                <ActivityIndicator style={styles.loader} />
              </View>
            ) : feedItems.length === 0 ? (
              <EmptyFeed />
            ) : isLoadingMore ? (
              <ActivityIndicator style={styles.loadMoreSpinner} />
            ) : null
          }
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.4}
          style={styles.flex1}
          contentContainerStyle={LIST_CONTENT_STYLE}
          showsVerticalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          refreshControl={refreshControl}
        />
      </View>
      <AnimatedImageOverlay />
    </ImageOverlayProvider>
  );
}

function HomeFeedComponent() {
  return <HomeFeedInner />;
}

export const HomeFeed = React.memo(HomeFeedComponent);

// ============================================================================
// Stable references — defined outside the component to avoid re-creation
// ============================================================================

const STORIES_ITEM: HomeFeedListItem = { type: 'stories' };
const TABS_ITEM: HomeFeedListItem = { type: 'tabs' };
const SHOW_STORIES_ROW = false;
const STICKY_INDICES = [SHOW_STORIES_ROW ? 1 : 0];
const LIST_CONTENT_STYLE = { paddingBottom: 120 };

const listKeyExtractor = (item: HomeFeedListItem) => {
  if (item.type === 'stories') return '__stories__';
  if (item.type === 'tabs') return '__tabs__';
  return item.type === 'note' ? item.event.id : item.repostEvent.id;
};
const listGetItemType = (item: HomeFeedListItem) => item.type;

const PRIMAL_FEED_SPECS: FeedSpec[] = [
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
  feedTabsContainer: {
    overflow: 'hidden',
    paddingTop: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  feedTabsRow: {
    paddingHorizontal: 16,
    minHeight: 38,
    alignItems: 'flex-end',
  },
  feedTab: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    paddingTop: 6,
    marginRight: 10,
  },
  feedTabIndicator: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    height: 3,
    borderRadius: 999,
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
});
