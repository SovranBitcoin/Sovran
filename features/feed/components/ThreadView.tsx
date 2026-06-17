/**
 * @fileoverview Thread View Component
 *
 * Displays a Nostr post in detail with its reply chain (parents above,
 * replies below). Pure renderer — data acquisition lives in `useThread`.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { FadeIn, Easing } from 'react-native-reanimated';
import { LegendList, type LegendListRenderItemProps } from '@legendapp/list/react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import opacity from 'hex-color-opacity';

import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Spinner } from '@/shared/ui/primitives/Spinner';
import Icon from 'assets/icons';

import { type FeedEvent, type NoteMetrics, DEFAULT_METRICS } from './nostr/feedTypes';
import { PostCard, PostCardSkeleton } from './nostr/PostCard';
import {
  msUntilLoadingShimmerPassEnds,
  SKELETON_EXIT_DURATION_MS,
} from '@/shared/ui/composed/SkeletonExitShimmer';
import { ImageOverlayProvider, useImageOverlay, AnimatedImageOverlay } from './nostr/image-overlay';

import { useThread, type ThreadItem } from '@/features/feed/hooks/useThread';
import { usePostActions } from '@/features/feed/hooks/usePostActions';
import { useOpenComposer } from '@/features/composer/publish/useComposerActions';
import type { ComposerTarget } from '@/features/composer/publish/buildNoteEvent';
import { getOwnWriteRelays } from '@/shared/lib/nostr/outbox/relayListStore';
import type { ThreadReplySort } from '@/features/feed/data/feedClient';
import { useNostrEngagement } from '@/features/feed/hooks/useNostrEngagement';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { feedLog, Log } from '@/shared/lib/logger';
import { actionMenuPopup } from '@/shared/lib/popup';
import {
  DEFAULT_REPLY_SKELETON_COUNT,
  MAX_REPLY_SKELETON_COUNT,
  sortRepliesByMeasuredHeights,
} from '@/features/feed/lib/threadReplySkeletons';

interface ThreadViewProps {
  eventId: string;
}

const REPLY_MEASUREMENT_CANDIDATE_LIMIT = 12;

const REPLY_SORT_OPTIONS: {
  id: ThreadReplySort;
  label: string;
  description: string;
  icon: string;
}[] = [
  {
    id: 'relevant',
    label: 'Relevant',
    description: 'Best overall signal from likes, follows, replies, reposts, and zaps.',
    icon: 'mdi:trending-up',
  },
  {
    id: 'new',
    label: 'New',
    description: 'Latest replies first.',
    icon: 'mdi:clock-outline',
  },
  {
    id: 'likes',
    label: 'Likes',
    description: 'Replies with the most likes.',
    icon: 'iconamoon:heart-fill',
  },
  {
    id: 'zaps',
    label: 'Zaps',
    description: 'Replies with the highest zap total.',
    icon: 'mdi:lightning-bolt',
  },
  {
    id: 'reposts',
    label: 'Reposts',
    description: 'Replies with the most reposts.',
    icon: 'garden:arrow-retweet-fill-16',
  },
];

const TRANSITION_REPLY_FADE_IN = FadeIn.duration(SKELETON_EXIT_DURATION_MS).easing(
  Easing.out(Easing.cubic)
);

type ThreadSkeletonItem =
  | { type: 'target-skeleton'; id: string }
  | { type: 'reply-skeleton'; id: string; skeletonIndex: number };

type ThreadTransitionItem = {
  type: 'transition-reply';
  event: FeedEvent;
  skeletonIndex: number;
};

type ThreadReplySortTabsItem = {
  type: 'reply-sort-tabs';
  id: 'reply-sort-tabs';
};

type ThreadListItem =
  | ThreadItem
  | ThreadSkeletonItem
  | ThreadTransitionItem
  | ThreadReplySortTabsItem;

function threadKeyExtractor(item: ThreadListItem): string {
  switch (item.type) {
    case 'parent':
      return `p_${item.event.id}`;
    case 'target':
      return `t_${item.event.id}`;
    case 'reply':
    case 'transition-reply':
      return `r_${item.event.id}`;
    case 'reply-sort-tabs':
      return item.id;
    case 'target-skeleton':
    case 'reply-skeleton':
      return item.id;
  }
}

function threadItemType(item: ThreadListItem): string {
  return item.type;
}

function createReplySkeletonItems(count: number): ThreadSkeletonItem[] {
  return Array.from({ length: count }, (_, index) => ({
    type: 'reply-skeleton' as const,
    id: `reply-skeleton-${index}`,
    skeletonIndex: index,
  }));
}

function getTargetReplyCount(
  items: ThreadItem[],
  metrics: React.MutableRefObject<Map<string, NoteMetrics>>
): number | null {
  const target = items.find((item) => item.type === 'target');
  if (!target) return null;
  return metrics.current.get(target.event.id)?.replyCount ?? null;
}

function getRenderedReplyCount(items: ThreadItem[]): number {
  return items.reduce((count, item) => count + (item.type === 'reply' ? 1 : 0), 0);
}

function withReplySortTabs(items: ThreadListItem[]): ThreadListItem[] {
  if (items.some((item) => item.type === 'reply-sort-tabs')) return items;
  const targetIndex = items.findIndex((item) => item.type === 'target');
  if (targetIndex === -1) return items;
  return [
    ...items.slice(0, targetIndex + 1),
    { type: 'reply-sort-tabs', id: 'reply-sort-tabs' },
    ...items.slice(targetIndex + 1),
  ];
}

function ReplySortPicker({
  selected,
  onSelect,
  foreground,
  surfaceTertiary,
}: {
  selected: ThreadReplySort;
  onSelect: (sort: ThreadReplySort) => void;
  foreground: string;
  surfaceTertiary: string;
}) {
  const activeBg = useMemo(() => opacity(surfaceTertiary, 0.5), [surfaceTertiary]);
  const pressedBg = useMemo(() => opacity(surfaceTertiary, 0.65), [surfaceTertiary]);
  const selectedOption =
    REPLY_SORT_OPTIONS.find((option) => option.id === selected) ?? REPLY_SORT_OPTIONS[0];

  const openSortMenu = useCallback(() => {
    actionMenuPopup({
      title: 'Replies',
      buttons: REPLY_SORT_OPTIONS.map((option) => ({
        text: option.label,
        description: option.description,
        icon: option.icon,
        variant: selected === option.id ? 'primary' : undefined,
        testID: `thread-reply-sort-${option.id}`,
        onPress: (close) => {
          close();
          if (selected !== option.id) onSelect(option.id);
        },
      })),
    });
  }, [onSelect, selected]);

  return (
    <View style={styles.replySortContainer}>
      <View style={styles.replySortContent}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: true }}
          accessibilityLabel={`Reply sort: ${selectedOption.label}`}
          activeOpacity={1}
          haptics
          onPress={openSortMenu}
          style={({ pressed }) => [
            styles.replySortButton,
            { backgroundColor: pressed ? pressedBg : activeBg },
          ]}>
          <View style={styles.replySortInner}>
            <Text
              size={14}
              medium
              numberOfLines={1}
              style={[styles.replySortLabel, { color: opacity(foreground, 0.95) }]}>
              {selectedOption.label}
            </Text>
            <Icon name="mdi:chevron-down" size={16} color={opacity(foreground, 0.95)} />
          </View>
        </Pressable>
      </View>
    </View>
  );
}

/** Builds a NIP-10 reply target from the post being replied to. */
function deriveReplyTarget(event: FeedEvent): ComposerTarget {
  const eTags = event.tags.filter((t) => t[0] === 'e');
  const rootTag = eTags.find((t) => t[3] === 'root') ?? eTags[0];
  const pTags = event.tags.filter((t) => t[0] === 'p').map((t) => t[1]);
  return {
    mode: 'reply',
    parentId: event.id,
    parentPubkey: event.pubkey,
    parentPTags: pTags,
    rootId: rootTag?.[1],
    relayHint: getOwnWriteRelays()[0],
  };
}

