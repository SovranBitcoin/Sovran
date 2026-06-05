import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { type LayoutChangeEvent, StyleSheet } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';

import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import Icon from '@/assets/icons';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Skeleton } from '@/shared/ui/primitives/Skeleton';
import opacity from 'hex-color-opacity';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withTiming,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import type { FeedEvent, NoteMetrics, ProfileInfo } from './feedTypes';
import { formatDate, formatRelative } from '@/shared/lib/date';
import { tryNpubEncode } from './feedParse';
import { NoteContent } from './NoteContent';
import { MetricsFooter } from './MetricsFooter';
import { SkeletonExitReveal, SkeletonLoadingShimmer } from './SkeletonExitShimmer';
import { sharedStyles } from './feedStyles';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { feedLog, Log } from '@/shared/lib/logger';
import { seedThread, type ThreadSeed } from '@/features/feed/lib/threadSeedCache';
import { alpha, iconSize, radius, spacing } from '@/shared/styles/tokens';
import {
  REPLY_SKELETON_VARIANTS,
  TARGET_SKELETON_VARIANT,
  type ReplySkeletonMatch,
} from '@/features/feed/lib/threadReplySkeletons';
import { THREAD_CONNECTOR_LINE_STYLE } from './threadConnectorStyle';

type PostCardVariant = 'feed' | 'repost-original' | 'thread-target' | 'thread-reply';

const AVATAR_SIZE = 36;

const METRIC_SKELETON_ITEMS = [0, 1, 2, 3] as const;

interface PostCardProps {
  event: FeedEvent;
  metrics: NoteMetrics;
  quotedEvents: Map<string, FeedEvent>;
  profiles: Map<string, ProfileInfo>;
  getMetrics: (eventId: string) => NoteMetrics;
  variant: PostCardVariant;

  showLineAbove?: boolean;
  showLineBelow?: boolean;
  showFooterBorder?: boolean;
  fullBleedFooterBorder?: boolean;

  index?: number;
  skipAnimation?: boolean;
  /** Feed list index (when in feed); used so swipe-up can scroll to next video post. */
  feedIndex?: number;
  /** Called when overlay is opened from this post so feed can track source index. */
  onOverlayOpenedFromIndex?: (index: number) => void;

  onVideoTap?: (url: string) => void;
  onCommentPress?: () => void;
  onRepostPress?: () => void;
  onLikePress?: () => void;
  onMorePress?: () => void;
  reposted?: boolean;
  liked?: boolean;
  repostPending?: boolean;
  likePending?: boolean;
  repostPendingDirection?: 'activating' | 'deactivating';
  likePendingDirection?: 'activating' | 'deactivating';
  onNestedProfilePressIn?: () => void;
  onNestedProfilePressOut?: () => void;
  skeletonMatch?: ReplySkeletonMatch;
  /**
   * Called immediately before navigating to this post's thread. Returns the
   * data the caller already has (visible parent chain via `allEvents`, plus
   * profile/metric/quoted-event maps) so the destination thread can render the
   * post optimistically. The tapped event itself is merged in automatically.
   */
  getThreadContext?: () => ThreadSeed | null;
  onMeasureHeight?: (eventId: string, height: number) => void;
  /**
   * Render in measurement-only mode: skip avatar image prefetch and force the
   * avatar into its loading skeleton. Used by the hidden measurement tree so
   * we don't fire 12 simultaneous network requests just to capture heights.
   * Has no effect on the rendered height (avatar dimensions are fixed).
   */
  measurementMode?: boolean;
}

