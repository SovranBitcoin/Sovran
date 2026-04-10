import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import { Log } from '@/shared/lib/logger';
import { TouchableOpacity } from '@/shared/ui/primitives/TouchableOpacity';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

export interface QRButtonProps {
  onPress: () => void;
  accentColor?: string;
  color?: string;
  size?: number;
}

const DEFAULT_SIZE = 72;

const BUTTON_COLOR = '#FFFFFF';

export function QRButton(props: QRButtonProps): React.ReactElement {
  const [background, surfaceForeground] = useThemeColor([
    'background',
    'surface-foreground',
  ] as const);
  const { onPress, accentColor = BUTTON_COLOR, size = DEFAULT_SIZE } = props;

  const containerStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    borderWidth: 1,
    borderColor: opacity(BUTTON_COLOR, 0.4),
  };

  return (
    <Log name="QRButton">
      <TouchableOpacity
        style={[styles.touchable, { ...containerStyle, shadowColor: accentColor }]}
        className="items-center justify-center"
        haptics={{ type: 'impact', impactStyle: 'light' }}
        activeOpacity={0.75}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        onPress={onPress}>
        <View style={[styles.container, containerStyle]} pointerEvents="none">
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: background }]} />
          <View
            style={[StyleSheet.absoluteFillObject, { backgroundColor: opacity(BUTTON_COLOR, 0.3) }]}
          />
          <LinearGradient
            colors={[
              opacity(BUTTON_COLOR, 0.7),
              opacity(BUTTON_COLOR, 0.4),
              opacity(BUTTON_COLOR, 0.15),
              'transparent',
            ]}
            locations={[0, 0.25, 0.6, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          <LinearGradient
            colors={[
              opacity(BUTTON_COLOR, 0.5),
              opacity(BUTTON_COLOR, 0.2),
              'transparent',
              opacity(BUTTON_COLOR, 0.25),
            ]}
            locations={[0, 0.3, 0.65, 1]}
            start={{ x: 1, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          <LinearGradient
            colors={[opacity(surfaceForeground, 0.08), 'transparent']}
            locations={[0, 0.65]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
        </View>
        <View
          style={[
            StyleSheet.absoluteFillObject,
            { justifyContent: 'center', alignItems: 'center' },
          ]}
          pointerEvents="none">
          <Icon name="stash:qr-code" size={24} color={surfaceForeground} />
        </View>
      </TouchableOpacity>
    </Log>
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
