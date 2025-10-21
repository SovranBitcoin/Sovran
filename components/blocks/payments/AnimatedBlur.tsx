import React, { FC } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { useTheme } from 'providers/ThemeProvider';
import { usePaymentsAnimation } from 'providers/PaymentsAnimationProvider';

export const AnimatedBlur: FC = () => {
  const { getPrimaryColor } = useTheme();
  const { blurIntensity } = usePaymentsAnimation();

  // Animate blur intensity based on screen state
  const rBlurStyle = useAnimatedStyle(() => {
    return {
      opacity: withTiming(blurIntensity.value / 100, { duration: 300 }),
    };
  });

  return (
    <Animated.View style={[StyleSheet.absoluteFillObject, rBlurStyle]} pointerEvents="none">
      <BlurView intensity={100} tint="dark" style={StyleSheet.absoluteFillObject} />
      {/* Additional overlay for better visual depth */}
      <View
        style={[
          StyleSheet.absoluteFillObject,
          {
            backgroundColor: getPrimaryColor('950'),
            opacity: 0.5,
          },
        ]}
      />
    </Animated.View>
  );
};
