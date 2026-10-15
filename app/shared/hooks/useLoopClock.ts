import { useCallback } from 'react';
import {
  cancelAnimation,
  Easing,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { useVisualActivityEffect } from '@/shared/hooks/useVisualActivityEffect';
import type { EasingMap } from '@/shared/lib/motion/keyframes';

// Easing.bezierFn (not Easing.bezier) — the Fn variant is directly callable
// inside worklets; the plain one returns a factory for withTiming configs.
export const KEYFRAME_EASINGS: EasingMap = {
  linear: Easing.linear,
  outCubic: Easing.out(Easing.cubic),
  inQuad: Easing.in(Easing.quad),
  outQuad: Easing.out(Easing.quad),
  overshoot: Easing.bezierFn(0.34, 1.56, 0.64, 1),
  inOutSin: Easing.inOut(Easing.sin),
};

/**
 * One master millisecond clock, 0 → `cycleMs` and around again, for an
 * illustration whose parts all sample keyframe tracks from it. It runs only
 * while its screen and the app are active, and never starts under Reduce
 * Motion: the frame at 0 then stands in for the animation.
 */
export function useLoopClock(cycleMs: number): SharedValue<number> {
  const reducedMotion = useReducedMotion();
  const t = useSharedValue(0);
  const run = useCallback(() => {
    if (reducedMotion) return undefined;
    t.set(0);
    t.set(withRepeat(withTiming(cycleMs, { duration: cycleMs, easing: Easing.linear }), -1, false));
    return () => {
      cancelAnimation(t);
      t.set(0);
    };
  }, [cycleMs, reducedMotion, t]);
  useVisualActivityEffect(run);
  return t;
}