function ThreadViewInner({ eventId }: ThreadViewProps) {
  const [foreground, background, defaultColor, surfaceTertiary] = useThemeColor([
    'foreground',
    'background',
    'default',
    'surface-tertiary',
  ] as const);
  const headerHeight = useHeaderHeight();
  const imageOverlay = useImageOverlay();

  const {
    items,
    hiddenReplyCount,
    isLoading,
    isFetching,
    isLoadingMoreReplies,
    hasMoreReplies,
    replySort,
    setReplySort,
    error,
    dataVersion,
    profilesRef,
    metricsRef,
    quotedEventsRef,
    loadMoreReplies,
  } = useThread(eventId);

  // The Ignore post / Ignore person menu lives only here in the thread view,
  // not in the feed list. profilesRef is stable, so getProfileName is too.
  const getProfileName = useCallback(
    (pubkey: string) => profilesRef.current.get(pubkey)?.name,
    [profilesRef]
  );
  const openPostActions = usePostActions({ getProfileName });
  const openComposer = useOpenComposer();

  const skeletonHeightsRef = useRef<Map<number, number>>(new Map());
  const replyHeightsRef = useRef<Map<string, number>>(new Map());
  const repliesSeenWhileFetchingRef = useRef(false);
  const shimmerStartedAtRef = useRef<number>(Date.now());
  const exitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [measuredOrder, setMeasuredOrder] = useState<FeedEvent[] | null>(null);
  const measureCommittedRef = useRef(false);
  const [measuredVersion, setMeasuredVersion] = useState(0);
  const [transitionPhase, setTransitionPhase] = useState<'idle' | 'exiting' | 'done'>('idle');

  useEffect(() => {
    skeletonHeightsRef.current = new Map();
    replyHeightsRef.current = new Map();
    measureCommittedRef.current = false;
    repliesSeenWhileFetchingRef.current = false;
    shimmerStartedAtRef.current = Date.now();
    if (exitTimeoutRef.current) {
      clearTimeout(exitTimeoutRef.current);
      exitTimeoutRef.current = null;
    }
    setMeasuredOrder(null);
    setMeasuredVersion(0);
    setTransitionPhase('idle');
  }, [eventId, replySort]);

  useEffect(() => {
    return () => {
      if (exitTimeoutRef.current) clearTimeout(exitTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!measuredOrder) return;
    const handle = setTimeout(() => setTransitionPhase('done'), SKELETON_EXIT_DURATION_MS);
    return () => clearTimeout(handle);
  }, [measuredOrder]);

  const targetIndex = useMemo(() => items.findIndex((item) => item.type === 'target'), [items]);
  const hasParents = useMemo(() => items.some((i) => i.type === 'parent'), [items]);

  const replyEvents = useMemo(
    () => items.filter((it): it is Extract<ThreadItem, { type: 'reply' }> => it.type === 'reply'),
    [items]
  );

  useEffect(() => {
    if (!measuredOrder) return;
    const nextEvents = replyEvents.map((item) => item.event);
    const nextIds = new Set(nextEvents.map((event) => event.id));
    const kept = measuredOrder.filter((event) => nextIds.has(event.id));
    const keptIds = new Set(kept.map((event) => event.id));
    const appended = nextEvents.filter((event) => !keptIds.has(event.id));
    if (kept.length === measuredOrder.length && appended.length === 0) return;
    setMeasuredOrder([...kept, ...appended]);
  }, [measuredOrder, replyEvents]);

  const measurementSlotCount = useMemo(
    () => Math.min(MAX_REPLY_SKELETON_COUNT, replyEvents.length),
    [replyEvents.length]
  );

  const measurementCandidateCount = useMemo(
    () => Math.min(REPLY_MEASUREMENT_CANDIDATE_LIMIT, replyEvents.length),
    [replyEvents.length]
  );

  useEffect(() => {
    if (isFetching && replyEvents.length > 0) {
      repliesSeenWhileFetchingRef.current = true;
    }
  }, [isFetching, replyEvents.length]);

  const hasSkeletonMeasurement = measuredVersion > 0 && skeletonHeightsRef.current.size > 0;
  const isMeasuring =
    !isFetching &&
    measurementSlotCount > 0 &&
    measuredOrder === null &&
    hasSkeletonMeasurement &&
    !repliesSeenWhileFetchingRef.current;

  const displayItems = useMemo<ThreadListItem[]>(() => {
    if (isLoading && items.length === 0) {
      return [
        { type: 'target-skeleton', id: 'target-skeleton' },
        ...createReplySkeletonItems(DEFAULT_REPLY_SKELETON_COUNT),
      ];
    }

    if (measuredOrder) {
      const nonReplyItems = items.filter((it) => it.type !== 'reply');
      if (transitionPhase === 'exiting') {
        return withReplySortTabs([
          ...nonReplyItems,
          ...measuredOrder.map<ThreadListItem>((event, index) => ({
            type: 'transition-reply' as const,
            event,
            skeletonIndex: index,
          })),
        ]);
      }
      return withReplySortTabs([
        ...nonReplyItems,
        ...measuredOrder.map<ThreadItem>((event) => ({ type: 'reply', event })),
      ]);
    }

    if (isMeasuring) {
      const nonReplyItems = items.filter((it) => it.type !== 'reply');
      const targetReplyCount = getTargetReplyCount(items, metricsRef);
      const skeletonCount =
        targetReplyCount == null
          ? Math.min(MAX_REPLY_SKELETON_COUNT, replyEvents.length)
          : Math.min(MAX_REPLY_SKELETON_COUNT, Math.max(replyEvents.length, targetReplyCount));
      return withReplySortTabs([...nonReplyItems, ...createReplySkeletonItems(skeletonCount)]);
    }

    if (!isFetching) return withReplySortTabs(items);

    const targetReplyCount = getTargetReplyCount(items, metricsRef);
    if (targetReplyCount === 0) return withReplySortTabs(items);

    const pendingReplyCount =
      targetReplyCount == null
        ? DEFAULT_REPLY_SKELETON_COUNT
        : Math.max(0, targetReplyCount - getRenderedReplyCount(items));
    const skeletonCount = Math.min(MAX_REPLY_SKELETON_COUNT, pendingReplyCount);

    if (skeletonCount === 0) return withReplySortTabs(items);

    return withReplySortTabs([...items, ...createReplySkeletonItems(skeletonCount)]);
  }, [
    isFetching,
    isLoading,
    isMeasuring,
    items,
    measuredOrder,
    metricsRef,
    replyEvents.length,
    transitionPhase,
  ]);

  const handleSkeletonMeasured = useCallback((skeletonIndex: number, height: number) => {
    skeletonHeightsRef.current.set(skeletonIndex, height);
    // Only nudge React on the first capture; later layouts only update the ref.
    // The hidden measurement tree gates on this state alone, not on every
    // individual height, so additional re-renders here are wasted work.
    setMeasuredVersion((v) => (v === 0 ? 1 : v));
  }, []);

  const handleReplyMeasured = useCallback(
    (replyId: string, height: number) => {
      if (measureCommittedRef.current) return;
      replyHeightsRef.current.set(replyId, height);

      const events = replyEvents.map((it) => it.event);
      const slotCount = Math.min(MAX_REPLY_SKELETON_COUNT, events.length);
      const candidateCount = Math.min(REPLY_MEASUREMENT_CANDIDATE_LIMIT, events.length);
      if (slotCount === 0) return;

      let capturedCandidates = 0;
      for (let i = 0; i < candidateCount; i += 1) {
        if (replyHeightsRef.current.has(events[i].id)) capturedCandidates += 1;
      }

      const skeletonHeightCount = skeletonHeightsRef.current.size;
      if (capturedCandidates < candidateCount || skeletonHeightCount === 0) return;

      const skeletonHeights = Array.from(
        { length: Math.min(slotCount, skeletonHeightCount) },
        (_, i) => skeletonHeightsRef.current.get(i)
      ).filter((h): h is number => typeof h === 'number');

      if (skeletonHeights.length === 0) return;

      const result = sortRepliesByMeasuredHeights(events, skeletonHeights, replyHeightsRef.current);

      const candidateHeights = events.slice(0, candidateCount).map((event) => ({
        eventId: event.id.slice(0, 8),
        originalIndex: events.indexOf(event),
        measuredHeight: replyHeightsRef.current.get(event.id) ?? null,
      }));

      feedLog.info('thread.reply_skeleton.measured_sort', {
        eventId,
        skeletonHeights,
        replyCount: events.length,
        candidateCount,
        candidateHeights,
        matches: result.matches.slice(0, MAX_REPLY_SKELETON_COUNT),
      });

      measureCommittedRef.current = true;
      const waitMs = msUntilLoadingShimmerPassEnds(shimmerStartedAtRef.current);
      const commitExit = () => {
        exitTimeoutRef.current = null;
        setTransitionPhase('exiting');
        setMeasuredOrder(result.replies);
      };
      if (waitMs <= 0) {
        commitExit();
      } else {
        exitTimeoutRef.current = setTimeout(commitExit, waitMs);
      }
    },
    [eventId, replyEvents]
  );

  const getMetrics = useCallback(
    (id: string): NoteMetrics => metricsRef.current.get(id) || DEFAULT_METRICS,
    [metricsRef]
  );

  const actionableEvents = useMemo(() => items.map((item) => item.event), [items]);
  const { getDisplayMetrics, getEngagementState, toggleLike, toggleRepost, engagementRevision } =
    useNostrEngagement(actionableEvents, getMetrics);

  const getThreadContext = useCallback(() => {
    const allEvents = new Map<string, FeedEvent>();
    for (const it of items) allEvents.set(it.event.id, it.event);
    return {
      allEvents,
      profiles: profilesRef.current,
      metrics: metricsRef.current,
      quotedEvents: quotedEventsRef.current,
    };
  }, [items, profilesRef, metricsRef, quotedEventsRef]);

  const renderItem = useCallback(
    ({ item, index }: LegendListRenderItemProps<ThreadListItem, string | undefined>) => {
      if (item.type === 'target-skeleton') {
        return <PostCardSkeleton variant="thread-target" index={index} />;
      }

      if (item.type === 'reply-skeleton') {
        return (
          <PostCardSkeleton
            variant="thread-reply"
            index={item.skeletonIndex}
            onMeasureHeight={handleSkeletonMeasured}
          />
        );
      }

      if (item.type === 'reply-sort-tabs') {
        return (
          <ReplySortPicker
            selected={replySort}
            onSelect={setReplySort}
            foreground={foreground}
            surfaceTertiary={surfaceTertiary}
          />
        );
      }

      if (item.type === 'transition-reply') {
        const metrics = getDisplayMetrics(item.event.id);
        const engagement = getEngagementState(item.event.id);
        return (
          <View style={styles.transitionStack}>
            <Animated.View entering={TRANSITION_REPLY_FADE_IN}>
              <PostCard
                variant="thread-reply"
                event={item.event}
                metrics={metrics}
                quotedEvents={quotedEventsRef.current}
                profiles={profilesRef.current}
                getMetrics={getMetrics}
                showLineAbove={false}
                showLineBelow={false}
                liked={engagement.liked}
                reposted={engagement.reposted}
                likePending={engagement.likePending}
                repostPending={engagement.repostPending}
                likePendingDirection={engagement.likePendingDirection}
                repostPendingDirection={engagement.repostPendingDirection}
                onLikePress={() => toggleLike(item.event)}
                onRepostPress={() => toggleRepost(item.event)}
                onMorePress={() => openPostActions(item.event)}
                getThreadContext={getThreadContext}
              />
            </Animated.View>
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              <PostCardSkeleton variant="thread-reply" index={item.skeletonIndex} exiting />
            </View>
          </View>
        );
      }

      const isParent = item.type === 'parent';
      const isTarget = item.type === 'target';

      const metrics = getDisplayMetrics(item.event.id);
      const engagement = getEngagementState(item.event.id);

      return (
        <PostCard
          variant={isTarget ? 'thread-target' : 'thread-reply'}
          event={item.event}
          metrics={metrics}
          quotedEvents={quotedEventsRef.current}
          profiles={profilesRef.current}
          getMetrics={getMetrics}
          showLineAbove={isParent ? index > 0 : isTarget ? hasParents : false}
          showLineBelow={isParent}
          liked={engagement.liked}
          reposted={engagement.reposted}
          likePending={engagement.likePending}
          repostPending={engagement.repostPending}
          likePendingDirection={engagement.likePendingDirection}
          repostPendingDirection={engagement.repostPendingDirection}
          skeletonMatch={item.type === 'reply' ? item.skeletonMatch : undefined}
          onLikePress={() => toggleLike(item.event)}
          onRepostPress={() => toggleRepost(item.event)}
          onCommentPress={() => openComposer(deriveReplyTarget(item.event))}
          onMorePress={() => openPostActions(item.event)}
          getThreadContext={getThreadContext}
        />
      );
    },
    [
      openPostActions,
      openComposer,
      getDisplayMetrics,
      getEngagementState,
      getMetrics,
      handleSkeletonMeasured,
      hasParents,
      profilesRef,
      quotedEventsRef,
      replySort,
      setReplySort,
      foreground,
      surfaceTertiary,
      toggleLike,
      toggleRepost,
      getThreadContext,
    ]
  );

  const measurementTargets = useMemo(
    () => replyEvents.slice(0, measurementCandidateCount).map((it) => it.event),
    [measurementCandidateCount, replyEvents]
  );

  const handleEndReached = useCallback(() => {
    // Don't start reply pagination while the initial fetch or the skeleton
    // measurement pass is running — the footer spinner would otherwise overlay
    // the measurement tree / exit shimmer (duplicate spinners).
    if (isFetching || isMeasuring) return;
    void loadMoreReplies();
  }, [loadMoreReplies, isFetching, isMeasuring]);

  if (error && items.length === 0) {
    return (
      <View
        style={[
          styles.container,
          styles.centerContent,
          { backgroundColor: background, paddingTop: headerHeight },
        ]}>
        <Icon name="mdi:message-text" size={40} color={defaultColor} />
        <Spacer size={12} />
        <Text size={15} style={{ color: opacity(foreground, 0.5) }}>
          {error}
        </Text>
      </View>
    );
  }

  return (
    <Log name="ThreadView">
      <ImageOverlayProvider
        getDisplayMetrics={getDisplayMetrics}
        getEngagementState={getEngagementState}>
        <View style={[styles.container, { backgroundColor: background }]}>
          <LegendList
            data={displayItems}
            keyExtractor={threadKeyExtractor}
            getItemType={threadItemType}
            estimatedItemSize={200}
            drawDistance={500}
            renderItem={renderItem}
            extraData={[
              dataVersion,
              engagementRevision,
              isFetching ? 1 : 0,
              isLoadingMoreReplies ? 1 : 0,
              hasMoreReplies ? 1 : 0,
              replySort,
            ].join(':')}
            recycleItems
            ListFooterComponent={
              isLoadingMoreReplies && !isMeasuring ? (
                <View style={styles.hiddenReplyFooter}>
                  <Spinner size={18} color={opacity(foreground, 0.45)} />
                </View>
              ) : hiddenReplyCount > 0 && !isFetching && !hasMoreReplies ? (
                <View style={styles.hiddenReplyFooter}>
                  <Text size={13} style={{ color: opacity(foreground, 0.4) }}>
                    {hiddenReplyCount} more {hiddenReplyCount === 1 ? 'reply' : 'replies'} not
                    loaded
                  </Text>
                </View>
              ) : null
            }
            onEndReached={handleEndReached}
            onEndReachedThreshold={0.4}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingTop: headerHeight, paddingBottom: 120 }}
            showsVerticalScrollIndicator={false}
            onScroll={
              imageOverlay?.scrollOffsetY != null
                ? (e: { nativeEvent: { contentOffset: { y: number } } }) => {
                    imageOverlay.scrollOffsetY.value = e.nativeEvent.contentOffset.y;
                  }
                : undefined
            }
            scrollEventThrottle={16}
            initialScrollIndex={!isLoading && targetIndex > 0 ? targetIndex : undefined}
          />
          {isMeasuring && measurementTargets.length > 0 ? (
            <View
              style={styles.measurementTree}
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants">
              {measurementTargets.map((event) => {
                const metrics = getDisplayMetrics(event.id);
                const engagement = getEngagementState(event.id);
                return (
                  <PostCard
                    key={`measure_${event.id}`}
                    variant="thread-reply"
                    event={event}
                    metrics={metrics}
                    quotedEvents={quotedEventsRef.current}
                    profiles={profilesRef.current}
                    getMetrics={getMetrics}
                    liked={engagement.liked}
                    reposted={engagement.reposted}
                    likePending={engagement.likePending}
                    repostPending={engagement.repostPending}
                    likePendingDirection={engagement.likePendingDirection}
                    repostPendingDirection={engagement.repostPendingDirection}
                    getThreadContext={getThreadContext}
                    onMeasureHeight={handleReplyMeasured}
                    measurementMode
                  />
                );
              })}
            </View>
          ) : null}
          <AnimatedImageOverlay />
        </View>
      </ImageOverlayProvider>
    </Log>
  );
}

export const ThreadView = React.memo(ThreadViewInner);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  hiddenReplyFooter: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  measurementTree: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    opacity: 0,
  },
  transitionStack: {
    position: 'relative',
  },
  replySortContainer: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 10,
  },
  replySortContent: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
  },
  replySortButton: {
    borderRadius: 999,
  },
  replySortInner: {
    minHeight: 34,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  replySortLabel: {
    lineHeight: 18,
  },
});
