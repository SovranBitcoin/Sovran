/**
 * @fileoverview Gradient fade at the top or bottom edge of a scrolling view.
 *
 * Hides the visual cut-off where list content meets a sticky header (top
 * edge) or a floating bottom bar (bottom edge). Uses the same recipe as
 * `BottomButtons`:
 *
 *   1. An eased ~26-stop alpha gradient masks the BlurView so iOS's
 *      `UIVisualEffectView` reads enough alpha gradation to render a
 *      smooth gradient blur instead of a banded one. A 3-stop linear
 *      mask creates an alpha cliff the blur shader can't cross — visible
 *      as a hard band on iOS.
 *   2. A separate translucent → opaque color gradient is layered on top
 *      of the masked blur. This guarantees the opaque-end pixels read
 *      as solid container color so any residual banding under the blur
 *      is hidden.
 *   3. The blur defaults to iOS's `systemChromeMaterialDark` tint —
 *      a true frosted-glass material, not just a darkening overlay.
 *
 * Layout model: absolute, pointer-transparent. Drop it as a sibling to
 * the scroll container or as a backdrop layer inside a sticky chrome /
 * bottom section.
 */

import { useMemo } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { BlurView, type BlurTint } from 'expo-blur';

import { chromeBlurTint } from '@/shared/styles/tokens';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
import { easeGradient } from '@/shared/lib/easeGradient';
import { withAlpha } from '@/shared/lib/color';

import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useScreenBackground } from '@/shared/ui/composed/ScreenFooterContext';

interface ScrollEdgeFadeProps {
  /** Which edge the fade pins to. */
  edge: 'top' | 'bottom';
  /** Total absolute height of the fade region in pixels. */
  height: number;
  /**
   * Size of the transparent-to-opaque taper band, in pixels. The
   * remaining `height - fadeSize` is the fully-opaque section adjacent
   * to the edge. Defaults to `height / 2`.
   */
  fadeSize?: number;
  /**
   * Target color for the opaque end of the gradient. Defaults to the
   * theme's `background` token so content fades into the screen color.
   * Set to `null` to disable the color gradient (blur-only).
   */
  color?: string | null;
  /** Apply a frosted-glass blur. Default true. */
  blur?: boolean;
  /**
   * BlurView intensity at the fully-blurred end (0-100). Default 10 —
   * matches `BottomButtons` so top and bottom edge fades on the same
   * screen render with the same frosted-glass weight.
   */
  blurIntensity?: number;
  /**
   * BlurView tint. Defaults to `systemChromeMaterialDark` on iOS — the
   * system material renders true frosted-glass blur that composes
   * correctly through a gradient mask. Plain `'dark'` is a tinted
   * overlay, not a blur. Android falls back to `dark`.
   */
  blurTint?: BlurTint;
  /** Stack order. Default 50. */
  zIndex?: number;
  /** Distance from the specified edge in pixels. Default 0. */
  offset?: number;
}

// Eased mask gradients — pre-computed at module load. Stops are eased
// between three anchors using react-native-easing-gradient's default
// cubic-bezier ease-in-out, producing ~26 dense color stops. iOS reads
// enough alpha gradation through these to render a smooth gradient
// blur instead of a hard band.
const { colors: BOTTOM_MASK_COLORS, locations: BOTTOM_MASK_LOCATIONS } = easeGradient({
  colorStops: {
    0: { color: 'transparent' },
    0.5: { color: 'rgba(0,0,0,0.99)' },
    1: { color: 'black' },
  },
});
const { colors: TOP_MASK_COLORS, locations: TOP_MASK_LOCATIONS } = easeGradient({
  colorStops: {
    0: { color: 'black' },
    0.5: { color: 'rgba(0,0,0,0.99)' },
    1: { color: 'transparent' },
  },
});

export function ScrollEdgeFade({
  edge,
  height,
  fadeSize,
  color,
  blur = true,
  blurIntensity = 10,
  blurTint = chromeBlurTint,
  zIndex = 50,
  offset = 0,
}: ScrollEdgeFadeProps) {
  const themeBackground = useThemeColor('surface');
  const pageBackground = useScreenBackground();
  const fillColor = color === null ? null : (color ?? pageBackground ?? themeBackground);

  // Resolve fade band. Clamp so we always have a well-formed mask even
  // when callers pass extreme values.
  const resolvedFade = Math.max(0, Math.min(fadeSize ?? height / 2, height));
  // Location where the opaque band starts, expressed as a 0-1 fraction
  // measured from the top of the region regardless of edge.
  const boundaryFromTop = edge === 'top' ? 1 - resolvedFade / height : resolvedFade / height;

  const isTop = edge === 'top';
  const maskColors = isTop ? TOP_MASK_COLORS : BOTTOM_MASK_COLORS;
  const maskLocations = isTop ? TOP_MASK_LOCATIONS : BOTTOM_MASK_LOCATIONS;

  // 3-stop color gradient layered on top of the masked blur. Stops are
  // tuned the same way `BottomButtons` does it: 0 alpha at the
  // transparent edge, 75% mid, 100% at the opaque edge — guarantees the
  // opaque pixels are fully solid even when the underlying blur shader
  // bands.
  const colorGradientColors = useMemo(() => {
    if (!fillColor) return null;
    const transparent = withAlpha(fillColor, 0);
    const mid = withAlpha(fillColor, 0.75);
    const solid = fillColor;
    return isTop ? ([solid, mid, transparent] as const) : ([transparent, mid, solid] as const);
  }, [fillColor, isTop]);

  const colorGradientLocations = useMemo(() => {
    // The mid stop sits at the same boundary as the alpha mask so the
    // color gradient ramps in lockstep with the blur reveal.
    const midLocation = isTop ? boundaryFromTop / 2 : (1 + boundaryFromTop) / 2;
    return isTop
      ? ([0, midLocation, boundaryFromTop] as const)
      : ([boundaryFromTop, midLocation, 1] as const);
  }, [boundaryFromTop, isTop]);

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        [edge]: offset,
        height,
        zIndex,
      }}>
      {/* Blur layer is iOS-only by design: expo-blur on Android renders as a
          muddy dark tint rather than frosted glass, which made header fades
          look broken. Android keeps the pure eased color gradient below. */}
      {blur && Platform.OS === 'ios' && (
        <MaskedView
          style={StyleSheet.absoluteFill}
          maskElement={
            <LinearGradient
              colors={maskColors}
              locations={maskLocations}
              style={StyleSheet.absoluteFill}
            />
          }>
          <BlurView intensity={blurIntensity} tint={blurTint} style={StyleSheet.absoluteFill} />
        </MaskedView>
      )}
      {colorGradientColors && (
        <LinearGradient
          colors={colorGradientColors}
          locations={colorGradientLocations}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      )}
    </View>
  );
}
