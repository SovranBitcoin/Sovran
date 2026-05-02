import React, { forwardRef } from 'react';
import {
  Pressable as RNPressable,
  type PressableProps,
  type GestureResponderEvent,
  type View,
} from 'react-native';
import { useSingleFlight } from '@/shared/hooks/useSingleFlight';

/**
 * Drop-in replacement for `react-native`'s `Pressable` that routes its
 * `onPress` through `useSingleFlight`. A rapid double-tap whose handler
 * awaits is dropped at the ref level — synchronous handlers (toggles,
 * navigation, copy-to-clipboard) pass through untouched because the
 * guard is a no-op when `onPress` doesn't return a Promise.
 *
 * Use this primitive everywhere a tap surface is needed; importing
 * `Pressable` directly from `react-native` is forbidden by the
 * `no-restricted-imports` ESLint rule so the guard cannot be silently
 * bypassed by future contributors.
 *
 * `onLongPress`, `onPressIn`, `onPressOut`, and the `children-as-render-
 * prop` API are forwarded unchanged. Only `onPress` is wrapped because
 * long-press and press-in/out are visual-feedback events whose duplicate
 * firing has no side-effect.
 */
export const Pressable = forwardRef<View, PressableProps>(function Pressable(
  { onPress, ...rest },
  ref
) {
  const guardedOnPress = useSingleFlight(async (e: GestureResponderEvent) => {
    if (!onPress) return;
    // RN types `onPress` as returning `void`; callers routinely pass
    // async handlers and TS allows that via the void-return-type rule.
    // Cast through `unknown` so the runtime check can see the Promise
    // the type system refuses to admit.
    const result = onPress(e) as unknown;
    if (result instanceof Promise) await result;
  });

  return <RNPressable ref={ref} onPress={onPress ? guardedOnPress : undefined} {...rest} />;
});
