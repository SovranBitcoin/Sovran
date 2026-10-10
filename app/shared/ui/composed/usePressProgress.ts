import {
  cancelAnimation,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

/**
 * Press progress for one control, 0 at rest and 1 held, driven on the UI
 * thread from touch events so the control never re-renders to animate. Spread
 * `touch` on a view inside the pressable. Reduced motion holds it at rest.
 */
export function usePressProgress(ms = 90): {
  progress: SharedValue<number>;
  touch: { onTouchStart: () => void; onTouchEnd: () => void; onTouchCancel: () => void };
} {
  const progress = useSharedValue(0);
  const reduced = useReducedMotion();
  const settle = (to: number) => {
    cancelAnimation(progress);
    progress.set(withTiming(to, { duration: ms }));
  };
  return {
    progress,
    touch: {
      onTouchStart: () => {
        if (!reduced) settle(1);
      },
      onTouchEnd: () => settle(0),
      onTouchCancel: () => settle(0),
    },
  };
}
