import type { NativeStackNavigationOptions } from 'expo-router';

/** Screen (or the Android sheet host) paints the only header background.
 * iOS 26's automatic scroll-edge effect otherwise adds another masking layer.
 */
export const GRADIENT_HEADER_OPTIONS = {
  headerTransparent: true,
  headerShadowVisible: false,
  headerBackButtonDisplayMode: 'minimal',
  headerBlurEffect: 'none',
  headerStyle: { backgroundColor: 'transparent' },
  headerLargeStyle: { backgroundColor: 'transparent' },
  scrollEdgeEffects: { top: 'hidden' },
} satisfies Partial<NativeStackNavigationOptions>;