export const PostCard = React.memo(function PostCard({
  event,
  metrics,
  quotedEvents,
  profiles,
  getMetrics,
  variant,
  showLineAbove = false,
  showLineBelow = false,
  showFooterBorder = true,
  fullBleedFooterBorder = false,
  index = 0,
  skipAnimation = true,
  feedIndex,
  onOverlayOpenedFromIndex,
  onVideoTap,
  onCommentPress,
  onRepostPress,
  onLikePress,
  onMorePress,
  reposted = false,
  liked = false,
  repostPending = false,
  likePending = false,
  repostPendingDirection,
  likePendingDirection,
  onNestedProfilePressIn,
  onNestedProfilePressOut,
  skeletonMatch,
  getThreadContext,
  onMeasureHeight,
  measurementMode = false,
}: PostCardProps) {
  const [foreground, defaultColor] = useThemeColor(['foreground', 'default'] as const);

  const profile = profiles.get(event.pubkey);
  // Real display name only. The abbreviated npub fallback is passed as Text's
  // `fallback` prop so the name never flashes through a pubkey placeholder.
  const displayName = profile?.name;
  const nameFallback = `${tryNpubEncode(event.pubkey).slice(0, 12)}…`;
  const shortTime = event.created_at ? formatRelative(event.created_at * 1000, 'compact') : '';

  const isTarget = variant === 'thread-target';
  const isThread = variant === 'thread-reply';
  const isFeed = variant === 'feed';

  // Pre-compute opacity color styles to avoid inline object creation
  const textPrimary = { color: opacity(foreground, 0.9) };
  const textMuted = { color: opacity(foreground, 0.4) };
  const textDimmed = { color: opacity(foreground, 0.3) };

  // Entry animation — only for feed variant on initial load
  const shouldAnimate = isFeed && !skipAnimation;
  const progress = useSharedValue(shouldAnimate ? 0 : 1);

  useEffect(() => {
    if (!shouldAnimate) return;
    progress.set(
      withDelay(
        Math.min(index * 60, 300),
        withTiming(1, { duration: 350, easing: Easing.out(Easing.cubic) })
      )
    );
  }, [progress, index, shouldAnimate]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ translateY: (1 - progress.get()) * 12 }],
  }));

  const navigateToThread = useCallback(() => {
    const ctx = getThreadContext?.() ?? null;
    const allEvents = new Map(ctx?.allEvents ?? []);
    allEvents.set(event.id, event);
    seedThread(event.id, {
      allEvents,
      profiles: ctx?.profiles ?? new Map(),
      metrics: ctx?.metrics ?? new Map(),
      quotedEvents: ctx?.quotedEvents ?? new Map(),
      replyPreviewEventIds: ctx?.replyPreviewEventIds,
    });
    router.push({
      pathname: '/(user-flow)/thread',
      params: { eventId: event.id },
    });
  }, [event, getThreadContext]);

  const navigateToProfile = useCallback(() => {
    // push so each profile pushes a new stack entry — see navigateToProfile.
    router.push({
      pathname: '/(user-flow)/profile',
      params: { pubkey: event.pubkey },
    });
  }, [event.pubkey]);

  const suppressThreadTapRef = useRef(false);

  const handleNestedPressIn = useCallback(() => {
    suppressThreadTapRef.current = true;
    onNestedProfilePressIn?.();
  }, [onNestedProfilePressIn]);

  const handleNestedPressOut = useCallback(() => {
    setTimeout(() => {
      suppressThreadTapRef.current = false;
    }, 0);
    onNestedProfilePressOut?.();
  }, [onNestedProfilePressOut]);

  const handleThreadPress = useCallback(() => {
    if (suppressThreadTapRef.current) return;
    navigateToThread();
  }, [navigateToThread]);

  const handleMorePress = useCallback(() => {
    onMorePress?.();
  }, [onMorePress]);

  const tapGesture = useMemo(
    () =>
      Gesture.Tap().onEnd(() => {
        'worklet';
        runOnJS(handleThreadPress)();
      }),
    [handleThreadPress]
  );

  const lastReplyLayoutHeightRef = useRef<number | null>(null);
  const handleReplyLayout = useCallback(
    (eventLayout: LayoutChangeEvent) => {
      if (!isThread) return;
      const height = Math.round(eventLayout.nativeEvent.layout.height);
      if (lastReplyLayoutHeightRef.current === height) return;
      lastReplyLayoutHeightRef.current = height;
      onMeasureHeight?.(event.id, height);
      feedLog.info('thread.reply_skeleton.reply_layout', {
        eventId: event.id,
        skeletonIndex: skeletonMatch?.skeletonIndex ?? null,
        skeletonLineCount: skeletonMatch?.skeletonLineCount ?? null,
        estimatedLineCount: skeletonMatch?.estimatedLineCount ?? null,
        lineDelta: skeletonMatch?.lineDelta ?? null,
        sortOriginalIndex: skeletonMatch?.originalIndex ?? null,
        sortSortedIndex: skeletonMatch?.sortedIndex ?? null,
        sortScore: skeletonMatch?.score ?? null,
        contentLength: event.content.length,
        contentPreview: skeletonMatch?.contentPreview,
        measuredHeight: height,
      });
    },
    [event.content.length, event.id, isThread, onMeasureHeight, skeletonMatch]
  );

  // ── Thread target: stacked layout (no gutter) ──
  if (isTarget) {
    const fullDate = event.created_at ? formatDate(event.created_at * 1000, 'short-date-time') : '';
    const truncatedNpub = `${tryNpubEncode(event.pubkey).slice(0, 16)}…`;

    return (
      <Log name="PostCard">
        <View>
          <View style={pcStyles.targetRow}>
            <Pressable
              onPressIn={handleNestedPressIn}
              onPressOut={handleNestedPressOut}
              onPress={navigateToProfile}>
              <HStack align="center" gap={10} style={sharedStyles.mb6}>
                <Avatar
                  state={profile?.picture ? 'image' : 'fallback'}
                  picture={profile?.picture}
                  seed={event.pubkey}
                  size={AVATAR_SIZE}
                  name={displayName}
                />
                <VStack style={sharedStyles.flex1}>
                  <Text
                    bold
                    size={15}
                    style={textPrimary}
                    numberOfLines={1}
                    fallback={nameFallback}>
                    {displayName}
                  </Text>
                  <Text semibold size={13} style={textMuted}>
                    {truncatedNpub}
                  </Text>
                </VStack>
              </HStack>
            </Pressable>

            <NoteContent
              content={event.content}
              quotedEvents={quotedEvents}
              profiles={profiles}
              getMetrics={getMetrics}
              event={event}
              onVideoTap={onVideoTap}
              onQuotedPressIn={handleNestedPressIn}
              onQuotedPressOut={handleNestedPressOut}
              onInlineActionPressIn={handleNestedPressIn}
              onInlineActionPressOut={handleNestedPressOut}
            />

            {fullDate ? (
              <Text size={13} style={[textMuted, pcStyles.targetDate]}>
                {fullDate}
              </Text>
            ) : null}
          </View>

          <View style={pcStyles.targetMetrics}>
            <MetricsFooter
              metrics={metrics}
              borderColor={foreground}
              onCommentPress={onCommentPress ?? navigateToThread}
              onRepostPress={onRepostPress}
              onLikePress={onLikePress}
              reposted={reposted}
              liked={liked}
              repostPending={repostPending}
              likePending={likePending}
              repostPendingDirection={repostPendingDirection}
              likePendingDirection={likePendingDirection}
              onActionPressIn={handleNestedPressIn}
              onActionPressOut={handleNestedPressOut}
            />
          </View>
        </View>
      </Log>
    );
  }

  // ── Gutter layout (feed, repost-original, thread-reply) ──
  const hasConnectingBars = showLineAbove || showLineBelow;
  const showMetricsBorder = showFooterBorder && (isThread ? !hasConnectingBars : true);
  const lineColor = defaultColor;

  const gutterContent = (
    <View style={pcStyles.gutterRow}>
      <View style={pcStyles.gutterCol}>
        {showLineAbove ? (
          <View
            style={[
              pcStyles.lineAbove,
              THREAD_CONNECTOR_LINE_STYLE,
              { borderLeftColor: lineColor },
            ]}
          />
        ) : null}
        <Pressable
          onPressIn={handleNestedPressIn}
          onPressOut={handleNestedPressOut}
          onPress={navigateToProfile}>
          <Avatar
            state={measurementMode ? 'loading' : profile?.picture ? 'image' : 'fallback'}
            picture={measurementMode ? undefined : profile?.picture}
            seed={event.pubkey}
            size={AVATAR_SIZE}
            name={displayName}
          />
        </Pressable>
        {showLineBelow ? (
          <View
            style={[
              pcStyles.lineBelow,
              THREAD_CONNECTOR_LINE_STYLE,
              { borderLeftColor: lineColor },
            ]}
          />
        ) : null}
      </View>

      <View style={sharedStyles.flex1}>
        <HStack align="center" gap={6} style={sharedStyles.mb4}>
          <HStack align="center" gap={6} style={pcStyles.headerTextRow}>
            <Pressable
              onPressIn={handleNestedPressIn}
              onPressOut={handleNestedPressOut}
              onPress={navigateToProfile}>
              <Text
                bold
                size={14}
                style={textPrimary}
                numberOfLines={isThread ? 1 : undefined}
                fallback={nameFallback}>
                {displayName}
              </Text>
            </Pressable>
            {shortTime ? (
              <>
                <Text bold size={13} style={[textDimmed, pcStyles.dotSeparator]}>
                  {'•'}
                </Text>
                <Text size={13} style={textMuted}>
                  {shortTime}
                </Text>
              </>
            ) : null}
          </HStack>
          {onMorePress ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="More post actions"
              onPressIn={handleNestedPressIn}
              onPressOut={handleNestedPressOut}
              onPress={handleMorePress}
              haptics
              style={pcStyles.moreButton}>
              <Icon name="tabler:dots" size={18} color={opacity(foreground, 0.5)} />
            </Pressable>
          ) : null}
        </HStack>

        <NoteContent
          content={event.content}
          quotedEvents={quotedEvents}
          profiles={profiles}
          getMetrics={getMetrics}
          onVideoTap={onVideoTap}
          onQuotedPressIn={handleNestedPressIn}
          onQuotedPressOut={handleNestedPressOut}
          onInlineActionPressIn={handleNestedPressIn}
          onInlineActionPressOut={handleNestedPressOut}
          onImagePressIn={handleNestedPressIn}
          onImagePressOut={handleNestedPressOut}
          event={event}
          metrics={metrics}
          profile={profile}
          feedIndex={feedIndex}
          onOverlayOpenedFromIndex={onOverlayOpenedFromIndex}
          reposted={reposted}
          liked={liked}
          repostPending={repostPending}
          likePending={likePending}
          repostPendingDirection={repostPendingDirection}
          likePendingDirection={likePendingDirection}
          onCommentPress={onCommentPress ?? navigateToThread}
          onRepostPress={onRepostPress}
          onLikePress={onLikePress}
          onActionPressIn={handleNestedPressIn}
          onActionPressOut={handleNestedPressOut}
        />

        <Spacer size={8} />

        <View
          style={[
            fullBleedFooterBorder
              ? pcStyles.inlineMetricsWrapFullBleed
              : pcStyles.inlineMetricsWrap,
            fullBleedFooterBorder && showMetricsBorder && pcStyles.inlineMetricsWrapFullBleedBorder,
            fullBleedFooterBorder &&
              showMetricsBorder && { borderBottomColor: opacity(foreground, 0.1) },
          ]}>
          <MetricsFooter
            metrics={metrics}
            borderColor={foreground}
            compact={isThread}
            showBorder={!fullBleedFooterBorder && showMetricsBorder}
            onCommentPress={isThread ? (onCommentPress ?? navigateToThread) : undefined}
            onRepostPress={onRepostPress}
            onLikePress={onLikePress}
            reposted={reposted}
            liked={liked}
            repostPending={repostPending}
            likePending={likePending}
            repostPendingDirection={repostPendingDirection}
            likePendingDirection={likePendingDirection}
            onActionPressIn={handleNestedPressIn}
            onActionPressOut={handleNestedPressOut}
          />
        </View>
      </View>
    </View>
  );

  if (isFeed) {
    return (
      <Log name="PostCard">
        <GestureDetector gesture={tapGesture}>
          <Reanimated.View style={animStyle}>{gutterContent}</Reanimated.View>
        </GestureDetector>
      </Log>
    );
  }

  if (isThread) {
    return (
      <Log name="PostCard">
        <Pressable onPress={handleThreadPress} onLayout={handleReplyLayout}>
          {gutterContent}
        </Pressable>
      </Log>
    );
  }

  return <Log name="PostCard">{gutterContent}</Log>;
});

