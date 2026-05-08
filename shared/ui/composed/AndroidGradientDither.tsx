import React from 'react';
import { Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';

type AndroidGradientDitherProps = {
  opacity?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Very subtle Android-only dither for large low-contrast gradients.
 * Android's 8-bit gradient rasterization can band on dark glassy surfaces;
 * a tiny ordered pattern hides the steps without removing the gradient.
 */
export function AndroidGradientDither({
  opacity = 0.2,
  style,
}: AndroidGradientDitherProps): React.ReactElement | null {
  if (Platform.OS !== 'android') return null;

  return (
    <Svg
      pointerEvents="none"
      width="100%"
      height="100%"
      style={[StyleSheet.absoluteFillObject, style]}>
      <Defs>
        <Pattern
          id="android-gradient-dither"
          x="0"
          y="0"
          width="4"
          height="4"
          patternUnits="userSpaceOnUse">
          <Rect x="0" y="0" width="1" height="1" fill="#FFFFFF" opacity="0.2" />
          <Rect x="2" y="1" width="1" height="1" fill="#000000" opacity="0.18" />
          <Rect x="1" y="3" width="1" height="1" fill="#FFFFFF" opacity="0.14" />
          <Rect x="3" y="2" width="1" height="1" fill="#000000" opacity="0.12" />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#android-gradient-dither)" opacity={opacity} />
    </Svg>
  );
}
