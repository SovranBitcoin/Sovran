import React from 'react';
import { StyleSheet } from 'react-native';
import opacity from 'hex-color-opacity';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from 'assets/icons';
import { View } from '@/shared/ui/primitives/View/View';
import { Log } from '@/shared/lib/logger';

export function WalletHealthCardFrame({
  accentColor,
  backgroundColor,
  highlightColor,
  children,
}: {
  accentColor: string;
  backgroundColor: string;
  highlightColor: string;
  children?: React.ReactNode;
}) {
  return (
    <Log name="WalletHealthCardFrame">
      {/* Base fill: warm near-black so the card never feels muddy/grey */}
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor }]} />

      {/* Global warm wash so the card always feels “red-tinted”, not grey */}
      <View
        style={[StyleSheet.absoluteFillObject, { backgroundColor: opacity(accentColor, 0.06) }]}
      />

      {/**
       * 3-corner blend:
       * expo-linear-gradient is 1D, so we layer 2 gradients to approximate a 2D corner blend.
       */}
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

      {/* Subtle top highlight (keeps it premium, not flat) */}
      <LinearGradient
        colors={[opacity(highlightColor, 0.06), 'transparent']}
        locations={[0, 0.7]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Decorative hearts */}
      <View style={styles.decorationLeft} pointerEvents="none">
        <Icon name="garden:heart-fill-16" size={90} color={opacity(accentColor, 0.08)} />
      </View>
      <View style={styles.decorationRight} pointerEvents="none">
        <Icon name="garden:heart-fill-16" size={140} color={opacity(accentColor, 0.05)} />
      </View>

      {children}
    </Log>
  );
}

const styles = StyleSheet.create({
  decorationLeft: {
    position: 'absolute',
    top: -18,
    left: -18,
    transform: [{ rotate: '-12deg' }],
  },
  decorationRight: {
    position: 'absolute',
    bottom: -34,
    right: -34,
    transform: [{ rotate: '14deg' }],
  },
});
