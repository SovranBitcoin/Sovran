/**
 * Subtle "listening" indicator for the wallet NFC button while the ambient
 * tap-to-pay loop is armed (Android). A small accent dot on the button's
 * top-right edge breathing on a slow repeat — visible without reading as an
 * error badge or notification count.
 */

import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useThemeColor } from '@/shared/hooks/useThemeColor';

const DOT_SIZE = 10;
const BREATHE_MS = 1400;

export function AmbientNfcPulseDot() {
  const accent = useThemeColor('accent');
  const breathe = useSharedValue(0);

  useEffect(() => {
    breathe.value = withRepeat(
      withTiming(1, { duration: BREATHE_MS, easing: Easing.inOut(Easing.sin) }),
      -1,
      true
    );
    return () => {
      breathe.value = 0;
    };
  }, [breathe]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.45 + breathe.value * 0.55,
    transform: [{ scale: 0.85 + breathe.value * 0.15 }],
  }));

  return (
    <Animated.View pointerEvents="none" style={[styles.dot, { backgroundColor: accent }, style]} />
  );
}

const styles = StyleSheet.create({
  dot: {
    position: 'absolute',
    top: 0,
    right: 2,
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
  },
});
