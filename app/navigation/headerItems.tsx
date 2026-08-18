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
    // A custom left item is the back/close affordance, so suppress the native
    // back button — otherwise it renders ALONGSIDE the item (two backs). The
    // legacy `headerLeft` form did this implicitly. Screens that genuinely want
    // the native back (e.g. SettingsRecoveryScreen) must clear the items and set
    // `headerBackVisible: true` themselves.
    next.headerBackVisible = options.headerBackVisible ?? false;
  }
  if (right && !options.unstable_headerRightItems) {
    next.unstable_headerRightItems = (props) => [
      { type: 'custom', element: <>{right(props)}</>, hidesSharedBackground: true },
    ];
  }

  return next;
}

/**
 * Options fragment that restores the NATIVE back button on a screen whose
 * parent flow injected a glass left item via {@link withGlassHeaderItems}.
 * Spread into the screen's options / `navigation.setOptions`. Encapsulates the
 * `unstable_headerLeftItems` representation so consumers don't reach into the
 * helper's internals. Pair with `headerBackVisible: true` + `headerLeft: undefined`.
 */
export function clearGlassHeaderLeftItems(): Pick<
  NativeStackNavigationOptions,
  'unstable_headerLeftItems'
> {
  return { unstable_headerLeftItems: () => [] };
}
