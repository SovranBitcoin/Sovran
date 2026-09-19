import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Keyframe,
  LayoutAnimationConfig,
  useReducedMotion,
} from 'react-native-reanimated';

import { withAlpha } from '@/shared/lib/color';
import { duration, iconSize, spacing } from '@/shared/styles/tokens';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { PressScale } from '@/shared/ui/primitives/PressScale';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { COMMENT_ACCENT, LIKE_ACCENT, ZAP_ACCENT } from '@/shared/lib/brandColors';
import { openRepostMenu } from '@/features/feed/lib/repostMenu';
import { POST_FONT_FAMILY, postInk, postType } from '@/features/feed/lib/postTypography';
import type { NoteMetrics } from './feedTypes';
import {
  formatCount,
  formatSats,
  likeActionLabel,
  replyActionLabel,
  repostActionLabel,
  zapActionLabel,
} from './feedFormat';

/** Glyph sizes: 20 in the feed / thread target, 18 on compact thread replies. */
export const POST_ACTION_ICON_SIZES = {
  compact: iconSize.md + 2,
  regular: iconSize.lg,
} as const;

/** One icon family (Tabler): outline at rest, the filled twin when active. */
const ACTION_ICONS = {
  reply: { idle: 'tabler:message-circle', active: 'tabler:message-circle-filled' },
  repost: { idle: 'tabler:repeat', active: 'tabler:repeat' },
  like: { idle: 'tabler:heart', active: 'tabler:heart-filled' },
  zap: { idle: 'tabler:bolt', active: 'tabler:bolt-filled' },
} as const;

/** The four groups spread across the full text column: every visible gap is
 *  equal whatever the counts' widths, the first glyph sits on the text keyline
 *  and the last lines up under the "more" button at the right edge (X, Primal,
 *  Damus). Equal fixed-width columns made gaps depend on count width and left
 *  the zap floating mid-row. */
const BAR_CLASS = 'w-full';
/** Glyphs carry ~2px of internal padding at this size; the outer two groups
 *  are pulled out by that much so their strokes meet the column edges. */
const FIRST_GROUP_CLASS = '-ml-0.5';
const LAST_GROUP_CLASS = '-mr-0.5';
const COUNT_CLASS = 'leading-[18px] tabular-nums';
const ACTION_HIT_SLOP = { top: 6, bottom: 10, left: 10, right: 10 } as const;
const ACTION_HAPTIC = { type: 'impact', impactStyle: 'light' } as const;

/**
 * Whether the counts are real numbers, still being counted (placeholder bar,
 * never a zero), or could not be counted by any source (a dash).
 */
export type MetricsCountsState = 'known' | 'loading' | 'unavailable';

const COUNT_UNAVAILABLE = '—';

// Bluesky's like keyframes: dip, overshoot, settle — with a tinted disc that
// blooms and fades behind the glyph. Plays only for a like the viewer tapped.
const LIKE_GLYPH_KEYFRAME = new Keyframe({
  0: { transform: [{ scale: 1 }] },
  10: { transform: [{ scale: 0.7 }] },
  40: { transform: [{ scale: 1.2 }] },
  100: { transform: [{ scale: 1 }] },
});
const LIKE_BLOOM_KEYFRAME = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 0 }] },
  40: { opacity: 0.4, transform: [{ scale: 1.5 }] },
  100: { opacity: 0, transform: [{ scale: 1.5 }] },
});

function ActionGlyph({
  name,
  size,
  color,
  burstSeq,
  bloomColor,
}: {
  name: string;
  size: number;
  color: string;
  /** Increments once per viewer-initiated activation; 0 never animates. */
  burstSeq: number;
  bloomColor: string;
}) {
  const reducedMotion = useReducedMotion();
  const animate = burstSeq > 0 && !reducedMotion;
  const frame = { width: size, height: size };
  return (
    <View style={frame}>
      {animate ? (
        <Animated.View
          key={`bloom-${burstSeq}`}
          pointerEvents="none"
          entering={LIKE_BLOOM_KEYFRAME.duration(duration.standard)}
          style={[
            StyleSheet.absoluteFill,
            { borderRadius: size, backgroundColor: bloomColor, opacity: 0 },
          ]}
        />
      ) : null}
      <Animated.View
        key={animate ? `glyph-${burstSeq}` : 'glyph'}
        entering={animate ? LIKE_GLYPH_KEYFRAME.duration(duration.standard) : undefined}>
        <Icon name={name} size={size} color={color} />
      </Animated.View>
    </View>
  );
}

