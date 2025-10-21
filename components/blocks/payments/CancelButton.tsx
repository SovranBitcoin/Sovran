import React, { FC } from 'react';
import { Text, Pressable } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { CANCEL_CONTAINER_WIDTH, usePaymentsAnimation } from 'providers/PaymentsAnimationProvider';
import { useTheme } from 'providers/ThemeProvider';

// Animated Pressable for smooth transitions
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export const CancelButton: FC = () => {
  const { getPrimaryColor } = useTheme();
  const { screenView, onGoToContacts } = usePaymentsAnimation();

  // Animate button appearance
  const rContainerStyle = useAnimatedStyle(() => {
    return {
      width: withTiming(screenView.value === 'search' ? CANCEL_CONTAINER_WIDTH : 0),
      opacity: screenView.value === 'search' ? withTiming(1) : 0,
      pointerEvents: screenView.value === 'search' ? 'auto' : 'none',
    };
  });

  return (
    <AnimatedPressable
      onPress={onGoToContacts}
      className="z-[999] items-center justify-center"
      style={rContainerStyle}>
      <Text className="font-medium" style={{ color: getPrimaryColor('400') }}>
        Cancel
      </Text>
    </AnimatedPressable>
  );
};
