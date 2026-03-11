import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { PressableFeedback } from 'heroui-native';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

export interface QRButtonProps {
  onPress: () => void;
  accentColor?: string;
  color?: string;
  size?: number;
}

const DEFAULT_SIZE = 64;

export function QRButton(props: QRButtonProps): React.ReactElement {
  const [surfaceForeground, accent] = useThemeColor(['surface-foreground', 'accent'] as const);

  const { onPress, size = DEFAULT_SIZE } = props;

  const borderRadius = size * 0.18;
  const accentGlow = { color: accent, opacity: 0.6, radius: 10, offset: { width: 0, height: 0 } };

  const containerStyle = {
    width: size,
    height: size,
    borderRadius,
    overflow: 'hidden' as const,
  };

  const pressableStyle = {
    ...containerStyle,
    shadowColor: accentGlow.color,
    shadowOffset: accentGlow.offset,
    shadowOpacity: accentGlow.opacity,
    shadowRadius: accentGlow.radius,
    elevation: 5,
  };

  return (
    <PressableFeedback
      animation={false}
      onPress={onPress}
      style={[styles.pressable, pressableStyle]}>
      <PressableFeedback.Ripple />
      <View style={[styles.container, containerStyle]} pointerEvents="none">
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#0f0f12' }]} />
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: opacity(accent, 0.35) }]} />
        <LinearGradient
          colors={[accent, opacity(accent, 0.25), 'transparent']}
          locations={[0, 0.2, 0.6]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <View
          style={[
            StyleSheet.absoluteFillObject,
            { borderWidth: 1, borderColor: opacity(accent, 0.4) },
          ]}
        />
      </View>
      <View
        style={[StyleSheet.absoluteFillObject, { justifyContent: 'center', alignItems: 'center' }]}
        pointerEvents="none">
        <Icon name="stash:qr-code" size={32} color={surfaceForeground} />
      </View>
    </PressableFeedback>
  );
}

const styles = StyleSheet.create({
  pressable: {
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  container: {
    overflow: 'hidden',
    position: 'absolute',
  },
});
