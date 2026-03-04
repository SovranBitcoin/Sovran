import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import { Avatar } from '@/shared/ui/primitives/Avatar';
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

import {
  type FeedEvent,
  type NoteMetrics,
  type ProfileInfo,
  formatTimestamp,
  tryNpubEncode,
  NoteContent,
  MetricsFooter,
  sharedStyles,
} from './nostr/shared';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

type PostCardVariant = 'feed' | 'repost-original' | 'thread-target' | 'thread-reply';

const AVATAR_SIZE = 36;

interface PostCardProps {
  event: FeedEvent;
  metrics: NoteMetrics;
  quotedEvents: Map<string, FeedEvent>;
  profiles: Map<string, ProfileInfo>;
  getMetrics: (eventId: string) => NoteMetrics;
  variant: PostCardVariant;

  showLineAbove?: boolean;
  showLineBelow?: boolean;

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
  reposted?: boolean;
  liked?: boolean;
  repostPending?: boolean;
  likePending?: boolean;
  repostPendingDirection?: 'activating' | 'deactivating';
  likePendingDirection?: 'activating' | 'deactivating';
  onNestedProfilePressIn?: () => void;
  onNestedProfilePressOut?: () => void;
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
  index = 0,
  skipAnimation = true,
  feedIndex,
  onOverlayOpenedFromIndex,
  onVideoTap,
  onCommentPress,
  onRepostPress,
  onLikePress,
  reposted = false,
  liked = false,
  repostPending = false,
  likePending = false,
  repostPendingDirection,
  likePendingDirection,
  onNestedProfilePressIn,
  onNestedProfilePressOut,
}: PostCardProps) {
  const [foreground, defaultColor] = useThemeColor(['foreground', 'default'] as const);

  const profile = profiles.get(event.pubkey);
  const displayName = profile?.name || `${tryNpubEncode(event.pubkey).slice(0, 12)}…`;
  const shortTime = event.created_at ? formatTimestamp(event.created_at) : '';

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
    router.navigate({
      pathname: '/(user-flow)/thread' as any,
      params: { eventId: event.id },
    });
  }, [event.id]);

  const navigateToProfile = useCallback(() => {
    router.navigate({
      pathname: '/(user-flow)/profile' as any,
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

  const tapGesture = useMemo(
    () =>
      Gesture.Tap().onEnd(() => {
        'worklet';
        runOnJS(handleThreadPress)();
      }),
    [handleThreadPress]
  );

  // ── Thread target: stacked layout (no gutter) ──
  if (isTarget) {
    const fullDate = event.created_at
      ? new Date(event.created_at * 1000).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })
      : '';
    const truncatedNpub = `${tryNpubEncode(event.pubkey).slice(0, 16)}…`;

    return (
      <View>
        <View style={pcStyles.targetRow}>
          <Pressable
            onPressIn={handleNestedPressIn}
            onPressOut={handleNestedPressOut}
            onPress={navigateToProfile}>
            <HStack align="center" gap={10} style={sharedStyles.mb6}>
              <Avatar
                picture={profile?.picture}
                seed={event.pubkey}
                size={AVATAR_SIZE}
                name={displayName}
              />
              <VStack style={sharedStyles.flex1}>
                <Text bold size={15} style={textPrimary} numberOfLines={1}>
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
    );
  }

  // ── Gutter layout (feed, repost-original, thread-reply) ──
  const hasConnectingBars = showLineAbove || showLineBelow;
  const lineColor = defaultColor;

  const gutterContent = (
    <View style={pcStyles.gutterRow}>
      <View style={pcStyles.gutterCol}>
        {showLineAbove ? (
          <View style={[pcStyles.lineAbove, { backgroundColor: lineColor }]} />
        ) : null}
        <Pressable
          onPressIn={handleNestedPressIn}
          onPressOut={handleNestedPressOut}
          onPress={navigateToProfile}>
          <Avatar
            picture={profile?.picture}
            seed={event.pubkey}
            size={AVATAR_SIZE}
            name={displayName}
          />
        </Pressable>
        {showLineBelow ? (
          <View style={[pcStyles.lineBelow, { backgroundColor: lineColor }]} />
        ) : null}
      </View>

      <View style={sharedStyles.flex1}>
        <HStack align="center" gap={6} style={sharedStyles.mb4}>
          <Pressable
            onPressIn={handleNestedPressIn}
            onPressOut={handleNestedPressOut}
            onPress={navigateToProfile}>
            <Text bold size={14} style={textPrimary} numberOfLines={isThread ? 1 : undefined}>
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

        <View style={pcStyles.inlineMetricsWrap}>
          <MetricsFooter
            metrics={metrics}
            borderColor={foreground}
            compact={isThread}
            showBorder={isThread ? !hasConnectingBars : true}
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
      <GestureDetector gesture={tapGesture}>
        <Reanimated.View style={animStyle}>{gutterContent}</Reanimated.View>
      </GestureDetector>
    );
  }

  if (isThread) {
    return <Pressable onPress={handleThreadPress}>{gutterContent}</Pressable>;
  }

  return gutterContent;
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
  inlineMetricsWrap: {
    marginLeft: -(AVATAR_SIZE + 12),
    marginRight: -16,
    paddingLeft: AVATAR_SIZE + 12,
    paddingRight: 16,
  },
  lineAbove: {
    position: 'absolute',
    top: 0,
    width: 2,
    height: AVATAR_SIZE / 2,
    borderRadius: 1,
  },
  lineBelow: {
    width: 2,
    flex: 1,
    marginTop: 6,
    borderRadius: 1,
  },
});
