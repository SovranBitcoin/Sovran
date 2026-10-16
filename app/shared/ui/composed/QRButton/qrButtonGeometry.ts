import type { ViewStyle } from 'react-native';

/**
 * Geometry for the QR button at a given size.
 *
 * `radius` comes from the active style: a pill style makes the button a
 * circle, a square style makes it a square, so it always matches the buttons
 * it sits between. Only the glass style passes a `glowColor`; the container
 * clips the painted face and the pressable carries the same shape plus the
 * glow, so the glow falls outside the clip instead of being cut off by it.
 */
export function qrButtonGeometry(size: number, radius: number, glowColor: string | null) {
  const borderRadius = Math.min(radius, size / 2);

  const containerStyle: ViewStyle = {
    width: size,
    height: size,
    borderRadius,
    borderCurve: 'continuous',
    overflow: 'hidden',
  };

  const pressableStyle: ViewStyle = glowColor
    ? {
        ...containerStyle,
        shadowColor: glowColor,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.6,
        shadowRadius: 10,
        elevation: 5,
      }
    : containerStyle;

  return { borderRadius, containerStyle, pressableStyle };
}
