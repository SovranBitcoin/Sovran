/**
 * Action bar for the target post, pinned at the screen bottom while the embed
 * sheet is collapsed. Crossfades with the in-sheet target footer so the post's
 * actions stay reachable. Reuses `MetricsFooter` — no new action logic.
 *
 * It is a layout-pinned sibling (NOT inside the translated sheet) so its button
 * hit-testing is exact, and it carries its own pan gesture so dragging the bar
 * still moves the sheet between snaps. The pan uses `activeOffsetY` so taps on
 * the like/repost/comment buttons pass through; only a real vertical drag moves
 * the sheet.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  clamp,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { spacing } from '@/shared/styles/tokens';
import { MetricsFooter } from '../nostr/MetricsFooter';
import type { NoteMetrics } from '../nostr/feedTypes';
import { SHEET_PAN_ACTIVATION, SHEET_SPRING } from './embedConstants';
import { embedHaptic } from './embedHaptics';
import { nearestSnap } from './snapMath';
import { useThreadEmbed } from './ThreadEmbedProvider';

export const EmbedActionBar = React.memo(function EmbedActionBar({
  metrics,
  liked,
  replied,
  reposted,
  zapped,
  likePending,
  repostPending,
  zapPending,
  onCommentPress,
  onRepostPress,
  onQuotePress,
  onLikePress,
  onZapPress,
}: {
  metrics: NoteMetrics;
  liked: boolean;
  replied: boolean;
  reposted: boolean;
  zapped?: boolean;
  likePending: boolean;
  repostPending: boolean;
  zapPending?: boolean;
  onCommentPress: () => void;
  onRepostPress: () => void;
  onQuotePress?: () => void;
  onLikePress: () => void;
  onZapPress?: () => void;
}) {
  const [foreground, surface] = useThemeColor(['foreground', 'surface'] as const);
  const insets = useSafeAreaInsets();
  const embed = useThreadEmbed();

  const actionBarOpacity = embed?.actionBarOpacity;
  const sheetTranslateY = embed?.sheetTranslateY;
  const snapMiddle = embed?.snapMiddle ?? 0;
  const snapInline = embed?.snapInline ?? 0;
  const setActionBarHeight = embed?.setActionBarHeight;
  const startY = useSharedValue(0);

  const fadeStyle = useAnimatedStyle(() => ({ opacity: actionBarOpacity?.get() ?? 0 }));

  // Gate touches + drag so the (invisible) bar is inert while faded out.
  const [interactive, setInteractive] = useState(false);
  useAnimatedReaction(
    () => (actionBarOpacity?.get() ?? 0) > 0.05,
    (next, prev) => {
      if (next !== prev) runOnJS(setInteractive)(next);
    }
  );

  // Dragging the bar moves the sheet between snaps; taps pass through.
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(interactive)
        .activeOffsetY([-SHEET_PAN_ACTIVATION, SHEET_PAN_ACTIVATION])
        .onStart(() => {
          'worklet';
          if (!sheetTranslateY) return;
          startY.set(sheetTranslateY.get());
        })
        .onUpdate((e) => {
          'worklet';
          if (!sheetTranslateY) return;
          sheetTranslateY.set(clamp(startY.get() + e.translationY, 0, snapInline));
        })
        .onEnd((e) => {
          'worklet';
          if (!sheetTranslateY) return;
          const target = nearestSnap(sheetTranslateY.get(), e.velocityY, snapMiddle, snapInline);
          if (Math.abs(target - startY.get()) > 1) runOnJS(embedHaptic)();
          sheetTranslateY.set(withSpring(target, SHEET_SPRING));
        }),
    [interactive, sheetTranslateY, snapMiddle, snapInline, startY]
  );

  const handleLayout = useCallback(
    (e: LayoutChangeEvent) => setActionBarHeight?.(Math.round(e.nativeEvent.layout.height)),
    [setActionBarHeight]
  );

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View
        onLayout={handleLayout}
        pointerEvents={interactive ? 'box-none' : 'none'}
        style={[
          styles.container,
          { paddingBottom: insets.bottom + spacing.sm, backgroundColor: surface },
          fadeStyle,
        ]}>
        <MetricsFooter
          metrics={metrics}
          borderColor={foreground}
          showBorder={false}
          onCommentPress={onCommentPress}
          onRepostPress={onRepostPress}
          onQuotePress={onQuotePress}
          onLikePress={onLikePress}
          onZapPress={onZapPress}
          reposted={reposted}
          liked={liked}
          replied={replied}
          zapped={zapped}
          repostPending={repostPending}
          likePending={likePending}
          zapPending={zapPending}
        />
      </Animated.View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
});
