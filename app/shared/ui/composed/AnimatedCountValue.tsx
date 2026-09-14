import React from 'react';
import {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

/**
 * Roll-in animation for a displayed number/string. When `value` changes the
 * style tweens opacity 0.25→1 and a 6px slide-up over 280ms; the first render
 * never animates (so a list of counts doesn't all roll on mount).
 *
 * Exposed as a hook so callers wrap their own `Text` structure (the mint stat
 * pills carry bold + meta styling). The feed's action bar no longer rolls its
 * counts — they render static and hide at zero (ADR 0009) — so this is the
 * cache→fresh transition for mint surfaces (selector / info / reviews).
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
