/**
 * @fileoverview Thread View Component
 *
 * Displays a Nostr post in detail with its reply chain (parents above,
 * replies below). Pure renderer — data acquisition lives in `useThread`.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { FlashList } from '@shopify/flash-list';
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
import type { ThreadReplySort } from '@/features/feed/data/feedClient';
import { useNostrEngagement } from '@/features/feed/hooks/useNostrEngagement';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { feedLog, Log } from '@/shared/lib/logger';
import { actionMenuPopup } from '@/shared/lib/popup';
import {
  DEFAULT_REPLY_SKELETON_COUNT,
  MAX_REPLY_SKELETON_COUNT,
} from '@/features/feed/lib/threadReplySkeletons';

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

// When a reply's real content loads it fades in over the skeleton it replaces.
// The ENTER animation is recycling-tolerant on FlashList (it plays at the cell's
// correct spot and doesn't re-fire on scroll, since recycled cells reuse the
// instance), so the skeleton it replaces simply unmounts without an exit fade.
const REPLY_FADE_IN = FadeIn.duration(220);

// Rough per-row height used only to discount the content already below the
// focused note when sizing the focus reserve (see `focusReserve`). Deliberately
// approximate — it just keeps the reserve from over-padding long threads.
const FOCUS_RESERVE_ROW_APPROX = 150;

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
  const activeBg = opacity(surfaceTertiary, 0.5);
  const pressedBg = opacity(surfaceTertiary, 0.65);
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
  const imageOverlay = useImageOverlay();
  const embed = useThreadEmbed();
  const embedOpen = embed?.open;
  const targetFooterOpacity = embed?.targetFooterOpacity;
  const [replyBarHeight, setReplyBarHeight] = useState(0);

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

  const targetItem = useMemo(() => items.find((item) => item.type === 'target'), [items]);
  const hasParents = items.some((i) => i.type === 'parent');

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

  // The note's index in the list (parents precede it; replies/skeletons follow) —
  // for the focus reserve and the initial landing.
  const fullTargetIndex = useMemo(
    () => displayItems.findIndex((i) => i.type === 'target'),
    [displayItems]
  );

  // Focus reserve: extra bottom space so the tapped reply can always be scrolled
  // to (and held at) the top of the viewport, even when little content sits below
  // it. Opening a thread on a reply lands a tall parent chain above the note; with
  // no room below, the scroll bottoms out (clamps/snaps) and the note can't be
  // refocused, and `maintainVisibleContentPosition` has nowhere to scroll to hold
  // it as the parent grows. We reserve `viewport − (content already below the
  // note)`, so the reserve is generous on short threads and shrinks toward 0 as
  // replies fill the screen (no dead gap on long threads). Owned here (as plain
  // bottom padding) so it's deterministic, hot-reloadable, and logged.
  // `fullTargetIndex` indexes `displayItems` — the sort-tabs row is inserted
  // after the target and skeletons are appended last.
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

  const actionableEvents = items.map((item) => item.event);
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
    ({ item, index }: { item: ThreadListItem; index: number }) => {
      if (item.type === 'target-skeleton') {
        return <PostCardSkeleton variant="thread-target" index={index} />;
      }

      if (item.type === 'reply-skeleton') {
        // FlashList recycles cells, which fights reanimated exit animations — an
        // exiting skeleton renders in a recycled cell's position for a frame (the
        // "skeleton in the wrong place" glitch), so the skeleton simply unmounts
        // and the real reply fades IN over it (see REPLY_FADE_IN below).
        return <PostCardSkeleton variant="thread-reply" index={item.skeletonIndex} />;
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

      // Each reply fades its real content in as it loads. The ENTER animation is
      // recycling-tolerant on FlashList (it plays at the cell's correct spot and
      // doesn't re-fire on scroll, since recycled cells reuse the instance) — unlike
      // a skeleton EXIT, which lingered in a recycled cell's slot (the "wrong
      // place" glitch), so the reply only ever fades IN.
      if (item.type === 'reply') {
        return <Animated.View entering={REPLY_FADE_IN}>{card}</Animated.View>;
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

  const handleEndReached = useCallback(() => {
    // Don't start reply pagination while the initial fetch is running — the
    // footer spinner would otherwise overlap the loading skeletons.
    if (isFetching) return;
    void loadMoreReplies();
  }, [loadMoreReplies, isFetching]);

  // FlashList re-renders rows when `data` changes by reference or when `extraData`
  // changes. Engagement (likes/reposts), pagination flags and the sort live outside
  // `displayItems`, so fold them into extraData so those updates repaint the rows.
  const threadExtraData = useMemo(
    () =>
      [
        dataVersion,
        engagementRevision,
        isFetching ? 1 : 0,
        isLoadingMoreReplies ? 1 : 0,
        hasMoreReplies ? 1 : 0,
        replySort,
      ].join(':'),
    [dataVersion, engagementRevision, isFetching, isLoadingMoreReplies, hasMoreReplies, replySort]
  );

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
            {/* FlashList v2 holds the tapped note via synchronous Fabric layout +
              its default maintainVisibleContentPosition — no two-list crossfade,
              counter-scroll or reply gating needed. The one non-library-specific
              piece we keep is `focusReserve`: extra bottom padding so the anchored
              note has REAL scroll room below it; without it mVCP anchors past the
              scroll bounds and the first gesture snaps to top/bottom. The thread
              anchors on the tapped note via `initialScrollIndex` and must never
              auto-pin to the bottom (so no `startRenderingFromBottom`). */}
            <FlashList
              data={displayItems}
              keyExtractor={threadKeyExtractor}
              getItemType={threadItemType}
              renderItem={renderThreadItem}
              extraData={threadExtraData}
              drawDistance={500}
              onEndReached={handleEndReached}
              onEndReachedThreshold={0.4}
              ListFooterComponent={
                isLoadingMoreReplies ? (
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
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{
                // The embed sheet starts just below the header, so the list pads no
                // top. `replyBarHeight` already includes the bottom safe-area inset;
                // `focusReserve` adds the room below the note (see its definition).
                paddingTop: 0,
                paddingBottom: (replyBarHeight || 80) + 16 + focusReserve,
              }}
              onScroll={(e) => {
                const y = e.nativeEvent.contentOffset.y;
                if (imageOverlay?.scrollOffsetY != null) imageOverlay.scrollOffsetY.value = y;
                if (embed) embed.scrollY.value = y;
              }}
              scrollEventThrottle={16}
              scrollEnabled={embed ? embed.listScrollEnabled : undefined}
              initialScrollIndex={!isLoading && fullTargetIndex > 0 ? fullTargetIndex : undefined}
            />
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