function CountText({
  value,
  color,
  emphasised,
}: {
  value: string;
  color: string;
  emphasised: boolean;
}) {
  return (
    <Text
      family={POST_FONT_FAMILY}
      semibold={emphasised}
      size={postType.count.size}
      className={COUNT_CLASS}
      color={color}>
      {value}
    </Text>
  );
}

const ActionColumn = React.memo(function ActionColumn({
  action,
  glyphSize,
  countText,
  counts,
  isActive,
  activeColor,
  idleColor,
  first = false,
  last = false,
  disabled,
  onPress,
  onPressIn,
  onPressOut,
  accessibilityLabel,
  testID,
  burstSeq = 0,
}: {
  action: keyof typeof ACTION_ICONS;
  glyphSize: number;
  /** '' hides the count (a zero is never shown). */
  countText: string;
  counts: MetricsCountsState;
  isActive: boolean;
  activeColor: string;
  idleColor: string;
  first?: boolean;
  last?: boolean;
  disabled: boolean;
  onPress?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  accessibilityLabel: string;
  testID?: string;
  burstSeq?: number;
}) {
  const color = isActive ? activeColor : idleColor;
  const icon = ACTION_ICONS[action];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      haptics={ACTION_HAPTIC}
      activeOpacity={1}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      hitSlop={ACTION_HIT_SLOP}
      className={first ? FIRST_GROUP_CLASS : last ? LAST_GROUP_CLASS : undefined}>
      <PressScale>
        <HStack align="center" gap={spacing.xs}>
          <ActionGlyph
            name={isActive ? icon.active : icon.idle}
            size={glyphSize}
            color={color}
            burstSeq={burstSeq}
            bloomColor={activeColor}
          />
          {counts === 'loading' ? (
            <Text
              loading
              placeholder="12"
              family={POST_FONT_FAMILY}
              size={postType.count.size}
              className={COUNT_CLASS}
            />
          ) : counts === 'unavailable' ? (
            <CountText value={COUNT_UNAVAILABLE} color={color} emphasised={false} />
          ) : countText ? (
            <CountText value={countText} color={color} emphasised={isActive} />
          ) : null}
        </HStack>
      </PressScale>
    </Pressable>
  );
});

