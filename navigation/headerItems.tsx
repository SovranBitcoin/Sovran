/**
 * iOS 26 liquid-glass header-item helper.
 *
 * On iOS 26, react-native-screens wraps anything placed in the native
 * `headerLeft` / `headerRight` slots in the system Liquid Glass "shared
 * background" capsule. That capsule is on by default, cannot be disabled via
 * the legacy `headerLeft`/`headerRight` function form, and — worse — it
 * intercepts touches so the `Pressable` inside a custom header button does not
 * reliably fire `onPress`. Because this app draws its OWN glass
 * (`HeaderGlassCircle`), the result is doubled chrome + flaky taps.
 *
 * SDK 56 exposes the (iOS-only, `unstable_`) header-items API which lets us set
 * `hidesSharedBackground: true` per item — suppressing the system capsule so
 * only the app's glass renders AND removing the intercepting container so taps
 * land. We pass the existing `headerLeft`/`headerRight` render through as a
 * `type: 'custom'` item, keeping the legacy props for Android (which ignores
 * the iOS-only items API).
 */
import React from 'react';
import { Platform } from 'react-native';
import type { NativeStackNavigationOptions } from 'expo-router';

import { supportsLiquidGlass } from '@/shared/lib/version';

/**
 * Mirror a screen's `headerLeft`/`headerRight` into the iOS header-items API
 * with `hidesSharedBackground: true`. No-op on Android and on iOS versions
 * without liquid glass (those keep the plain `headerLeft`/`headerRight` path).
 */
export function withGlassHeaderItems(
  options: NativeStackNavigationOptions
): NativeStackNavigationOptions {
  if (Platform.OS !== 'ios' || !supportsLiquidGlass()) return options;

  const next: NativeStackNavigationOptions = { ...options };
  const left = options.headerLeft;
  const right = options.headerRight;

  if (left && !options.unstable_headerLeftItems) {
    next.unstable_headerLeftItems = (props) => [
      { type: 'custom', element: <>{left(props)}</>, hidesSharedBackground: true },
    ];
  }
  if (right && !options.unstable_headerRightItems) {
    next.unstable_headerRightItems = (props) => [
      { type: 'custom', element: <>{right(props)}</>, hidesSharedBackground: true },
    ];
  }

  return next;
}
