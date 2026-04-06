import React from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import opacity from 'hex-color-opacity';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from 'assets/icons';
import { Log } from '@/shared/lib/logger';
import { View } from '@/shared/ui/primitives/View/View';

export type DecorationIcon = {
  name: string;
  size: number;
  style: ViewStyle;
};

export function GradientCardFrame({
  accentColor,
  backgroundColor,
  highlightColor,
  leftIcon,
  rightIcon,
  children,
}: {
  accentColor: string;
  backgroundColor: string;
  highlightColor: string;
  leftIcon: DecorationIcon;
  rightIcon: DecorationIcon;
  children?: React.ReactNode;
}) {
  return (
    <Log name="GradientCardFrame">
      <View className="absolute inset-0" style={{ backgroundColor }} />
      <View className="absolute inset-0" style={{ backgroundColor: opacity(accentColor, 0.06) }} />
      <LinearGradient
        colors={[opacity(accentColor, 0.34), opacity(accentColor, 0.12), 'transparent']}
        locations={[0, 0.55, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <LinearGradient
        colors={[opacity(accentColor, 0.22), 'transparent', opacity(accentColor, 0.26)]}
        locations={[0, 0.55, 1]}
        start={{ x: 1, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <LinearGradient
        colors={[opacity(highlightColor, 0.06), 'transparent']}
        locations={[0, 0.7]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <View className="absolute" style={leftIcon.style} pointerEvents="none">
        <Icon name={leftIcon.name} size={leftIcon.size} color={opacity(accentColor, 0.08)} />
      </View>
      <View className="absolute" style={rightIcon.style} pointerEvents="none">
        <Icon name={rightIcon.name} size={rightIcon.size} color={opacity(accentColor, 0.05)} />
      </View>

      {children}
    </Log>
  );
}
