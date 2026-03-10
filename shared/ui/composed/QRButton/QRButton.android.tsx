import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import { TouchableOpacity } from '@/shared/ui/primitives/TouchableOpacity';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useTheme } from '@/shared/providers/ThemeProvider';
import { isBackgroundImageTheme } from '@/config/backgroundImageThemes';

export interface QRButtonProps {
  onPress: () => void;
  accentColor?: string;
  color?: string;
  size?: number;
}

const DEFAULT_SIZE = 72;

export function QRButton(props: QRButtonProps): React.ReactElement {
  const { currentTheme } = useTheme();
  const isWallpaper = isBackgroundImageTheme(currentTheme);

  const [background, surfaceForeground, shade0, shade50, shade100, gradient100, gradient200] =
    useThemeColor([
      'background',
      'surface-foreground',
      'shade-0',
      'shade-50',
      'shade-100',
      'gradient-100',
      'gradient-200',
    ] as const);

  const color0 = isWallpaper ? gradient100 : shade0;
  const color1 = isWallpaper ? gradient200 : shade50;
  const color2 = isWallpaper ? gradient200 : shade100;

  const { onPress, accentColor = color2, size = DEFAULT_SIZE } = props;

  const containerStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    borderWidth: 1,
    borderColor: opacity(color2, 0.4),
  };

  return (
    <TouchableOpacity
      style={[styles.touchable, { ...containerStyle, shadowColor: accentColor }]}
      className="items-center justify-center"
      haptics={{ type: 'impact', impactStyle: 'light' }}
      activeOpacity={0.75}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      onPress={onPress}>
      <View style={[styles.container, containerStyle]} pointerEvents="none">
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: background }]} />
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: opacity(color1, 0.12) }]} />
        <LinearGradient
          colors={[opacity(color0, 0.5), opacity(color1, 0.25), 'transparent']}
          locations={[0, 0.55, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <LinearGradient
          colors={[opacity(color1, 0.35), 'transparent', opacity(color2, 0.4)]}
          locations={[0, 0.55, 1]}
          start={{ x: 1, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <LinearGradient
          colors={[opacity(surfaceForeground, 0.06), 'transparent']}
          locations={[0, 0.7]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
      </View>
      <View
        style={[StyleSheet.absoluteFillObject, { justifyContent: 'center', alignItems: 'center' }]}
        pointerEvents="none">
        <Icon name="stash:qr-code" size={24} color={surfaceForeground} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  touchable: {
    borderCurve: 'continuous',
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.75,
    shadowRadius: 8,
    elevation: 5,
  },
  container: {
    overflow: 'hidden',
    position: 'absolute',
  },
});
