import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import opacity from 'hex-color-opacity';
import { LinearGradient } from 'expo-linear-gradient';
import { Log } from '@/shared/lib/logger';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { View } from '@/shared/ui/primitives/View/View';

/** Size of the gradient container box (pixels) */
const GLOW_BOX_SIZE = 70;

/** Pixel distances for gradient fade stops (diagonal distance from corner) */
const GLOW_MID_PX = 8; // Where glow transitions to softer
const GLOW_END_PX = 40; // Where glow fully fades out

/** Convert pixel distance to location (0-1) within the gradient box */
const pxToLocation = (px: number) => px / (GLOW_BOX_SIZE * Math.SQRT2);

/** Pre-calculated locations based on pixel distances */
const LOCATIONS: [number, number, number] = [
  0,
  pxToLocation(GLOW_MID_PX),
  pxToLocation(GLOW_END_PX),
];

type GlowVariant = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | 'diagonal' | 'right';

interface BlurCardFrameProps {
  /** Accent color for the corner highlights */
  accentColor: string;
  /** Children to render inside the frame */
  children?: React.ReactNode;
  /**
   * Glow pattern variant for visual variety when cards are adjacent.
   * - 'topLeft': Primary glow in top-left corner
   * - 'topRight': Primary glow in top-right corner
   * - 'bottomLeft': Primary glow in bottom-left corner
   * - 'bottomRight': Primary glow in bottom-right corner
   * - 'diagonal': Subtle glows on opposite corners (default)
   * - 'right': Glows on the two right corners only
   */
  variant?: GlowVariant;
  /**
   * Whether to render the corner-accent gradients. Defaults to `true`.
   *
   * Set `false` on small containers (≲ 60 px on the short side). The glow
   * geometry is fixed at 70×70 with the fade calibrated to 40 px diagonal
   * from each corner — on a container smaller than that, two opposite
   * gradients overlap across the whole face and the 0.6-alpha corner pixel
   * reads as a hotspot instead of a soft accent. With `glow={false}` the
   * frame degrades to blur + caller-supplied border only.
   */
  glow?: boolean;
}

/**
 * A reusable blur card frame with corner highlight gradients.
 * Use this for cards, active states, and containers that need
 * a blur background with subtle accent highlights.
 *
 * Renders absolute-positioned backgrounds as a fragment.
 * Children are rendered alongside to establish the container's height.
 */
export function BlurCardFrame({
  accentColor,
  children,
  variant = 'diagonal',
  glow = true,
}: BlurCardFrameProps) {
  const androidSurface = useThemeColor('surface-secondary');

  if (Platform.OS === 'android') {
    return (
      <Log name="BlurCardFrame">
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: androidSurface }]} />
        {children}
      </Log>
    );
  }

  return (
    <Log name="BlurCardFrame">
      {/* Base blur background */}
      <View blur style={StyleSheet.absoluteFillObject} />

      {/* Render gradients based on variant - fixed size boxes with pixel-based fade */}
      {glow && (variant === 'topLeft' || variant === 'diagonal') && (
        <LinearGradient
          colors={[opacity(accentColor, 0.6), opacity(accentColor, 0.1), opacity(accentColor, 0)]}
          locations={LOCATIONS}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.topLeft}
          pointerEvents="none"
        />
      )}

      {glow && (variant === 'topRight' || variant === 'diagonal' || variant === 'right') && (
        <LinearGradient
          colors={[opacity(accentColor, 0.6), opacity(accentColor, 0.1), opacity(accentColor, 0)]}
          locations={LOCATIONS}
          start={{ x: 1, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.topRight}
          pointerEvents="none"
        />
      )}

      {glow && variant === 'bottomLeft' && (
        <LinearGradient
          colors={[opacity(accentColor, 0.6), opacity(accentColor, 0.1), opacity(accentColor, 0)]}
          locations={LOCATIONS}
          start={{ x: 0, y: 1 }}
          end={{ x: 1, y: 0 }}
          style={styles.bottomLeft}
          pointerEvents="none"
        />
      )}

      {glow && (variant === 'bottomRight' || variant === 'diagonal' || variant === 'right') && (
        <LinearGradient
          colors={[opacity(accentColor, 0.45), opacity(accentColor, 0.1), opacity(accentColor, 0)]}
          locations={LOCATIONS}
          start={{ x: 1, y: 1 }}
          end={{ x: 0, y: 0 }}
          style={styles.bottomRight}
          pointerEvents="none"
        />
      )}

      {children}
    </Log>
  );
}

const styles = StyleSheet.create({
  topLeft: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: GLOW_BOX_SIZE,
    height: GLOW_BOX_SIZE,
  },
  topRight: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: GLOW_BOX_SIZE,
    height: GLOW_BOX_SIZE,
  },
  bottomLeft: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: GLOW_BOX_SIZE,
    height: GLOW_BOX_SIZE,
  },
  bottomRight: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: GLOW_BOX_SIZE,
    height: GLOW_BOX_SIZE,
  },
});
