import React from 'react';
import opacity from 'hex-color-opacity';
import { alpha } from '@/shared/styles/tokens';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { actionMenuPopup } from '@/shared/lib/popup/popups/actionMenu';
import type { NoteMetrics } from './feedTypes';
import { formatCount, formatSats } from './feedFormat';
import { sharedStyles } from './feedStyles';

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
  onLikePress,
  reposted = false,
  liked = false,
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
  onLikePress?: () => void;
  reposted?: boolean;
  liked?: boolean;
  repostPending?: boolean;
  likePending?: boolean;
  repostPendingDirection?: 'activating' | 'deactivating';
  likePendingDirection?: 'activating' | 'deactivating';
  onActionPressIn?: () => void;
  onActionPressOut?: () => void;
}) {
  const repostedColor = useThemeColor('success');
  const iconColor = opacity(borderColor, alpha.disabled);
  const textColor = opacity(borderColor, alpha.disabled);
  const likedColor = '#ff5a7a';
  const iconSize = compact ? 13 : 16;
  const textSize = compact ? 11 : 13;

  // The repost button opens a menu offering a plain repost or a quote. Quote is
  // disabled/greyed-out for now.
  const handleRepostPress = React.useCallback(() => {
    if (!onRepostPress) return;
    actionMenuPopup({
      title: 'Repost',
      buttons: [
        {
          text: reposted ? 'Undo repost' : 'Repost',
          icon: 'garden:arrow-retweet-fill-16',
          onPress: (close) => {
            close();
            onRepostPress();
          },
        },
        {
          text: 'Quote',
          icon: 'mdi:format-quote-close',
          disabled: true,
          reason: 'Coming soon',
          onPress: (close) => close(),
        },
      ],
    });
  }, [onRepostPress, reposted]);

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
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}>
          <HStack align="center" gap={5}>
            <Icon name="iconamoon:comment-fill" size={iconSize - 1} color={iconColor} />
            <Text size={textSize} style={{ color: textColor }}>
              {formatCount(metrics.replyCount)}
            </Text>
          </HStack>
        </Pressable>
        <Pressable
          onPress={handleRepostPress}
          disabled={!onRepostPress || repostPending}
          onPressIn={onActionPressIn}
          onPressOut={onActionPressOut}
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}>
          <AnimatedMetric
            iconName="garden:arrow-retweet-fill-16"
            iconSize={iconSize + 1}
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
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}>
          <AnimatedMetric
            iconName="iconamoon:heart-fill"
            iconSize={iconSize}
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
            <Icon name="mingcute:lightning-fill" size={iconSize} color={iconColor} />
            <Text overpass size={textSize} style={{ color: textColor }}>
              {formatSats(metrics.satsZapped)}
            </Text>
          </HStack>
        ) : (
          <Icon name="mingcute:lightning-fill" size={iconSize} color={iconColor} />
        )}
      </HStack>
    </View>
  );
});
