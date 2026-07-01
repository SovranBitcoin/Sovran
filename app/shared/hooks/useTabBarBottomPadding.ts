import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Native tab bar height. expo-router's `unstable-native-tabs` doesn't expose
 * the rendered height (no equivalent of `useBottomTabBarHeight`), so we
 * estimate per-platform. iOS phone tab bars are ~49pt, iPad ~50, Android
 * Material is ~56dp; the estimate matches values already used in
 * `LayoutDebugWrapper` and `WhitenoiseSetupBanner`.
 */
const NATIVE_TAB_BAR_HEIGHT = Platform.OS === 'ios' ? (Platform.isPad ? 50 : 49) : 56;

/**
 * Bottom padding for in-tab scroll lists so the last row clears the native
 * tab bar. Without this, items at the bottom of FlashList / FlatList sit
 * behind the tab bar and become unclickable.
 *
 * Use as `contentContainerStyle={{ paddingBottom }}` on any list rendered
 * inside the native-tabs route group (`app/(drawer)/(tabs)/...`).
 *
 * @param extra - additional padding above the tab bar (default 24).
 */
export function useTabBarBottomPadding(extra: number = 24): number {
  const insets = useSafeAreaInsets();
  return NATIVE_TAB_BAR_HEIGHT + insets.bottom + extra;
}
