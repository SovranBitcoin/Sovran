import React from 'react';
import { StyleSheet } from 'react-native';
import opacity from 'hex-color-opacity';
import { LinearGradient } from 'expo-linear-gradient';
import { View } from 'components/ui/View/View';

interface BlurCardFrameProps {
  /** Accent color for the corner highlights */
  accentColor: string;
  /** Children to render inside the frame */
  children?: React.ReactNode;
}

/**
 * A reusable blur card frame with corner highlight gradients.
 * Use this for cards, active states, and containers that need
 * a blur background with subtle accent highlights.
 *
 * Renders absolute-positioned backgrounds as a fragment.
 * Children are rendered alongside to establish the container's height.
 */
export function BlurCardFrame({ accentColor, children }: BlurCardFrameProps) {
  return (
    <>
      {/* Base blur background */}
      <View blur style={StyleSheet.absoluteFillObject} />

      {/* Top-left to bottom-right diagonal gradient */}
      <LinearGradient
        colors={[opacity(accentColor, 0.25), 'transparent', 'transparent']}
        locations={[0, 0.4, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />

      {/* Bottom-right corner highlight */}
      <LinearGradient
        colors={['transparent', 'transparent', opacity(accentColor, 0.15)]}
        locations={[0, 0.6, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />

      {/* Top-right corner highlight */}
      <LinearGradient
        colors={[opacity(accentColor, 0.15), 'transparent']}
        locations={[0, 0.5]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />

      {children}
    </>
  );
}
