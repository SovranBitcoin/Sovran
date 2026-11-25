import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useDrawerProgress } from 'expo-router/drawer';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { withAlpha } from '@/shared/lib/color';
import { getScreenCornerRadius } from '@/shared/lib/screenCornerRadius';
import { alpha, radius, zIndex } from '@/shared/styles/tokens';

/** Breathing room past the hardware corner curve so the full curve stays visible. */
const PEEK_MARGIN = 18;
const MIN_PEEK_WIDTH = 72;
const MAX_DRAWER_WIDTH = 340;

/**
 * Width of the slide-out Accounts drawer.
 *
 * Always leaves at least `deviceRadius + 18` (minimum 72pt) of the main scene
 * on screen so its top-left and bottom-left continuous corner curves remain
 * completely visible and easy to tap closed (320pt drawer / 73pt peek on a
 * 393pt iPhone with a 55pt screen radius).
 */
export function computeDrawerWidth(windowWidth: number, deviceRadius: number): number {
  const peekWidth = Math.max(deviceRadius + PEEK_MARGIN, MIN_PEEK_WIDTH);
  return Math.max(0, Math.min(windowWidth - peekWidth, MAX_DRAWER_WIDTH));
}

/**
 * Rounded dim and hairline edge painted inside the drawer's clipped scene.
 *
 * `expo-router/drawer`'s stock overlay sits outside `sceneStyle` with square
 * corners, which squared off the rounded scene when the `overlayStyle` patch
 * was dropped (ADR 0038). Keeping the stock overlay transparent for
 * tap-to-close and painting the visual dim here restores the continuous
 * hardware corner curve and inset hairline with zero upstream patches.
 */
export function DrawerSceneOverlay() {
  const progress = useDrawerProgress();
  const [surface, border] = useThemeColor(['surface', 'separator-secondary'] as const);
  const deviceRadius = getScreenCornerRadius(radius['2xl']);

  const staticStyle = useMemo(
    () => ({
      backgroundColor: withAlpha(surface, alpha.strong),
      borderTopLeftRadius: deviceRadius,
      borderBottomLeftRadius: deviceRadius,
      borderCurve: 'continuous' as const,
      boxShadow: `inset ${StyleSheet.hairlineWidth}px 0 0 0 ${border}`,
      zIndex: zIndex.overlay,
    }),
    [surface, border, deviceRadius]
  );

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
  }));

  return (
    <Animated.View
      testID="drawer-scene-overlay"
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, staticStyle, animatedStyle]}
    />
  );
}
