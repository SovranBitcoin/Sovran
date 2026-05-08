import React from 'react';
import { StyleSheet, type ColorValue, type StyleProp, type ViewStyle } from 'react-native';
import opacity from 'hex-color-opacity';
import { MeshGradientView } from 'expo-mesh-gradient';
import { Log } from '@/shared/lib/logger';
import { View } from '@/shared/ui/primitives/View/View';

/** Size of the gradient container box (pixels) */
const GLOW_BOX_SIZE = 70;

/** Pixel distances for gradient fade stops (diagonal distance from corner) */
const GLOW_MID_PX = 8; // Where glow transitions to softer
const GLOW_END_PX = 40; // Where glow fully fades out

/** Convert pixel distance to location (0-1) within the gradient box */
const pxToLocation = (px: number) => px / (GLOW_BOX_SIZE * Math.SQRT2);

/** Pre-calculated locations based on pixel distances */
const GLOW_MID_LOCATION = pxToLocation(GLOW_MID_PX);
const GLOW_END_LOCATION = pxToLocation(GLOW_END_PX);
const MESH_EDGE_POINTS = [
  0,
  Math.min(GLOW_MID_LOCATION * 2, 1),
  Math.min(GLOW_END_LOCATION * 2, 1),
  1,
];
const MESH_POINTS = MESH_EDGE_POINTS.flatMap((y) => MESH_EDGE_POINTS.map((x) => [x, y]));
const MESH_RESOLUTION = { x: 24, y: 24 };

type GlowVariant = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | 'diagonal' | 'right';
type GlowCorner = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';

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
}

function getCornerLocation(corner: GlowCorner, x: number, y: number) {
  switch (corner) {
    case 'topLeft':
      return (x + y) / 2;
    case 'topRight':
      return (1 - x + y) / 2;
    case 'bottomLeft':
      return (x + (1 - y)) / 2;
    case 'bottomRight':
      return (1 - x + (1 - y)) / 2;
  }
}

function getGlowAlpha(location: number, peakAlpha: number) {
  if (location <= GLOW_MID_LOCATION) {
    const progress = location / GLOW_MID_LOCATION;
    return peakAlpha + (0.1 - peakAlpha) * progress;
  }

  if (location <= GLOW_END_LOCATION) {
    const progress = (location - GLOW_MID_LOCATION) / (GLOW_END_LOCATION - GLOW_MID_LOCATION);
    return 0.1 * (1 - progress);
  }

  return 0;
}

function getGlowColors(corner: GlowCorner, accentColor: string, peakAlpha: number): ColorValue[] {
  return MESH_POINTS.map(([x, y]) =>
    opacity(accentColor, getGlowAlpha(getCornerLocation(corner, x, y), peakAlpha))
  );
}

function CornerGlow({
  accentColor,
  corner,
  peakAlpha = 0.6,
  style,
}: {
  accentColor: string;
  corner: GlowCorner;
  peakAlpha?: number;
  style: StyleProp<ViewStyle>;
}) {
  return (
    <MeshGradientView
      columns={MESH_EDGE_POINTS.length}
      rows={MESH_EDGE_POINTS.length}
      colors={getGlowColors(corner, accentColor, peakAlpha)}
      points={MESH_POINTS}
      resolution={MESH_RESOLUTION}
      smoothsColors
      style={style}
      pointerEvents="none"
    />
  );
}

/**
 * A reusable blur card frame with corner highlight gradients.
 * Use this for cards, active states, and containers that need
 * a blur background with subtle accent highlights.
 *
 * Renders absolute-positioned backgrounds as a fragment.
 * Children are rendered alongside to establish the container's height.
 */
export function BlurCardFrame({ accentColor, children, variant = 'diagonal' }: BlurCardFrameProps) {
  return (
    <Log name="BlurCardFrame">
      {/* Base blur background */}
      <View blur style={StyleSheet.absoluteFillObject} />

      {/* Render gradients based on variant - fixed size boxes with pixel-based fade */}
      {(variant === 'topLeft' || variant === 'diagonal') && (
        <CornerGlow accentColor={accentColor} corner="topLeft" style={styles.topLeft} />
      )}

      {(variant === 'topRight' || variant === 'diagonal' || variant === 'right') && (
        <CornerGlow accentColor={accentColor} corner="topRight" style={styles.topRight} />
      )}

      {variant === 'bottomLeft' && (
        <CornerGlow accentColor={accentColor} corner="bottomLeft" style={styles.bottomLeft} />
      )}

      {(variant === 'bottomRight' || variant === 'diagonal' || variant === 'right') && (
        <CornerGlow
          accentColor={accentColor}
          corner="bottomRight"
          peakAlpha={0.45}
          style={styles.bottomRight}
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
