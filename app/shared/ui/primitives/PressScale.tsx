import type { ReactNode } from 'react';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { duration } from '@/shared/styles/tokens';

/**
 * Instant press feedback: scales its children toward `target` on touch-down
 * and back on release/cancel, both legs `duration.instant`. Wraps content
 * inside a `Pressable` (it owns no gesture of its own), so the parent keeps
 * the single-flight guard and haptics. Reduced motion disables the scale.
 *
 * Bluesky presses whole cards at 0.98; Ice Cubes presses icon buttons at 0.8.
 * The default sits between for glyph + count groups.
 *
 * `progressOverride` holds the press at one frame instead (0 = at rest,
 * 1 = fully pressed), so a design-system scrubber can inspect any point of it;
 * touches then leave the scale alone.
 */
export function PressScale({
  children,
  target = 0.9,
  progressOverride,
}: {
  children: ReactNode;
  target?: number;
  progressOverride?: SharedValue<number>;
}) {
  const scale = useSharedValue(1);
  const reducedMotion = useReducedMotion();
  const style = useAnimatedStyle(() => ({
    transform: [
      { scale: progressOverride ? 1 + (target - 1) * progressOverride.get() : scale.get() },
    ],
  }));

  const settle = (to: number) => {
    if (progressOverride) return;
    cancelAnimation(scale);
    scale.set(withTiming(to, { duration: duration.instant }));
  };

  return (
    <Animated.View
      style={style}
      onTouchStart={() => {
        if (!reducedMotion) settle(target);
      }}
      onTouchEnd={() => settle(1)}
      onTouchCancel={() => settle(1)}>
      {children}
    </Animated.View>
  );
}