export const PostCardSkeleton = React.memo(function PostCardSkeleton({
  variant,
  index = 0,
  exiting = false,
  onMeasureHeight,
}: {
  variant: Extract<PostCardVariant, 'thread-target' | 'thread-reply'>;
  index?: number;
  exiting?: boolean;
  onMeasureHeight?: (skeletonIndex: number, height: number) => void;
}) {
  const foreground = useThemeColor('foreground');
  const textMuted = useMemo(() => ({ color: opacity(foreground, alpha.muted) }), [foreground]);
  const targetDateStyle = useMemo(() => [textMuted, pcStyles.targetDate], [textMuted]);
  const replyVariant = REPLY_SKELETON_VARIANTS[index % REPLY_SKELETON_VARIANTS.length];
  const lastSkeletonLayoutHeightRef = useRef<number | null>(null);

  const handleSkeletonLayout = useCallback(
    (eventLayout: LayoutChangeEvent) => {
      if (variant !== 'thread-reply') return;
      const height = Math.round(eventLayout.nativeEvent.layout.height);
      if (lastSkeletonLayoutHeightRef.current === height) return;
      lastSkeletonLayoutHeightRef.current = height;
      onMeasureHeight?.(index, height);
      feedLog.info('thread.reply_skeleton.skeleton_layout', {
        skeletonIndex: index,
        skeletonLineCount: replyVariant.content.length,
        contentPlaceholders: replyVariant.content,
        authorPlaceholder: replyVariant.author,
        timestampPlaceholder: replyVariant.timestamp,
        metricWidth: replyVariant.metricWidth,
        measuredHeight: height,
      });
    },
    [index, onMeasureHeight, replyVariant, variant]
  );

  if (variant === 'thread-target') {
    const skeletonVariant = TARGET_SKELETON_VARIANT;

    return (
      <View>
        <View style={pcStyles.targetRow} pointerEvents="none">
          <HStack align="center" gap={spacing.sm + 2} style={sharedStyles.mb6}>
            <Avatar state="loading" size={AVATAR_SIZE} />
            <VStack style={sharedStyles.flex1}>
              <Text loading placeholder={skeletonVariant.author} bold size={15} />
              <Text
                loading
                placeholder={skeletonVariant.npub}
                semibold
                size={13}
                style={textMuted}
              />
            </VStack>
          </HStack>

          <VStack spacing={0}>
            {skeletonVariant.content.map((line) => (
              <Text key={line} loading placeholder={line} size={15} style={pcStyles.noteTextLine} />
            ))}
          </VStack>

          <Text loading placeholder={skeletonVariant.date} size={13} style={targetDateStyle} />
        </View>

        <View style={pcStyles.targetMetrics}>
          <MetricsFooterSkeleton
            compact={false}
            borderColor={foreground}
            labelWidth={skeletonVariant.metricWidth}
          />
        </View>
        <SkeletonLoadingShimmer active />
      </View>
    );
  }

  const skeletonVariant = replyVariant;

  return (
    <View onLayout={handleSkeletonLayout}>
      <SkeletonExitReveal active={exiting}>
        <View style={pcStyles.gutterRow} pointerEvents="none">
          <View style={pcStyles.gutterCol}>
            <Avatar state="loading" size={AVATAR_SIZE} />
          </View>

          <View style={sharedStyles.flex1}>
            <HStack align="center" gap={spacing.sm - 2} style={sharedStyles.mb4}>
              <Text loading placeholder={skeletonVariant.author} bold size={14} />
              <Text loading placeholder={skeletonVariant.timestamp} size={13} style={textMuted} />
            </HStack>

            <VStack spacing={0}>
              {skeletonVariant.content.map((line) => (
                <Text
                  key={line}
                  loading
                  placeholder={line}
                  size={15}
                  style={pcStyles.noteTextLine}
                />
              ))}
            </VStack>

            <Spacer size={spacing.sm} />

            <View style={pcStyles.inlineMetricsWrap}>
              <MetricsFooterSkeleton
                compact
                borderColor={foreground}
                labelWidth={skeletonVariant.metricWidth}
              />
            </View>
          </View>
        </View>
      </SkeletonExitReveal>
      <SkeletonLoadingShimmer active={!exiting} />
    </View>
  );
});

