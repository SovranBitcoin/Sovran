import React from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import { withAlpha } from '@/shared/lib/color';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from 'assets/icons';
import { Log } from '@/shared/lib/logger';
import { View } from '@/shared/ui/primitives/View/View';

type DecorationIcon = {
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
      <View
        className="absolute inset-0"
        style={{ backgroundColor: withAlpha(accentColor, 0.06) }}
      />
      <LinearGradient
        colors={[withAlpha(accentColor, 0.34), withAlpha(accentColor, 0.12), 'transparent']}
        locations={[0, 0.55, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={[withAlpha(accentColor, 0.22), 'transparent', withAlpha(accentColor, 0.26)]}
        locations={[0, 0.55, 1]}
        start={{ x: 1, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={[withAlpha(highlightColor, 0.06), 'transparent']}
        locations={[0, 0.7]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <View className="absolute" style={leftIcon.style} pointerEvents="none">
        <Icon name={leftIcon.name} size={leftIcon.size} color={withAlpha(accentColor, 0.08)} />
      </View>
      <View className="absolute" style={rightIcon.style} pointerEvents="none">
        <Icon name={rightIcon.name} size={rightIcon.size} color={withAlpha(accentColor, 0.05)} />
      </View>

      {children}
    </Log>
  );
}
