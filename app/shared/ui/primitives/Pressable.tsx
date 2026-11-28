import { forwardRef } from 'react';
import {
  Pressable as RNPressable,
  type PressableProps as RNPressableProps,
  type GestureResponderEvent,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
  type View,
} from 'react-native';
import { useSingleFlight } from '@/shared/hooks/useSingleFlight';
import {
  fireHapticConfig,
  resolvePressHaptics,
  useHapticsEnabled,
  type HapticConfig,
  type PressHaptics,
} from './Haptics';

export type { HapticConfig, PressHaptics };

interface SharedPressableProps extends Omit<RNPressableProps, 'style'> {
  /** Haptic feedback. Default: a light impact on press-in. `false` opts
   *  out; an object overrides fields of the default. Never fires while
   *  `disabled` or when there is nothing to press (no `onPress`/`onLongPress`). */
  haptics?: PressHaptics;
  /** Opacity applied to children while the press is held. Mirrors RN's
   *  legacy `TouchableOpacity.activeOpacity`. Set to `1` to disable the
   *  built-in fade. Default `0.7`. */
  activeOpacity?: number;
  /** Same `style` shape RN's Pressable accepts — either a static
   *  StyleProp or a function of `(state) => StyleProp`. Composed with
   *  the built-in opacity feedback. */
  style?: StyleProp<ViewStyle> | ((state: PressableStateCallbackType) => StyleProp<ViewStyle>);
}

/**
 * The single tap-surface seam for the app. Wraps RN's `Pressable` with:
 *
 *   1. **Single-flight guard** on `onPress` so a rapid double-tap whose
 *      handler awaits is dropped synchronously. Synchronous handlers
 *      pass through untouched (the hook is a no-op when the return
 *      value isn't a Promise).
 *   2. **Haptic feedback** matching the previous shared TouchableOpacity
 *      behaviour — on by default, `haptics={false}` opts out.
 *   3. **Default opacity feedback** on press via Pressable's
 *      `style={(state) => ...}` API. Set `activeOpacity={1}` to disable.
 *
 * Drop-in for callers migrating from the old shared TouchableOpacity —
 * `onPress`, `onLongPress`, `onPressIn`, `onPressOut`, the
 * children-as-render-prop API, and `activeOpacity` all behave the same
 * way. Direct imports of `Pressable` / `TouchableOpacity` from
 * `react-native` are blocked by an ESLint rule so the guard cannot be
 * silently bypassed.
 */
export const Pressable = forwardRef<View, SharedPressableProps>(function Pressable(
  { onPress, onPressIn, haptics, activeOpacity = 0.7, style, ...rest },
  ref
) {
  // A container Pressable (only onPressIn/out, or nothing) is not a control.
  const pressable = !rest.disabled && !!(onPress || rest.onLongPress);
  const hapticsEnabled = useHapticsEnabled();
  const hapticConfig = pressable && hapticsEnabled ? resolvePressHaptics(haptics) : null;

  // Fire-and-forget: the press handler never waits on the haptic bridge.
  const triggerHaptic = (trigger: 'start' | 'end') => {
    if (!hapticConfig) return;
    if (trigger === 'start' && !hapticConfig.onPressStart) return;
    if (trigger === 'end' && !hapticConfig.onPressEnd) return;
    fireHapticConfig(hapticConfig);
  };

  const guardedOnPress = useSingleFlight(async (e: GestureResponderEvent) => {
    if (!onPress) return;
    triggerHaptic('end');
    // RN types onPress as `() => void` but callers routinely pass async
    // handlers; cast through `unknown` so the runtime check can see the
    // Promise the type system refuses to admit.
    const result = onPress(e) as unknown;
    if (result instanceof Promise) await result;
  });

  const handlePressIn = (e: GestureResponderEvent) => {
    onPressIn?.(e);
    triggerHaptic('start');
  };

  // Compose the user's style with default opacity-on-press feedback so
  // callers don't have to thread `({pressed})` themselves. `activeOpacity`
  // of 1 disables the fade entirely (some buttons, e.g. liquid-glass
  // surfaces, do their own pressed-state visuals).
  const composedStyle =
    activeOpacity === 1
      ? style
      : (state: PressableStateCallbackType) => {
          const userStyle = typeof style === 'function' ? style(state) : style;
          return [{ opacity: state.pressed ? activeOpacity : 1 }, userStyle];
        };

  return (
    <RNPressable
      ref={ref}
      onPress={onPress ? guardedOnPress : undefined}
      onPressIn={handlePressIn}
      style={composedStyle}
      {...rest}
    />
  );
});
