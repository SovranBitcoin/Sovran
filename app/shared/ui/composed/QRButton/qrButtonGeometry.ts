import type { ViewStyle } from 'react-native';

/**
 * Geometry and glow for the QR button at a given size. The container clips the
 * painted face; the pressable carries the same shape plus the shadow, so the
 * glow falls outside the clip instead of being cut off by it.
 */
export function qrButtonGeometry(size: number, glowColor: string) {
  const borderRadius = size * 0.18;

  const containerStyle: ViewStyle = {
    width: size,
    height: size,
    borderRadius,
    borderCurve: 'continuous',
    overflow: 'hidden',
  };

  const pressableStyle: ViewStyle = {
    ...containerStyle,
    shadowColor: glowColor,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 10,
    elevation: 5,
  };

  return { borderRadius, containerStyle, pressableStyle };
}
