/**
 * @fileoverview Thread View Component
 *
 * Displays a Nostr post in detail with its reply chain (parents above,
 * replies below). Pure renderer — data acquisition lives in `useThread`.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  LegendList,
  type LegendListRef,
  type LegendListRenderItemProps,
} from '@legendapp/list/react-native';
import { FlashList, type FlashListProps } from '@shopify/flash-list';
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
import { ImageOverlayProvider, useImageOverlay, AnimatedImageOverlay } from './nostr/image-overlay';
import {
  ThreadEmbedProvider,
  useThreadEmbed,
  ThreadEmbedSheet,
  LinkEmbedView,
  EmbedActionBar,
} from './thread-embed';

import { useThread, type ThreadItem } from '@/features/feed/hooks/useThread';
import { usePostActions } from '@/features/feed/hooks/usePostActions';
import { useOpenComposer } from '@/features/composer/publish/useComposerActions';
import { deriveReplyTarget } from '@/features/feed/lib/replyTarget';
import { useQuotePost } from '@/features/feed/lib/useQuotePost';
import { ThreadReplyBar } from '@/features/feed/components/ThreadReplyBar';
import { VisualLayoutProbe } from '@/shared/ui/composed/VisualLayoutProbe';
import type { ThreadReplySort } from '@/features/feed/data/feedClient';
import { useNostrEngagement } from '@/features/feed/hooks/useNostrEngagement';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { feedLog, Log } from '@/shared/lib/logger';
import { actionMenuPopup } from '@/shared/lib/popup';
import {
  remeasureVisualLayoutScope,
  useVisualListLogger,
  useVisualStateLogger,
  VISUAL_LIST_VIEWABILITY_CONFIG,
} from '@/shared/lib/contentShiftLog';
import {
  DEFAULT_REPLY_SKELETON_COUNT,
  MAX_REPLY_SKELETON_COUNT,
} from '@/features/feed/lib/threadReplySkeletons';
import { threadFixedItemSize } from '@/features/feed/lib/threadListLayout';

interface ThreadViewProps {
  eventId: string;
}

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

// When a reply's real content loads it fades in while the skeleton it replaces
// fades out — a crossfade in the same row slot.
const REPLY_FADE_IN = FadeIn.duration(220);
const SKELETON_FADE_OUT = FadeOut.duration(220);

// Rough per-row height used only to discount the content already below the
// focused note when sizing the focus reserve (see `focusReserve`). Deliberately
// approximate — it just keeps the reserve from over-padding long threads.
const FOCUS_RESERVE_ROW_APPROX = 150;

// `data: true` lets LegendList compensate the parent prepend; `size: false` hands
// the size axis entirely to our `onItemSizeChanged` counter-scroll, so the library
// and our correction never both move the scroll (that double-correction is what
// oscillated into jitter). Module-level for a stable prop reference.
const THREAD_MVCP = { data: true, size: false } as const;

type ThreadSkeletonItem =
  | { type: 'target-skeleton'; id: string }
  | { type: 'reply-skeleton'; id: string; skeletonIndex: number };

type ThreadReplySortTabsItem = {
  type: 'reply-sort-tabs';
  id: 'reply-sort-tabs';
};

type ThreadListItem = ThreadItem | ThreadSkeletonItem | ThreadReplySortTabsItem;

function threadKeyExtractor(item: ThreadListItem): string {
  switch (item.type) {
    case 'parent':
      return `p_${item.event.id}`;
    case 'target':
      return `t_${item.event.id}`;
    case 'reply':
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

function ThreadViewInner({ eventId }: ThreadViewProps) {
  const [foreground, surface, defaultColor, surfaceTertiary] = useThemeColor([
    'foreground',
    'surface',
    'default',
    'surface-tertiary',
  ] as const);
  const headerHeight = useHeaderHeight();
  const { height: windowHeight } = useWindowDimensions();
  // Spike toggle (Settings → Developer): render the thread on FlashList v2 (synchronous
  // Fabric layout) with the legend-list scaffolding stripped, to A/B scroll stability.
  const flashListThread = useSettingsStore((s) => s.flashListThread);
  const imageOverlay = useImageOverlay();
  const embed = useThreadEmbed();
  const embedOpen = embed?.open;
  const targetFooterOpacity = embed?.targetFooterOpacity;
  const [replyBarHeight, setReplyBarHeight] = useState(0);
  const threadVisualScope = useMemo(() => `thread.${eventId}.list`, [eventId]);

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

  const listRef = useRef<LegendListRef>(null);

  // Anchor compensation for the parent prepend. `maintainVisibleContentPosition`
  // scrolls to hold the focused note when the parent prepends, but it anchors
  // against the parent's *estimate* (`estimatedItemSize`) and never reconciles the
  // gap once the parent measures to its real height — leaving the note off by
  // exactly (estimate − measured) px (verified in the shift log: 200 vs 145 → the
  // note jumped up 55px). We own that reconciliation: while the reader hasn't
  // scrolled, every size change of a row ABOVE the note (the prepend's
  // estimate→measured jump, and late media reshaping) is countered by the delta so
  // the note stays put. Read via refs so the size-change callback is stable.
  const targetIndexRef = useRef(-1);
  const readerMovedRef = useRef(false);

  // Resolve off-screen, then crossfade. Two lists: a seed list (tapped note + reply
  // SKELETONS, no parents) the reader sees immediately, and the real list (full
  // thread) that resolves OFF-SCREEN — parents settle AND replies measure + load their
  // images there. Once the on-screen rows stop changing size (debounced, with an
  // absolute cap), we land the note authoritatively (`scrollToIndex`) and crossfade
  // the settled real list in over the seed: the note is a pixel match (looks static),
  // and the reply skeletons fade to ALREADY-SETTLED real replies — so nothing reshifts
  // after they appear. `revealed`/`revealedRef` = real list is taking over.
  const [revealed, setRevealed] = useState(false);
  const revealedRef = useRef(false);
  const [seedHidden, setSeedHidden] = useState(false);
  const listOpacity = useSharedValue(0);
  const realListStyle = useAnimatedStyle(() => ({ opacity: listOpacity.value }));
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const capTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Land the note at the top with one authoritative `scrollToIndex` (correct for ANY
  // number of parents — robust where summing per-row deltas undershoots), then reveal
  // next frame so the scroll has applied while still hidden.
  const fireReveal = useCallback(() => {
    if (revealedRef.current) return;
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    if (capTimerRef.current) clearTimeout(capTimerRef.current);
    capTimerRef.current = null;
    revealedRef.current = true;
    const idx = targetIndexRef.current;
    if (idx > 0) {
      void listRef.current?.scrollToIndex({ index: idx, viewPosition: 0, animated: false });
    }
    requestAnimationFrame(() => setRevealed(true));
  }, []);

  // Debounced "rows have gone quiet" timer — reset by each on-screen size change so the
  // reveal waits until parents AND the first replies have settled.
  const scheduleReveal = useCallback(
    (delayMs: number) => {
      if (revealedRef.current) return;
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      settleTimerRef.current = setTimeout(fireReveal, delayMs);
    },
    [fireReveal]
  );

  // Crossfade the real list in once it's the authoritative view, then drop the seed.
  useEffect(() => {
    if (!revealed) return;
    listOpacity.value = withTiming(1, { duration: 200 }, (finished) => {
      if (finished) runOnJS(setSeedHidden)(true);
    });
  }, [revealed, listOpacity]);

  useEffect(() => {
    setRevealed(false);
    revealedRef.current = false;
    readerMovedRef.current = false;
    setSeedHidden(false);
    listOpacity.value = 0;
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    if (capTimerRef.current) clearTimeout(capTimerRef.current);
    capTimerRef.current = null;
  }, [eventId, listOpacity]);

  const targetItem = useMemo(() => items.find((item) => item.type === 'target'), [items]);
  const hasParents = useMemo(() => items.some((i) => i.type === 'parent'), [items]);

  const displayItems = useMemo<ThreadListItem[]>(() => {
    if (isLoading && items.length === 0) {
      // Include the sort-tabs row in the very first skeleton frame so it doesn't
      // pop in (52px) once the target loads and shove every reply/skeleton down —
      // that insertion lands on the same frame the reply skeletons appear and
      // reads as a content shift.
      return [
        { type: 'target-skeleton', id: 'target-skeleton' },
        { type: 'reply-sort-tabs', id: 'reply-sort-tabs' },
        ...createReplySkeletonItems(DEFAULT_REPLY_SKELETON_COUNT),
      ];
    }

    // Real replies render immediately (they fade in); any remaining unfetched
    // replies show as fixed-height skeletons appended below, which crossfade to
    // real cards as they load. No measurement / height-matching.
    const targetReplyCount = getTargetReplyCount(items, metricsRef);
    if (targetReplyCount === 0) return withReplySortTabs(items);

    const pendingReplyCount =
      targetReplyCount == null
        ? isFetching
          ? DEFAULT_REPLY_SKELETON_COUNT
          : 0
        : Math.max(0, targetReplyCount - getRenderedReplyCount(items));
    const skeletonCount = Math.min(MAX_REPLY_SKELETON_COUNT, pendingReplyCount);

    if (skeletonCount === 0) return withReplySortTabs(items);

    return withReplySortTabs([...items, ...createReplySkeletonItems(skeletonCount)]);
  }, [isFetching, isLoading, items, metricsRef]);

  // The seed (visible until the crossfade) shows the note + reply SKELETONS, no
  // parents. The real list renders the FULL thread the whole time, including replies,
  // so the replies measure and load their images OFF-SCREEN and are already settled by
  // the time the crossfade reveals them — that's what stops the post-appearance
  // reshift. (Only the real list renders real replies, so images aren't double-loaded.)
  const seedData = useMemo<ThreadListItem[]>(
    () => displayItems.filter((i) => i.type !== 'parent' && i.type !== 'reply'),
    [displayItems]
  );
  const realData = displayItems;
  // The note's index in the real list (parents precede it; replies/skeletons follow,
  // so the index is the same gated or not) — for the focus reserve and the landing.
  const fullTargetIndex = useMemo(
    () => displayItems.findIndex((i) => i.type === 'target'),
    [displayItems]
  );
  targetIndexRef.current = fullTargetIndex;

  // Once the full thread is fetched, wait for the on-screen rows (parents above AND
  // the first replies below) to settle off-screen, then crossfade. Arm the debounced
  // quiet timer (the size-change handler resets it as rows settle) plus an absolute
  // cap so a slow network image can't hold the seed indefinitely — anything still
  // loading past the cap finishes after the crossfade (counter-scroll absorbs an
  // above-note straggler; a below-note straggler is past the focus and rare).
  const fullReady = !isLoading && !isFetching && !!targetItem;
  useEffect(() => {
    if (!fullReady || revealed) return;
    scheduleReveal(220);
    if (!capTimerRef.current) capTimerRef.current = setTimeout(fireReveal, 1000);
  }, [fullReady, revealed, scheduleReveal, fireReveal]);

  // Focus reserve: extra bottom space so the tapped reply can always be scrolled
  // to (and held at) the top of the viewport, even when little content sits below
  // it. Opening a thread on a reply lands a tall parent chain above the note; with
  // no room below, the scroll bottoms out (clamps/snaps) and the note can't be
  // refocused, and `maintainVisibleContentPosition` has nowhere to scroll to hold
  // it as the parent grows. We reserve `viewport − (content already below the
  // note)`, so the reserve is generous on short threads and shrinks toward 0 as
  // replies fill the screen (no dead gap on long threads). Owned here (not the
  // library's `anchoredEndSpace`) so it's deterministic, hot-reloadable, and
  // logged. `targetIndex` indexes `displayItems` too — the sort-tabs row is
  // inserted after the target and skeletons are appended last.
  const focusReserve = useMemo(() => {
    if (fullTargetIndex <= 0) return 0;
    const listViewport = Math.max(0, windowHeight - headerHeight - (replyBarHeight || 80));
    const belowCount = Math.max(0, displayItems.length - 1 - fullTargetIndex);
    return Math.max(0, listViewport - belowCount * FOCUS_RESERVE_ROW_APPROX);
  }, [fullTargetIndex, windowHeight, headerHeight, replyBarHeight, displayItems.length]);

  useEffect(() => {
    if (focusReserve <= 0) return;
    feedLog.info('thread.reserve', {
      eventId,
      targetIndex: fullTargetIndex,
      rows: displayItems.length,
      focusReserve: Math.round(focusReserve),
      windowHeight: Math.round(windowHeight),
    });
  }, [focusReserve, eventId, fullTargetIndex, displayItems.length, windowHeight]);

  const threadPhase =
    isLoading && items.length === 0
      ? 'loading-skeletons'
      : isFetching
        ? 'fetching-with-skeletons'
        : 'replies';

  const visualList = useVisualListLogger<ThreadListItem>({
    scope: threadVisualScope,
    surface: 'thread',
    component: 'ThreadLegendList',
    phase: threadPhase,
    extra: () => ({
      eventId,
      rows: displayItems.length,
      replySort,
      replyBarHeight,
      isFetching,
      isLoadingMoreReplies,
    }),
    getItemKey: (item) => threadKeyExtractor(item),
    getItemContext: (item) => ({
      rowKey: threadKeyExtractor(item),
      rowLabel: threadItemType(item),
      itemType: threadItemType(item),
    }),
    getListState: () => listRef.current?.getState() ?? null,
  });

  // Two regimes, split on `revealed`:
  //  - BEFORE the crossfade (off-screen): ANY rendered row still changing size — a
  //    parent measuring, a reply measuring or its image loading — keeps the reveal
  //    waiting (`scheduleReveal` resets) so we crossfade a fully-settled list. No
  //    per-row counter-scroll here: `scrollToIndex` (in `fireReveal`) lands the note
  //    authoritatively, which is robust where summing many deltas would undershoot.
  //  - AFTER the crossfade: a slow parent image (no imeta dims) can still reshape;
  //    it's off-screen above the note, so counter-scroll by its exact delta to absorb
  //    the growth and keep the note fixed. One change at a time → no burst.
  const handleItemSizeChanged = useCallback(
    (info: {
      size: number;
      previous: number;
      index: number;
      itemKey: string;
      itemData: ThreadListItem;
    }) => {
      visualList.onItemSizeChanged?.(info);
      if (readerMovedRef.current) return;
      const tIndex = targetIndexRef.current;
      if (tIndex < 0) return;
      if (!revealedRef.current) {
        scheduleReveal(180);
        return;
      }
      if (info.index >= tIndex) return;
      const delta = info.size - info.previous;
      if (delta === 0) return;
      const current = listRef.current?.getState()?.scroll ?? 0;
      void listRef.current?.scrollToOffset({ offset: current + delta, animated: false });
    },
    [visualList, scheduleReveal]
  );

  const threadVisualState = useMemo(() => {
    let skeletons = 0;
    let realReplies = 0;
    for (const it of displayItems) {
      if (it.type === 'target-skeleton' || it.type === 'reply-skeleton') skeletons += 1;
      else if (it.type === 'reply') realReplies += 1;
    }
    return {
      eventId,
      phase: threadPhase,
      rows: displayItems.length,
      skeletons,
      realReplies,
      replySort,
      replyBarHeight,
      isFetching,
      isLoading,
      isLoadingMoreReplies,
    };
  }, [
    displayItems,
    eventId,
    isFetching,
    isLoading,
    isLoadingMoreReplies,
    replyBarHeight,
    replySort,
    threadPhase,
  ]);

  useVisualStateLogger({
    scope: threadVisualScope,
    surface: 'thread',
    component: 'ThreadView',
    stateKey: 'thread-state',
    phase: threadVisualState.phase,
    state: threadVisualState,
    remeasure: {
      reason: 'thread-state',
      minIntervalMs: 250,
      maxItems: 32,
    },
  });

  // Content-shift trace: log each reply-list phase change with its row makeup so
  // a jump can be tied to the exact transition. Pairs with `thread.reply_skeleton.*`.
  const lastThreadPhaseRef = useRef<string>('');
  useEffect(() => {
    let skeletons = 0;
    let realReplies = 0;
    for (const it of displayItems) {
      if (it.type === 'target-skeleton' || it.type === 'reply-skeleton') skeletons += 1;
      else if (it.type === 'reply') realReplies += 1;
    }
    const signature = `${threadPhase}:${displayItems.length}:${skeletons}:${realReplies}`;
    if (lastThreadPhaseRef.current === signature) return;
    const prevPhase = lastThreadPhaseRef.current;
    lastThreadPhaseRef.current = signature;
    feedLog.info('thread.shift.phase', {
      eventId,
      phase: threadPhase,
      prevSignature: prevPhase || null,
      rows: displayItems.length,
      skeletons,
      realReplies,
      replyBarHeight,
    });
  }, [displayItems, eventId, replyBarHeight, threadPhase]);

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

  const renderThreadItem = useCallback(
    ({ item, index }: LegendListRenderItemProps<ThreadListItem, string | undefined>) => {
      if (item.type === 'target-skeleton') {
        return <PostCardSkeleton variant="thread-target" index={index} />;
      }

      if (item.type === 'reply-skeleton') {
        const skeleton = <PostCardSkeleton variant="thread-reply" index={item.skeletonIndex} />;
        // FlashList recycles cells, which fights reanimated exit animations — the
        // exiting skeleton renders in a recycled cell's position for a frame (the
        // "skeleton in the wrong place" glitch). Skip the exit there; on legend-list
        // it fades out as the real reply fades in (crossfade).
        return flashListThread ? (
          skeleton
        ) : (
          <Animated.View exiting={SKELETON_FADE_OUT}>{skeleton}</Animated.View>
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

      const isParent = item.type === 'parent';
      const isTarget = item.type === 'target';

      const metrics = getDisplayMetrics(item.event.id);
      const engagement = getEngagementState(item.event.id);

      const card = (
        <PostCard
          variant={isTarget ? 'thread-target' : 'thread-reply'}
          event={item.event}
          metrics={metrics}
          quotedEvents={quotedEventsRef.current}
          profiles={profilesRef.current}
          getMetrics={getMetrics}
          onLinkPress={isTarget ? embedOpen : undefined}
          footerOpacity={isTarget ? targetFooterOpacity : undefined}
          showLineAbove={isParent ? index > 0 : isTarget ? hasParents : false}
          showLineBelow={isParent}
          liked={engagement.liked}
          replied={engagement.replied}
          reposted={engagement.reposted}
          likePending={engagement.likePending}
          repostPending={engagement.repostPending}
          likePendingDirection={engagement.likePendingDirection}
          repostPendingDirection={engagement.repostPendingDirection}
          onLikePress={() => toggleLike(item.event)}
          onRepostPress={() => toggleRepost(item.event)}
          onCommentPress={() =>
            openComposer(deriveReplyTarget(item.event), {
              parentEvent: item.event,
              parentProfile: profilesRef.current.get(item.event.pubkey),
            })
          }
          onMorePress={() => openPostActions(item.event)}
          getThreadContext={getThreadContext}
        />
      );

      // Each reply fades its real content in as it loads, crossfading with the
      // skeleton it replaces. Skipped on FlashList (recycled cells fight reanimated
      // enter animations — see the skeleton note above); on legend-list it fades in.
      if (item.type === 'reply') {
        return flashListThread ? (
          card
        ) : (
          <Animated.View entering={REPLY_FADE_IN}>{card}</Animated.View>
        );
      }
      return card;
    },
    [
      openPostActions,
      openComposer,
      embedOpen,
      targetFooterOpacity,
      getDisplayMetrics,
      getEngagementState,
      getMetrics,
      hasParents,
      flashListThread,
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

  const renderItem = useCallback(
    (props: LegendListRenderItemProps<ThreadListItem, string | undefined>) => (
      <VisualLayoutProbe
        scope={threadVisualScope}
        surface="thread"
        component="ThreadRow"
        itemKey={threadKeyExtractor(props.item)}
        itemType={threadItemType(props.item)}
        index={props.index}
        phase={threadPhase}
        extra={{
          eventId,
          rows: displayItems.length,
          replySort,
          replyBarHeight,
          isFetching,
        }}>
        {renderThreadItem(props)}
      </VisualLayoutProbe>
    ),
    [
      displayItems.length,
      eventId,
      isFetching,
      renderThreadItem,
      replyBarHeight,
      replySort,
      threadVisualScope,
      threadPhase,
    ]
  );

  const handleEndReached = useCallback(() => {
    // Don't start reply pagination while the initial fetch is running — the
    // footer spinner would otherwise overlap the loading skeletons.
    if (isFetching) return;
    void loadMoreReplies();
  }, [loadMoreReplies, isFetching]);

  // Target-post actions for the floating embed action bar (mirrors the
  // target PostCard's MetricsFooter wiring). Hooks stay above the early
  // return below.
  const targetEvent = targetItem?.event;
  const onTargetComment = useCallback(() => {
    if (!targetEvent) return;
    openComposer(deriveReplyTarget(targetEvent), {
      parentEvent: targetEvent,
      parentProfile: profilesRef.current.get(targetEvent.pubkey),
    });
  }, [targetEvent, openComposer, profilesRef]);
  const onTargetLike = useCallback(() => {
    if (targetEvent) void toggleLike(targetEvent);
  }, [targetEvent, toggleLike]);
  const onTargetRepost = useCallback(() => {
    if (targetEvent) void toggleRepost(targetEvent);
  }, [targetEvent, toggleRepost]);
  const quotePost = useQuotePost();
  const onTargetQuote = useCallback(() => {
    if (targetEvent) quotePost(targetEvent, profilesRef.current.get(targetEvent.pubkey));
  }, [targetEvent, quotePost, profilesRef]);

  if (error && items.length === 0) {
    return (
      <View
        style={[
          styles.container,
          styles.centerContent,
          { backgroundColor: surface, paddingTop: headerHeight },
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
        <View style={[styles.container, { backgroundColor: surface }]}>
          {embed?.embedUrl ? (
            <LinkEmbedView
              url={embed.embedUrl}
              opacity={embed.embedOpacity}
              onScroll={embed.handleEmbedScroll}
              topInset={headerHeight}
            />
          ) : null}
          <ThreadEmbedSheet
            footer={
              // Always mounted so the reply bar is pinned at the bottom from
              // the first frame (no pop-in when the target loads). Travels
              // with the sheet so it slides away as the embed is revealed.
              <ThreadReplyBar
                targetEvent={targetItem?.event}
                targetProfile={
                  targetItem ? profilesRef.current.get(targetItem.event.pubkey) : undefined
                }
                onHeightChange={setReplyBarHeight}
              />
            }>
            {flashListThread ? (
              // SPIKE: FlashList v2 holds the note via synchronous Fabric layout + default
              // mVCP — no two-list / crossfade / counter-scroll / reply gating needed. The
              // ONE non-library-specific piece we keep is `focusReserve`: extra bottom
              // padding so the anchored note has REAL scroll room below it; without it mVCP
              // anchors past the scroll bounds and the first gesture snaps to top/bottom.
              <FlashList
                data={displayItems}
                keyExtractor={threadKeyExtractor}
                getItemType={threadItemType}
                renderItem={renderItem as unknown as FlashListProps<ThreadListItem>['renderItem']}
                drawDistance={500}
                onEndReached={handleEndReached}
                onEndReachedThreshold={0.4}
                ListFooterComponent={
                  isLoadingMoreReplies ? (
                    <View style={styles.hiddenReplyFooter}>
                      <Spinner size={18} color={opacity(foreground, 0.45)} />
                    </View>
                  ) : null
                }
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{
                  paddingTop: 0,
                  paddingBottom: (replyBarHeight || 80) + 16 + focusReserve,
                }}
                onScroll={(e: { nativeEvent: { contentOffset: { y: number } } }) => {
                  const y = e.nativeEvent.contentOffset.y;
                  if (imageOverlay?.scrollOffsetY != null) imageOverlay.scrollOffsetY.value = y;
                  if (embed) embed.scrollY.value = y;
                }}
                scrollEventThrottle={16}
                initialScrollIndex={!isLoading && fullTargetIndex > 0 ? fullTargetIndex : undefined}
              />
            ) : (
              <View style={styles.listWrap}>
                {/* Real list — full thread; resolves off-screen (opacity 0), then
                  crossfades in over the seed once the rows have settled. zIndex keeps
                  it above the seed regardless of mount order. */}
                <Animated.View
                  style={[StyleSheet.absoluteFill, styles.realLayer, realListStyle]}
                  pointerEvents={revealed ? 'auto' : 'none'}>
                  <LegendList
                    ref={listRef}
                    data={realData}
                    keyExtractor={threadKeyExtractor}
                    getItemType={threadItemType}
                    getFixedItemSize={threadFixedItemSize}
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
                      isLoadingMoreReplies ? (
                        <View style={styles.hiddenReplyFooter}>
                          <Spinner size={18} color={opacity(foreground, 0.45)} />
                        </View>
                      ) : hiddenReplyCount > 0 && !isFetching && !hasMoreReplies ? (
                        <View style={styles.hiddenReplyFooter}>
                          <Text size={13} style={{ color: opacity(foreground, 0.4) }}>
                            {hiddenReplyCount} more {hiddenReplyCount === 1 ? 'reply' : 'replies'}{' '}
                            not loaded
                          </Text>
                        </View>
                      ) : null
                    }
                    onEndReached={handleEndReached}
                    onEndReachedThreshold={0.4}
                    onItemSizeChanged={handleItemSizeChanged}
                    onScrollBeginDrag={() => {
                      readerMovedRef.current = true;
                    }}
                    onLoad={visualList.onLoad}
                    onMetricsChange={visualList.onMetricsChange}
                    onStickyHeaderChange={visualList.onStickyHeaderChange}
                    onViewableItemsChanged={visualList.onViewableItemsChanged}
                    viewabilityConfig={VISUAL_LIST_VIEWABILITY_CONFIG}
                    style={{ flex: 1 }}
                    contentContainerStyle={{
                      // The embed sheet is positioned starting just below the header
                      // (`expandedOffset`), so the list itself no longer pads the top.
                      paddingTop: 0,
                      // replyBarHeight already includes the bottom safe-area inset (the
                      // bar's opaque container reaches the screen bottom), so the inset
                      // is not added again here. `focusReserve` adds room below the note
                      // so it can be scrolled to the top (see its definition above).
                      paddingBottom: (replyBarHeight || 80) + 16 + focusReserve,
                    }}
                    showsVerticalScrollIndicator={false}
                    // Anchor-on-the-tapped-note stability (see THREAD_MVCP): `data:true`
                    // compensates the parent prepend; `size:false` leaves the size axis to our
                    // `onItemSizeChanged` counter-scroll (sole owner → no double-correction).
                    // Paired with `focusReserve` (bottom padding) for the scroll room it needs.
                    // We deliberately do NOT take ChatScreen's `initialScrollAtEnd` /
                    // `alignItemsAtEnd` / `maintainScrollAtEnd`: a thread anchors on the tapped
                    // note via `initialScrollIndex` and must never auto-pin to the bottom.
                    maintainVisibleContentPosition={THREAD_MVCP}
                    onScroll={(e: { nativeEvent: { contentOffset: { y: number } } }) => {
                      const y = e.nativeEvent.contentOffset.y;
                      if (imageOverlay?.scrollOffsetY != null) imageOverlay.scrollOffsetY.value = y;
                      if (embed) embed.scrollY.value = y;
                      remeasureVisualLayoutScope(threadVisualScope, 'scroll', {
                        minIntervalMs: 500,
                        maxItems: 32,
                        extra: { eventId, scrollY: Math.round(y), replySort },
                      });
                    }}
                    scrollEventThrottle={16}
                    scrollEnabled={embed ? embed.listScrollEnabled : undefined}
                    initialScrollIndex={
                      !isLoading && fullTargetIndex > 0 ? fullTargetIndex : undefined
                    }
                  />
                </Animated.View>
                {/* Seed — tapped note + reply skeletons (no parents), shown underneath
                  until the real list has crossfaded in. Display-only (no scroll, no
                  handlers); kept mounted through the fade, then dropped. */}
                {seedHidden ? null : (
                  <View style={StyleSheet.absoluteFill} pointerEvents="none">
                    <LegendList
                      data={seedData}
                      keyExtractor={threadKeyExtractor}
                      getItemType={threadItemType}
                      getFixedItemSize={threadFixedItemSize}
                      estimatedItemSize={200}
                      drawDistance={500}
                      renderItem={renderItem}
                      recycleItems
                      scrollEnabled={false}
                      showsVerticalScrollIndicator={false}
                      style={styles.flexOne}
                      contentContainerStyle={{
                        paddingTop: 0,
                        paddingBottom: (replyBarHeight || 80) + 16,
                      }}
                    />
                  </View>
                )}
              </View>
            )}
          </ThreadEmbedSheet>
          {embed && targetEvent ? (
            <EmbedActionBar
              metrics={getDisplayMetrics(targetEvent.id)}
              liked={getEngagementState(targetEvent.id).liked}
              replied={getEngagementState(targetEvent.id).replied}
              reposted={getEngagementState(targetEvent.id).reposted}
              likePending={getEngagementState(targetEvent.id).likePending}
              repostPending={getEngagementState(targetEvent.id).repostPending}
              onCommentPress={onTargetComment}
              onRepostPress={onTargetRepost}
              onQuotePress={onTargetQuote}
              onLikePress={onTargetLike}
            />
          ) : null}
          <AnimatedImageOverlay />
        </View>
      </ImageOverlayProvider>
    </Log>
  );
}

function ThreadViewWithEmbed(props: ThreadViewProps) {
  return (
    <ThreadEmbedProvider>
      <ThreadViewInner {...props} />
    </ThreadEmbedProvider>
  );
}

export const ThreadView = React.memo(ThreadViewWithEmbed);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listWrap: {
    flex: 1,
  },
  flexOne: {
    flex: 1,
  },
  realLayer: {
    zIndex: 1,
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
