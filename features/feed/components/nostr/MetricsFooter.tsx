import React from 'react';
import opacity from 'hex-color-opacity';
import { alpha, iconSize } from '@/shared/styles/tokens';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { openRepostMenu } from '@/features/feed/lib/repostMenu';
import type { NoteMetrics } from './feedTypes';
import { formatCount, formatSats } from './feedFormat';
import { sharedStyles } from './feedStyles';

export const POST_ACTION_ICON_SIZES = {
  compact: {
    base: iconSize.md,
    comment: iconSize.md - 1,
    repost: iconSize.md + 1,
  },
  regular: {
    base: iconSize.lg,
    comment: iconSize.lg - 1,
    repost: iconSize.lg + 1,
  },
} as const;

const AnimatedMetric = React.memo(function AnimatedMetric({
  iconName,
  iconSize,
  text,
  inactiveColor,
  activeColor,
  textSize,
  isActive,
  pending: _pending,
}: {
  iconName: string;
  iconSize: number;
  text: string;
  inactiveColor: string;
  activeColor: string;
  textSize: number;
  isActive: boolean;
  pending: boolean;
}) {
  const color = isActive ? activeColor : inactiveColor;
  return (
    <HStack align="center" gap={5}>
      <Icon name={iconName} size={iconSize} color={color} />
      <Text size={textSize} style={{ color }}>
        {text}
      </Text>
    </HStack>
  );
});

export const MetricsFooter = React.memo(function MetricsFooter({
  metrics,
  borderColor,
  compact = false,
  showBorder = true,
  onCommentPress,
  onRepostPress,
  onQuotePress,
  onLikePress,
  reposted = false,
  liked = false,
  replied = false,
  repostPending = false,
  likePending = false,
  repostPendingDirection: _repostPendingDirection,
  likePendingDirection: _likePendingDirection,
  onActionPressIn,
  onActionPressOut,
}: {
  metrics: NoteMetrics;
  borderColor: string;
  compact?: boolean;
  showBorder?: boolean;
  onCommentPress?: () => void;
  onRepostPress?: () => void;
  onQuotePress?: () => void;
  onLikePress?: () => void;
  reposted?: boolean;
  liked?: boolean;
  replied?: boolean;
  repostPending?: boolean;
  likePending?: boolean;
  repostPendingDirection?: 'activating' | 'deactivating';
  likePendingDirection?: 'activating' | 'deactivating';
  onActionPressIn?: () => void;
  onActionPressOut?: () => void;
}) {
  const repostedColor = useThemeColor('success');
  const repliedColor = useThemeColor('link');
  const iconColor = opacity(borderColor, alpha.disabled);
  const textColor = opacity(borderColor, alpha.disabled);
  const likedColor = '#ff5a7a';
  const iconSizes = compact ? POST_ACTION_ICON_SIZES.compact : POST_ACTION_ICON_SIZES.regular;
  const textSize = compact ? 11 : 13;

  // The repost button opens the shared Repost-or-Quote menu. Quote is greyed out
  // when no `onQuotePress` is supplied.
  const handleRepostPress = React.useCallback(() => {
    if (!onRepostPress) return;
    openRepostMenu({ reposted, onRepost: onRepostPress, onQuote: onQuotePress });
  }, [onRepostPress, onQuotePress, reposted]);

  return (
    <View
      style={[
        sharedStyles.noteFooter,
        showBorder && sharedStyles.footerBorder,
        showBorder && { borderBottomColor: opacity(borderColor, 0.1) },
      ]}>
      <HStack align="center" justify="space-between">
        <Pressable
          onPress={onCommentPress}
          disabled={!onCommentPress}
          onPressIn={onActionPressIn}
          onPressOut={onActionPressOut}
          accessibilityRole="button"
          accessibilityLabel={`${replied ? 'Replied' : 'Reply'}, ${metrics.replyCount} replies`}
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}>
          <AnimatedMetric
            iconName="iconamoon:comment-fill"
            iconSize={iconSizes.comment}
            text={formatCount(metrics.replyCount)}
            inactiveColor={textColor}
            activeColor={repliedColor}
            textSize={textSize}
            isActive={replied}
            pending={false}
          />
        </Pressable>
        <Pressable
          onPress={handleRepostPress}
          disabled={!onRepostPress || repostPending}
          onPressIn={onActionPressIn}
          onPressOut={onActionPressOut}
          accessibilityRole="button"
          accessibilityLabel={`${reposted ? 'Reposted' : 'Repost'}, ${metrics.repostCount} reposts`}
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}>
          <AnimatedMetric
            iconName="garden:arrow-retweet-fill-16"
            iconSize={iconSizes.repost}
            text={formatCount(metrics.repostCount)}
            inactiveColor={textColor}
            activeColor={repostedColor}
            textSize={textSize}
            isActive={reposted}
            pending={repostPending}
          />
        </Pressable>
        <Pressable
          onPress={onLikePress}
          disabled={!onLikePress || likePending}
          onPressIn={onActionPressIn}
          onPressOut={onActionPressOut}
          accessibilityRole="button"
          accessibilityLabel={`${liked ? 'Liked' : 'Like'}, ${metrics.likeCount} likes`}
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}>
          <AnimatedMetric
            iconName="iconamoon:heart-fill"
            iconSize={iconSizes.base}
            text={formatCount(metrics.likeCount)}
            inactiveColor={textColor}
            activeColor={likedColor}
            textSize={textSize}
            isActive={liked}
            pending={likePending}
          />
        </Pressable>
        {metrics.satsZapped > 0 ? (
          <HStack align="center" gap={4}>
            <Icon name="mingcute:lightning-fill" size={iconSizes.base} color={iconColor} />
            <Text overpass size={textSize} style={{ color: textColor }}>
              {formatSats(metrics.satsZapped)}
            </Text>
          </HStack>
        ) : (
          <Icon name="mingcute:lightning-fill" size={iconSizes.base} color={iconColor} />
        )}
      </HStack>
    </View>
  );
});