export const MetricsFooter = React.memo(function MetricsFooter({
  metrics,
  borderColor,
  compact = false,
  onCommentPress,
  onRepostPress,
  onQuotePress,
  onLikePress,
  onZapPress,
  reposted = false,
  liked = false,
  replied = false,
  zapped = false,
  // Still accepted for callers, but never disable a toggle: a tap while a
  // publish is in flight flips the intent and the network catches up.
  repostPending: _repostPending = false,
  likePending: _likePending = false,
  zapPending = false,
  repostPendingDirection: _repostPendingDirection,
  likePendingDirection: _likePendingDirection,
  onActionPressIn,
  onActionPressOut,
  counts = 'known',
}: {
  metrics: NoteMetrics;
  /** See MetricsCountsState; defaults to real numbers. */
  counts?: MetricsCountsState;
  borderColor: string;
  compact?: boolean;
  onCommentPress?: () => void;
  onRepostPress?: () => void;
  onQuotePress?: () => void;
  onLikePress?: () => void;
  onZapPress?: () => void;
  reposted?: boolean;
  liked?: boolean;
  replied?: boolean;
  zapped?: boolean;
  repostPending?: boolean;
  likePending?: boolean;
  zapPending?: boolean;
  repostPendingDirection?: 'activating' | 'deactivating';
  likePendingDirection?: 'activating' | 'deactivating';
  onActionPressIn?: () => void;
  onActionPressOut?: () => void;
}) {
  const repostedColor = useThemeColor('success');
  const idleColor = withAlpha(borderColor, postInk.secondary);
  const glyphSize = compact ? POST_ACTION_ICON_SIZES.compact : POST_ACTION_ICON_SIZES.regular;

  // The like burst plays only for a like the viewer tapped: the press arms it,
  // the `liked` flip consumes it. A recycled row or a server-side sync flips
  // `liked` without an armed press and stays still.
  const likeArmedRef = useRef(false);
  const [likeBurstSeq, setLikeBurstSeq] = useState(0);
  useEffect(() => {
    if (liked && likeArmedRef.current) {
      likeArmedRef.current = false;
      setLikeBurstSeq((seq) => seq + 1);
    }
    if (!liked) likeArmedRef.current = false;
  }, [liked]);
  const handleLikePress = useCallback(() => {
    if (!onLikePress) return;
    likeArmedRef.current = !liked;
    onLikePress();
  }, [liked, onLikePress]);

  // The repost button opens the shared Repost-or-Quote menu. Quote is greyed out
  // when no `onQuotePress` is supplied.
  const handleRepostPress = useCallback(() => {
    if (!onRepostPress) return;
    openRepostMenu({ reposted, onRepost: onRepostPress, onQuote: onQuotePress });
  }, [onRepostPress, onQuotePress, reposted]);

  const known = counts === 'known';
  const replyText = known && metrics.replyCount > 0 ? formatCount(metrics.replyCount) : '';
  const repostText = known && metrics.repostCount > 0 ? formatCount(metrics.repostCount) : '';
  const likeText = known && metrics.likeCount > 0 ? formatCount(metrics.likeCount) : '';
  const zapText = known && metrics.satsZapped > 0 ? formatSats(metrics.satsZapped) : '';

  // Any touch inside the bar belongs to the bar. A disabled button (a like
  // still publishing) never claims the responder, so without this the touch
  // would fall through to the card and open the thread.
  const handleBarTouchStart = useCallback(() => onActionPressIn?.(), [onActionPressIn]);

  return (
    <View onTouchStart={handleBarTouchStart}>
      <LayoutAnimationConfig skipEntering skipExiting>
        <HStack align="center" justify="space-between" className={BAR_CLASS}>
          <ActionColumn
            first
            action="reply"
            glyphSize={glyphSize}
            countText={replyText}
            counts={counts}
            isActive={replied}
            activeColor={COMMENT_ACCENT}
            idleColor={idleColor}
            disabled={!onCommentPress}
            onPress={onCommentPress}
            onPressIn={onActionPressIn}
            onPressOut={onActionPressOut}
            accessibilityLabel={replyActionLabel(!!replied, metrics.replyCount)}
            testID="post-comment"
          />
          <ActionColumn
            action="repost"
            glyphSize={glyphSize}
            countText={repostText}
            counts={counts}
            isActive={reposted}
            activeColor={repostedColor}
            idleColor={idleColor}
            disabled={!onRepostPress}
            onPress={handleRepostPress}
            onPressIn={onActionPressIn}
            onPressOut={onActionPressOut}
            accessibilityLabel={repostActionLabel(!!reposted, metrics.repostCount)}
          />
          <ActionColumn
            action="like"
            glyphSize={glyphSize}
            countText={likeText}
            counts={counts}
            isActive={liked}
            activeColor={LIKE_ACCENT}
            idleColor={idleColor}
            disabled={!onLikePress}
            onPress={handleLikePress}
            onPressIn={onActionPressIn}
            onPressOut={onActionPressOut}
            accessibilityLabel={likeActionLabel(!!liked, metrics.likeCount)}
            burstSeq={likeBurstSeq}
          />
          <ActionColumn
            last
            action="zap"
            glyphSize={glyphSize}
            countText={zapText}
            // Sats are a sum, not a count: a missing total renders as no
            // number rather than the dash the tallies use.
            counts={counts === 'unavailable' ? 'known' : counts}
            isActive={zapped}
            activeColor={ZAP_ACCENT}
            idleColor={idleColor}
            disabled={!onZapPress || zapPending}
            onPress={onZapPress}
            onPressIn={onActionPressIn}
            onPressOut={onActionPressOut}
            accessibilityLabel={zapActionLabel(metrics.satsZapped)}
            testID="post-zap"
          />
        </HStack>
      </LayoutAnimationConfig>
    </View>
  );
});