const MetricsFooterSkeleton = React.memo(function MetricsFooterSkeleton({
  compact,
  borderColor,
  labelWidth,
}: {
  compact: boolean;
  borderColor: string;
  labelWidth: number;
}) {
  const glyph = compact ? 13 : iconSize.md;
  const labelHeight = compact ? 14 : spacing.md;
  const skeletonFill = useMemo(() => opacity(borderColor, 0.07), [borderColor]);
  const footerStyle = useMemo(
    () => [
      sharedStyles.noteFooter,
      sharedStyles.footerBorder,
      { borderBottomColor: opacity(borderColor, alpha.faint) },
    ],
    [borderColor]
  );
  const glyphStyle = useMemo(
    () => ({
      width: glyph,
      height: glyph,
      borderRadius: radius.sm,
      backgroundColor: skeletonFill,
    }),
    [glyph, skeletonFill]
  );
  const labelStyle = useMemo(
    () => ({
      width: labelWidth,
      height: labelHeight,
      borderRadius: radius.sm,
      backgroundColor: skeletonFill,
    }),
    [labelHeight, labelWidth, skeletonFill]
  );

  return (
    <View style={footerStyle} pointerEvents="none">
      <HStack align="center" justify="space-between">
        {METRIC_SKELETON_ITEMS.map((item) => (
          <HStack key={item} align="center" gap={spacing.xs}>
            <Skeleton style={glyphStyle} />
            {item < 3 ? <Skeleton style={labelStyle} /> : null}
          </HStack>
        ))}
      </HStack>
    </View>
  );
});

