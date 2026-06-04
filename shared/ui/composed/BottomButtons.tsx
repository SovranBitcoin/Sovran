import React, { ReactNode, useCallback, useMemo } from 'react';
import { LayoutChangeEvent, Platform, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView, BlurTint } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
import { easeGradient } from 'react-native-easing-gradient';
import opacity from 'hex-color-opacity';
import { Log } from '@/shared/lib/logger';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useScreenBackground, useScreenFooter } from './ScreenFooterContext';

interface BottomButtonsProps {
  children: ReactNode;
  /** Additional padding at the bottom, on top of safe area insets. Default: 0 */
  paddingBottom?: number;
  /** Additional styles for the container */
  style?: StyleProp<ViewStyle>;
  /**
   * Override the gradient's opaque-end color. Default: the screen's
   * background (via `ScreenBackgroundContext`) or the theme `background`
   * token if no Screen provides one. Set to `null` to disable the gradient.
   */
  gradientColor?: string | null;
  /**
   * Apply a frosted-glass blur that fades along the same axis as the color
   * gradient: clear at the top edge, full blur at the bottom. Default true.
   *
   * Implementation: a single `BlurView` masked by a `LinearGradient` whose
   * stops come from `react-native-easing-gradient`. The dense (~25-stop)
   * eased mask is the only way the mask alpha varies smoothly enough for
   * iOS `UIVisualEffectView` to render a continuous gradient blur — a
   * 2-stop linear `transparent → black` mask creates a hard alpha boundary
   * that the blur shader can't cross, producing a flat-looking band.
   */
  blur?: boolean;
  /** BlurView intensity at the fully-blurred (bottom) edge (0-100). Default 100. */
  blurIntensity?: number;
  /**
   * BlurView tint. Defaults to `systemChromeMaterialDark` on iOS — the system
   * material tints render true frosted-glass blurs that compose correctly
   * through a gradient mask. Plain `'dark'` is a tinted overlay, not a blur.
   * On Android, expo-blur falls back to `dark`.
   */
  blurTint?: BlurTint;
  /**
   * Fires when the container is laid out — callers use this to size
   * sibling overlays (e.g. a `ScrollEdgeFade` that sits directly above
   * the bar) to the rendered height.
   */
  onLayout?: (event: LayoutChangeEvent) => void;
}

// Mask gradient — pre-computed at module load. Stops are eased between three
// anchors (clear at top, ~99% opaque at the midpoint, fully opaque at the
// bottom) using react-native-easing-gradient's default cubic-bezier ease-in-
// out. The result is ~26 dense color stops; iOS reads enough alpha gradation
// to render the masked blur as a smooth gradient instead of a hard band.
const { colors: MASK_COLORS, locations: MASK_LOCATIONS } = easeGradient({
  colorStops: {
    0: { color: 'transparent' },
    0.5: { color: 'rgba(0,0,0,0.99)' },
    1: { color: 'black' },
  },
});

/**
 * A lightweight wrapper for positioning buttons at the bottom of a screen.
 * Adds bottom safe-area inset internally so callers never need to compute
 * it, and renders the bottom-fade gradient + frosted blur that lets list
 * content visibly disappear into the bar's opaque base. When placed inside
 * a Screen, its measured height is published via ScreenFooterContext so the
 * scroll content auto-pads to clear the bar.
 */
export function BottomButtons({
  children,
  paddingBottom = 0,
  style,
  gradientColor,
  blur = true,
  blurIntensity = 10,
  blurTint = Platform.OS === 'ios' ? 'systemChromeMaterialDark' : 'dark',
  onLayout,
}: BottomButtonsProps) {
  const insets = useSafeAreaInsets();
  const themeBackground = useThemeColor('background');
  // The screen this footer sits inside publishes its actual background via
  // context — falls back to the theme token when no provider is mounted
  // (e.g. screens that bypass the composed `Screen` wrapper). Ensures the
  // gradient's opaque end always matches what's behind it, so list rows
  // visibly fade out as they scroll under the buttons.
  const screenBackground = useScreenBackground();
  const resolvedGradientColor =
    gradientColor === null ? null : (gradientColor ?? screenBackground ?? themeBackground);
  const { setFooterHeight } = useScreenFooter();
  const shouldRenderBlur = blur && Platform.OS !== 'android';
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      setFooterHeight(event.nativeEvent.layout.height);
      onLayout?.(event);
    },
    [setFooterHeight, onLayout]
  );
  const colorGradientColors = useMemo(
    () =>
      resolvedGradientColor
        ? ([
            opacity(resolvedGradientColor, 0),
            opacity(resolvedGradientColor, 0.75),
            opacity(resolvedGradientColor, 1),
          ] as const)
        : null,
    [resolvedGradientColor]
  );
  return (
    <Log name="BottomButtons">
      <View
        onLayout={handleLayout}
        style={[
          styles.container,
          {
            paddingBottom: insets.bottom + paddingBottom,
          },
          style,
        ]}>
        {resolvedGradientColor !== null && (
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {shouldRenderBlur && (
              <MaskedView
                style={StyleSheet.absoluteFill}
                maskElement={
                  <LinearGradient
                    colors={MASK_COLORS as unknown as readonly [string, string, ...string[]]}
                    locations={MASK_LOCATIONS as unknown as readonly [number, number, ...number[]]}
                    style={StyleSheet.absoluteFill}
                  />
                }>
                <BlurView
                  intensity={blurIntensity}
                  tint={blurTint}
                  style={StyleSheet.absoluteFill}
                />
              </MaskedView>
            )}
            {colorGradientColors && (
              <LinearGradient
                colors={colorGradientColors}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
            )}
          </View>
        )}
        {children}
      </View>
    </Log>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    width: '100%',
  },
});
