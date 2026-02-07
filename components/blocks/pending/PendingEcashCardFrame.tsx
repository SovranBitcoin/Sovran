import React from 'react';
import { StyleSheet } from 'react-native';
import opacity from 'hex-color-opacity';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from 'assets/icons';
import { View } from 'components/ui/View/View';

export function PendingEcashCardFrame({
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
    <>
      {/* Base fill */}
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor }]} />

      {/* Global green wash */}
      <View
        style={[StyleSheet.absoluteFillObject, { backgroundColor: opacity(accentColor, 0.06) }]}
      />

      {/* 3-corner blend (same technique as WalletHealthCardFrame) */}
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

      {/* Subtle top highlight */}
      <LinearGradient
        colors={[opacity(highlightColor, 0.06), 'transparent']}
        locations={[0, 0.7]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Decorative icons */}
      <View style={styles.decorationLeft} pointerEvents="none">
        <Icon name="mdi:clock-outline" size={90} color={opacity(accentColor, 0.08)} />
      </View>
      <View style={styles.decorationRight} pointerEvents="none">
        <Icon name="mdi:cash-multiple" size={140} color={opacity(accentColor, 0.05)} />
      </View>

      {children}
    </>
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
