/**
 * @fileoverview Thread View Component
 *
 * Displays a Nostr post in detail with its reply chain (parents above,
 * replies below). Pure renderer — data acquisition lives in `useThread`.
 */

import React, { useCallback, useMemo } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { LegendList, type LegendListRenderItemProps } from '@legendapp/list';
import { useHeaderHeight } from '@react-navigation/elements';
import opacity from 'hex-color-opacity';

import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import Icon from 'assets/icons';

import { type NoteMetrics, DEFAULT_METRICS } from './nostr/shared';
import { PostCard } from './nostr/PostCard';
import { ImageOverlayProvider, useImageOverlay, AnimatedImageOverlay } from './nostr/image-overlay';

import { useThread, type ThreadItem } from '@/features/feed/hooks/useThread';
import { useNostrEngagement } from '@/features/feed/hooks/useNostrEngagement';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Log } from '@/shared/lib/logger';

interface ThreadViewProps {
  eventId: string;
}

function threadKeyExtractor(item: ThreadItem): string {
  switch (item.type) {
    case 'parent':
      return `p_${item.event.id}`;
    case 'target':
      return `t_${item.event.id}`;
    case 'reply':
      return `r_${item.event.id}`;
  }
}

function threadItemType(item: ThreadItem): string {
  return item.type;
}

function ThreadViewInner({ eventId }: ThreadViewProps) {
  const [foreground, background, mutedColor, defaultColor] = useThemeColor([
    'foreground',
    'background',
    'muted',
    'default',
  ] as const);
  const headerHeight = useHeaderHeight();
  const imageOverlay = useImageOverlay();

  const {
    items,
    hiddenReplyCount,
    isLoading,
    error,
    dataVersion,
    profilesRef,
    metricsRef,
    quotedEventsRef,
  } = useThread(eventId);

  const targetIndex = useMemo(() => items.findIndex((item) => item.type === 'target'), [items]);
  const hasParents = useMemo(() => items.some((i) => i.type === 'parent'), [items]);

  const getMetrics = useCallback(
    (id: string): NoteMetrics => metricsRef.current.get(id) || DEFAULT_METRICS,
    [metricsRef]
  );

  const actionableEvents = useMemo(() => items.map((item) => item.event), [items]);
  const { getDisplayMetrics, getEngagementState, toggleLike, toggleRepost, engagementRevision } =
    useNostrEngagement(actionableEvents, getMetrics);

  const renderItem = useCallback(
    ({ item, index }: LegendListRenderItemProps<ThreadItem, string | undefined>) => {
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
          onLikePress={() => toggleLike(item.event)}
          onRepostPress={() => toggleRepost(item.event)}
        />
      );
    },
    [
      getDisplayMetrics,
      getEngagementState,
      getMetrics,
      hasParents,
      profilesRef,
      quotedEventsRef,
      toggleLike,
      toggleRepost,
    ]
  );

  if (isLoading) {
    return (
      <View
        style={[
          styles.container,
          styles.centerContent,
          { backgroundColor: background, paddingTop: headerHeight },
        ]}>
        <ActivityIndicator size="small" color={mutedColor} />
      </View>
    );
  }

  if (error) {
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
            data={items}
            keyExtractor={threadKeyExtractor}
            getItemType={threadItemType}
            estimatedItemSize={200}
            drawDistance={500}
            renderItem={renderItem}
            extraData={`${dataVersion}:${engagementRevision}`}
            recycleItems
            ListFooterComponent={
              hiddenReplyCount > 0 ? (
                <View style={styles.hiddenReplyFooter}>
                  <Text size={13} style={{ color: opacity(foreground, 0.4) }}>
                    {hiddenReplyCount} more {hiddenReplyCount === 1 ? 'reply' : 'replies'} not
                    loaded
                  </Text>
                </View>
              ) : null
            }
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
            initialScrollIndex={targetIndex > 0 ? targetIndex : undefined}
          />
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
});
