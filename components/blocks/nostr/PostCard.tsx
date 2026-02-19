import React, { useCallback, useEffect, useMemo } from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from 'providers/ThemeProvider';
import { Text } from 'components/ui/Text';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import { Spacer } from 'components/ui/View/Spacer';
import { Avatar } from 'components/ui/Avatar';
import opacity from 'hex-color-opacity';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withTiming,
  interpolate,
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
} from './shared';

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

  onVideoTap?: (url: string) => void;
  onCommentPress?: () => void;
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
  onVideoTap,
  onCommentPress,
}: PostCardProps) {
  const { getPrimaryColor } = useTheme();

  const profile = profiles.get(event.pubkey);
  const displayName = profile?.name || `${tryNpubEncode(event.pubkey).slice(0, 12)}…`;
  const shortTime = event.created_at ? formatTimestamp(event.created_at) : '';

  const isTarget = variant === 'thread-target';
  const isThread = variant === 'thread-reply';
  const isFeed = variant === 'feed';

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
    router.push({
      pathname: '/(user-flow)/thread' as any,
      params: { eventId: event.id },
    });
  }, [event.id]);

  const navigateToProfile = useCallback(() => {
    router.push({
      pathname: '/(user-flow)/profile' as any,
      params: { pubkey: event.pubkey },
    });
  }, [event.pubkey]);

  // GPU-thread press feedback — gives instant visual response even when JS
  // thread is busy with navigation or data loading.
  const pressVal = useSharedValue(0);

  const tapGesture = useMemo(
    () =>
      Gesture.Tap()
        .onBegin(() => {
          'worklet';
          pressVal.set(withTiming(1, { duration: 80 }));
        })
        .onFinalize(() => {
          'worklet';
          pressVal.set(withTiming(0, { duration: 200 }));
        })
        .onEnd(() => {
          'worklet';
          runOnJS(navigateToThread)();
        }),
    [navigateToThread, pressVal]
  );

  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(pressVal.get(), [0, 1], [1, 0.98]) }],
    opacity: interpolate(pressVal.get(), [0, 1], [1, 0.85]),
  }));

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
          <TouchableOpacity activeOpacity={0.7} onPress={navigateToProfile}>
            <HStack align="center" gap={10} style={sharedStyles.mb6}>
              <Avatar
                picture={profile?.picture}
                seed={event.pubkey}
                size={AVATAR_SIZE}
                variant="person"
                name={displayName}
              />
              <VStack style={sharedStyles.flex1}>
                <Text
                  bold
                  size={15}
                  style={{ color: opacity(getPrimaryColor('0'), 0.9) }}
                  numberOfLines={1}>
                  {displayName}
                </Text>
                <Text semibold size={13} style={{ color: opacity(getPrimaryColor('0'), 0.4) }}>
                  {truncatedNpub}
                </Text>
              </VStack>
            </HStack>
          </TouchableOpacity>

          <NoteContent
            content={event.content}
            quotedEvents={quotedEvents}
            profiles={profiles}
            getMetrics={getMetrics}
            onVideoTap={onVideoTap}
          />

          {fullDate ? (
            <Text size={13} style={{ color: opacity(getPrimaryColor('0'), 0.4), marginTop: 10 }}>
              {fullDate}
            </Text>
          ) : null}
        </View>

        <View style={{ paddingHorizontal: 16 }}>
          <MetricsFooter
            metrics={metrics}
            borderColor={getPrimaryColor('0')}
            onCommentPress={onCommentPress ?? navigateToThread}
          />
        </View>
      </View>
    );
  }

  // ── Gutter layout (feed, repost-original, thread-reply) ──
  const hasConnectingBars = showLineAbove || showLineBelow;
  const lineColor = getPrimaryColor('600');

  const gutterContent = (
    <View style={pcStyles.gutterRow}>
      <View style={pcStyles.gutterCol}>
        {showLineAbove && <View style={[pcStyles.lineAbove, { backgroundColor: lineColor }]} />}
        <TouchableOpacity activeOpacity={0.7} onPress={navigateToProfile}>
          <Avatar
            picture={profile?.picture}
            seed={event.pubkey}
            size={AVATAR_SIZE}
            variant="person"
            name={displayName}
          />
        </TouchableOpacity>
        {showLineBelow && <View style={[pcStyles.lineBelow, { backgroundColor: lineColor }]} />}
      </View>

      <View style={sharedStyles.flex1}>
        <HStack align="center" gap={6} style={sharedStyles.mb4}>
          <Text
            bold
            size={14}
            style={{ color: opacity(getPrimaryColor('0'), 0.9) }}
            numberOfLines={isThread ? 1 : undefined}>
            {displayName}
          </Text>
          {shortTime ? (
            <>
              <Text
                bold
                size={13}
                style={{ color: opacity(getPrimaryColor('0'), 0.3), marginRight: 4 }}>
                {'•'}
              </Text>
              <Text size={13} style={{ color: opacity(getPrimaryColor('0'), 0.4) }}>
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
        />

        <Spacer size={8} />

        <View style={pcStyles.inlineMetricsWrap}>
          <MetricsFooter
            metrics={metrics}
            borderColor={getPrimaryColor('0')}
            compact={isThread}
            showBorder={isThread ? !hasConnectingBars : true}
            onCommentPress={isThread ? (onCommentPress ?? navigateToThread) : undefined}
          />
        </View>
      </View>
    </View>
  );

  if (isFeed) {
    return (
      <GestureDetector gesture={tapGesture}>
        <Reanimated.View style={[animStyle, pressStyle]}>{gutterContent}</Reanimated.View>
      </GestureDetector>
    );
  }

  if (isThread) {
    return (
      <TouchableOpacity activeOpacity={0.7} onPress={navigateToThread}>
        {gutterContent}
      </TouchableOpacity>
    );
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
    alignItems: 'center' as const,
  },
  targetRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  inlineMetricsWrap: {
    marginLeft: -(AVATAR_SIZE + 12),
    marginRight: -16,
    paddingLeft: AVATAR_SIZE + 12,
    paddingRight: 16,
  },
  lineAbove: {
    position: 'absolute' as const,
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