const pcStyles = StyleSheet.create({
  gutterRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  gutterCol: {
    width: AVATAR_SIZE,
    alignItems: 'center',
  },
  targetRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  targetDate: {
    marginTop: 10,
  },
  targetMetrics: {
    paddingHorizontal: 16,
  },
  dotSeparator: {
    marginRight: 4,
  },
  headerTextRow: {
    flex: 1,
    minWidth: 0,
  },
  moreButton: {
    width: 30,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -4,
    marginRight: -6,
    borderRadius: 14,
  },
  inlineMetricsWrap: {
    marginLeft: -(AVATAR_SIZE + 12),
    marginRight: -16,
    paddingLeft: AVATAR_SIZE + 12,
    paddingRight: 16,
  },
  inlineMetricsWrapFullBleed: {
    marginLeft: -(AVATAR_SIZE + 12 + 16),
    marginRight: -16,
    paddingLeft: AVATAR_SIZE + 12 + 16,
    paddingRight: 16,
  },
  inlineMetricsWrapFullBleedBorder: {
    borderBottomWidth: 1,
    paddingBottom: 10,
  },
  noteTextLine: {
    lineHeight: 22,
  },
  lineAbove: {
    position: 'absolute',
    top: 0,
    left: AVATAR_SIZE / 2 - 1,
    height: AVATAR_SIZE / 2,
  },
  lineBelow: {
    flex: 1,
    marginTop: 6,
  },
});
