import React, { useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { BlurView, type BlurTint } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
import { easeGradient } from 'react-native-easing-gradient';
import opacity from 'hex-color-opacity';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

type FadeEdge = 'top' | 'bottom';

const { colors: MASK_COLORS_BOTTOM, locations: MASK_LOCATIONS_BOTTOM } = easeGradient({
  colorStops: {
    0: { color: 'transparent' },
    0.5: { color: 'rgba(0,0,0,0.99)' },
    1: { color: 'black' },
  },
});

const { colors: MASK_COLORS_TOP, locations: MASK_LOCATIONS_TOP } = easeGradient({
  colorStops: {
    0: { color: 'black' },
    0.5: { color: 'rgba(0,0,0,0.99)' },
    1: { color: 'transparent' },
  },
});

interface ScrollFadeMaskProps {
  /** Which edge of the parent the fade clings to. */
  edge?: FadeEdge;
  /** Height of the fade in dp. Default 56. */
  height?: number;
  /** Opaque-end color. Defaults to the theme `surface-secondary` token —
   *  the typical Menu / sheet background. */
  color?: string | null;
  /** Whether to apply the gradient blur. Default true. */
  blur?: boolean;
  blurIntensity?: number;
  blurTint?: BlurTint;
}

/**
 * Edge-fade overlay used at the boundary of a scrollable area inside a
 * sheet / menu. Combines a frosted-glass blur masked by an eased
 * gradient (so iOS reads enough alpha gradation to render a continuous
 * gradient blur) with a translucent → opaque color gradient layered on
 * top, matching the `BottomButtons` pattern. Scrolling content visibly
 * fades into the menu surface as it reaches the edge.
 *
 * Place as an `absolute`-positioned sibling of a scroll view. Default
 * `edge="bottom"`.
 */
export function ScrollFadeMask({
  edge = 'bottom',
  height = 56,
  color,
  blur = true,
  blurIntensity = 10,
  blurTint = Platform.OS === 'ios' ? 'systemChromeMaterialDark' : 'dark',
}: ScrollFadeMaskProps) {
  const surfaceSecondary = useThemeColor('surface-secondary');
  const resolved = color === null ? null : (color ?? surfaceSecondary);
  const isTop = edge === 'top';

  const colorGradientColors = useMemo(() => {
    if (!resolved) return null;
    const transparent = opacity(resolved, 0);
    const semiOpaque = opacity(resolved, 0.75);
    const solid = resolved;
    return isTop
      ? ([solid, semiOpaque, transparent] as const)
      : ([transparent, semiOpaque, solid] as const);
  }, [resolved, isTop]);

  const maskColors = isTop ? MASK_COLORS_TOP : MASK_COLORS_BOTTOM;
  const maskLocations = isTop ? MASK_LOCATIONS_TOP : MASK_LOCATIONS_BOTTOM;

  return (
    <View
      pointerEvents="none"
      style={[styles.host, { height }, isTop ? { top: 0 } : { bottom: 0 }]}>
      {blur && (
        <MaskedView
          style={StyleSheet.absoluteFill}
          maskElement={
            <LinearGradient
              colors={maskColors as unknown as readonly [string, string, ...string[]]}
              locations={maskLocations as unknown as readonly [number, number, ...number[]]}
              style={StyleSheet.absoluteFill}
            />
          }>
          <BlurView intensity={blurIntensity} tint={blurTint} style={StyleSheet.absoluteFill} />
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
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
});
