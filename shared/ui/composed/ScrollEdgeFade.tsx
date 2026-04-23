/**
 * @fileoverview Gradient fade at the top or bottom edge of a scrolling view.
 *
 * Hides the visual cut-off where list content meets a sticky header (top
 * edge) or a floating bottom bar (bottom edge). Blurs + color-fades content
 * scrolling past the opaque end so items don't snap out of view.
 *
 * Layout model: absolute, pointer-transparent. Drop it as a sibling to the
 * scroll container (usually inside the Screen or ModalLayoutWrapper
 * children) and it paints over the scroll region near the specified edge.
 *
 * Design pattern:
 *   - Opaque half (adjacent to the edge) fully blurs + color-fills content
 *     behind it, so the sticky/floating UI reads against a uniform surface.
 *   - Fade half (pointing into the scroll content) tapers the blur + color
 *     down to transparent so the transition between "in view" and "behind
 *     the overlay" is smooth.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';

import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

export interface ScrollEdgeFadeProps {
  /** Which edge the fade pins to. */
  edge: 'top' | 'bottom';
  /** Total absolute height of the fade region in pixels. */
  height: number;
  /**
   * Size of the transparent-to-opaque taper band, in pixels. The
   * remaining `height - fadeSize` is the fully-opaque section adjacent
   * to the edge. Defaults to `height / 2` which matches the historical
   * ModalLayoutWrapper header-gradient shape (half opaque, half fading).
   *
   * Use a smaller `fadeSize` when the opaque region needs to cover a
   * wide floating bar (e.g. wrap-growing pills) and the taper only
   * needs to be a thin visual softener above it.
   */
  fadeSize?: number;
  /**
   * Target color for the opaque end of the gradient. Defaults to the
   * theme's `background` token so content fades into the screen color.
   */
  color?: string;
  /** Apply a frosted-glass blur beneath the color fade. Default true. */
  blur?: boolean;
  /** BlurView intensity (0-100). Default 50. */
  blurIntensity?: number;
  /** BlurView tint. Default 'dark'. */
  blurTint?: 'light' | 'dark' | 'default';
  /** Stack order. Default 50 (below ModalLayoutWrapper's sticky content at 99). */
  zIndex?: number;
  /** Distance from the specified edge in pixels. Default 0. */
  offset?: number;
}

export function ScrollEdgeFade({
  edge,
  height,
  fadeSize,
  color,
  blur = true,
  blurIntensity = 50,
  blurTint = 'dark',
  zIndex = 50,
  offset = 0,
}: ScrollEdgeFadeProps) {
  const themeBackground = useThemeColor('background');
  const fillColor = color ?? themeBackground;

  // Resolve fade band. Clamp so we always have a well-formed 3-stop mask
  // even when callers pass extreme values — a 0 fadeSize produces a hard
  // edge, a height-matching fadeSize produces a pure gradient with no
  // opaque tail.
  const resolvedFade = Math.max(0, Math.min(fadeSize ?? height / 2, height));
  // Location where the opaque band starts, expressed as a 0-1 fraction
  // measured from the top of the region regardless of edge.
  const boundaryFromTop = edge === 'top' ? 1 - resolvedFade / height : resolvedFade / height;

  // Mask always has three stops: outer-opaque, boundary-opaque, outer-transparent.
  // For 'top': opaque at top, fade to transparent at bottom.
  // For 'bottom': transparent at top, fade to opaque at bottom.
  const maskColors = (
    edge === 'top' ? ['black', 'black', 'transparent'] : ['transparent', 'black', 'black']
  ) as [string, string, string];
  const maskLocations = [0, boundaryFromTop, 1] as [number, number, number];

  // Fill runs along the opaque-side half only.
  const fillColors =
    edge === 'top' ? ([fillColor, 'transparent'] as const) : (['transparent', fillColor] as const);
  const fillLocations =
    edge === 'top' ? ([boundaryFromTop, 1] as const) : ([0, boundaryFromTop] as const);

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
      <MaskedView
        style={StyleSheet.absoluteFill}
        maskElement={
          <LinearGradient
            colors={maskColors}
            locations={maskLocations}
            style={StyleSheet.absoluteFill}
          />
        }>
        {blur && (
          <BlurView intensity={blurIntensity} tint={blurTint} style={StyleSheet.absoluteFill} />
        )}
        <LinearGradient
          colors={fillColors as unknown as [string, string, ...string[]]}
          locations={fillLocations as unknown as [number, number, ...number[]]}
          style={StyleSheet.absoluteFill}
        />
      </MaskedView>
    </View>
  );
}
