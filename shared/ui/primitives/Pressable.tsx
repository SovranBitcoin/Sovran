import React, { forwardRef, useCallback } from 'react';
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
import { log } from '@/shared/lib/logger';
import { EnhancedHaptics } from './Haptics';

/**
 * Configuration for haptic feedback fired by the press lifecycle.
 */
export interface HapticConfig {
  /** Type of haptic feedback to trigger */
  type?: 'selection' | 'impact' | 'notification';
  /** Impact style — only used when `type` is `'impact'` */
  impactStyle?: 'light' | 'medium' | 'heavy';
  /** Notification kind — only used when `type` is `'notification'` */
  notificationType?: 'success' | 'warning' | 'error';
  /** Fire on `onPressIn`. Default `true`. */
  onPressStart?: boolean;
  /** Fire on `onPress`. Default `false`. */
  onPressEnd?: boolean;
}

interface SharedPressableProps extends Omit<RNPressableProps, 'style'> {
  /** Haptic feedback config — `true` for default selection haptic, an
   *  object for fine-grained control, `false` (default) to disable. */
  haptics?: boolean | HapticConfig;
  /** Opacity applied to children while the press is held. Mirrors RN's
   *  legacy `TouchableOpacity.activeOpacity`. Set to `1` to disable the
   *  built-in fade. Default `0.7`. */
  activeOpacity?: number;
  /** Same `style` shape RN's Pressable accepts — either a static
   *  StyleProp or a function of `(state) => StyleProp`. Composed with
   *  the built-in opacity feedback. */
  style?: StyleProp<ViewStyle> | ((state: PressableStateCallbackType) => StyleProp<ViewStyle>);
}

export type PressableProps = SharedPressableProps;

const DEFAULT_HAPTIC: Required<HapticConfig> = {
  type: 'selection',
  impactStyle: 'medium',
  notificationType: 'success',
  onPressStart: true,
  onPressEnd: false,
};

/**
 * The single tap-surface seam for the app. Wraps RN's `Pressable` with:
 *
 *   1. **Single-flight guard** on `onPress` so a rapid double-tap whose
 *      handler awaits is dropped synchronously. Synchronous handlers
 *      pass through untouched (the hook is a no-op when the return
 *      value isn't a Promise).
 *   2. **Haptic feedback** matching the previous shared TouchableOpacity
 *      behaviour — opt-in via the `haptics` prop.
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
  { onPress, onPressIn, haptics = false, activeOpacity = 0.7, style, ...rest },
  ref
) {
  const hapticConfig: Required<HapticConfig> = {
    ...DEFAULT_HAPTIC,
    ...(typeof haptics === 'object' ? haptics : {}),
  };
  const shouldFireHaptics = haptics !== false;

  const triggerHaptic = useCallback(
    async (trigger: 'start' | 'end') => {
      if (!shouldFireHaptics) return;
      if (trigger === 'start' && !hapticConfig.onPressStart) return;
      if (trigger === 'end' && !hapticConfig.onPressEnd) return;
      try {
        await fireHaptic(hapticConfig);
      } catch (error) {
        log.warn('ui.haptics.not_supported', { type: 'pressable', error });
      }
    },
    [
      shouldFireHaptics,
      hapticConfig.onPressStart,
      hapticConfig.onPressEnd,
      hapticConfig.type,
      hapticConfig.impactStyle,
      hapticConfig.notificationType,
    ]
  );

  const guardedOnPress = useSingleFlight(async (e: GestureResponderEvent) => {
    if (!onPress) return;
    await triggerHaptic('end');
    // RN types onPress as `() => void` but callers routinely pass async
    // handlers; cast through `unknown` so the runtime check can see the
    // Promise the type system refuses to admit.
    const result = onPress(e) as unknown;
    if (result instanceof Promise) await result;
  });

  const handlePressIn = useCallback(
    async (e: GestureResponderEvent) => {
      await triggerHaptic('start');
      onPressIn?.(e);
    },
    [triggerHaptic, onPressIn]
  );

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

async function fireHaptic(config: Required<HapticConfig>): Promise<void> {
  switch (config.type) {
    case 'selection':
      await EnhancedHaptics.buttonHaptic();
      return;
    case 'impact':
      switch (config.impactStyle) {
        case 'light':
          await EnhancedHaptics.buttonHaptic();
          return;
        case 'heavy':
          await EnhancedHaptics.destructiveHaptic();
          return;
        case 'medium':
        default:
          await EnhancedHaptics.actionHaptic();
          return;
      }
    case 'notification':
      switch (config.notificationType) {
        case 'warning':
          await EnhancedHaptics.warningHaptic();
          return;
        case 'error':
          await EnhancedHaptics.errorHaptic();
          return;
        case 'success':
        default:
          await EnhancedHaptics.successHaptic();
          return;
      }
  }
}
