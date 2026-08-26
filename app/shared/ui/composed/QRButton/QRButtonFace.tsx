import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import Icon from 'assets/icons';
import { withAlpha } from '@/shared/lib/color';

/**
 * The QR button's painted face: an opaque base, a tinted wash, the vertical
 * gradient, and a hairline border, all absolutely filling whatever container
 * clips them. The container itself is platform-specific (a squircle on Android,
 * a continuous-curve view on iOS), so only the layers live here.
 *
 * Colours invert with the theme: on dark themes the base is the foreground
 * (white) with a soft white gradient; on light themes it is the foreground
 * (black) with a soft black gradient.
 */
export function QRButtonFace({
  foreground,
  background,
}: {
  foreground: string;
  background: string;
}): React.ReactElement {
  return (
    <>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: background }]} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha(foreground, 0.65) }]} />
      <LinearGradient
        colors={[
          foreground,
          withAlpha(foreground, 0.8),
          withAlpha(foreground, 0.7),
          withAlpha(foreground, 0.6),
        ]}
        locations={[0, 0.35, 0.6, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View
        style={[
          StyleSheet.absoluteFill,
          { borderWidth: 1, borderColor: withAlpha(foreground, 0.4) },
        ]}
      />
    </>
  );
}

/**
 * The QR glyph centered over the face. Rendered as a sibling of the clipped
 * face container (not inside it) so the icon isn't affected by the container's
 * squircle clipping.
 */
export function QRButtonGlyph({ background }: { background: string }): React.ReactElement {
  return (
    <View
      style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center' }]}
      pointerEvents="none">
      <Icon name="stash:qr-code" size={38} color={background} />
    </View>
  );
}
