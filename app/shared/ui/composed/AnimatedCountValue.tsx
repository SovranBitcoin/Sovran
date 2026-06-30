import React from 'react';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Text } from '@/shared/ui/primitives/Text';

/**
 * Roll-in animation for a displayed number/string. When `value` changes the
 * style tweens opacity 0.25→1 and a 6px slide-up over 280ms; the first render
 * never animates (so a list of counts doesn't all roll on mount).
 *
 * Exposed as a hook so callers can wrap their own `Text` structure (the mint
 * stat pills carry bold + meta styling the plain feed `Text` doesn't), while
 * `AnimatedCountValue` is the thin convenience wrapper the feed metrics use.
 *
 * Canonical home for the feed's "lazily-loaded count rolls in" behavior, reused
 * for cache→fresh transitions on mint surfaces (selector / info / reviews).
 */
export function useCountRollIn(value: string) {
  const progress = useSharedValue(1);
  const firstRender = React.useRef(true);
  React.useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    progress.value = withSequence(
      withTiming(0, { duration: 0 }),
      withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) })
    );
  }, [value, progress]);
  return useAnimatedStyle(() => ({
    opacity: 0.25 + 0.75 * progress.value,
    transform: [{ translateY: (1 - progress.value) * 6 }],
  }));
}

/**
 * A count/sats value that "rolls in" when it changes instead of snapping. Wraps
 * the app `Text` (font/colour stay exact); only a parent Animated.View's opacity
 * + a few-px translateY tween, so there's no clipping.
 */
export const AnimatedCountValue = React.memo(function AnimatedCountValue({
  value,
  size,
  color,
  overpass = false,
}: {
  value: string;
  size: number;
  color: string;
  overpass?: boolean;
}) {
  const animatedStyle = useCountRollIn(value);
  return (
    <Animated.View style={animatedStyle}>
      <Text overpass={overpass} size={size} style={{ color }}>
        {value}
      </Text>
    </Animated.View>
  );
});
