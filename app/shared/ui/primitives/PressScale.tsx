import type { ReactNode } from 'react';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
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
 */
export function PressScale({ children, target = 0.9 }: { children: ReactNode; target?: number }) {
  const scale = useSharedValue(1);
  const reducedMotion = useReducedMotion();
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  const settle = (to: number) => {
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
