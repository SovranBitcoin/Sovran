import React, { FC } from 'react';
import { Text, Pressable } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { CANCEL_CONTAINER_WIDTH, usePaymentsAnimation } from 'providers/PaymentsAnimationProvider';
import { useTheme } from 'providers/ThemeProvider';

// Animated Pressable for smooth transitions
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export const CancelButton: FC = () => {
  const { getPrimaryColor } = useTheme();
  const { screenView, currentView, searchQuery, onGoToContacts, onSearchQueryChange } =
    usePaymentsAnimation();

  const isSearchMode = currentView === 'search';

  // Animate button appearance
  const rContainerStyle = useAnimatedStyle(() => {
    return {
      width: withTiming(screenView.value === 'search' ? CANCEL_CONTAINER_WIDTH : 0),
      opacity: screenView.value === 'search' ? withTiming(1) : 0,
    };
  });

  const handlePress = () => {
    console.log('[DEBUG CancelButton] Pressed, searchQuery:', searchQuery);
    if (searchQuery.trim() !== '') {
      // If there's text, clear it
      onSearchQueryChange('');
    } else {
      // If no text, go back to contacts
      console.log('[DEBUG CancelButton] Calling onGoToContacts');
      onGoToContacts();
    }
  };

  const buttonText = searchQuery.trim() !== '' ? 'Clear' : 'Cancel';

  return (
    <AnimatedPressable
      onPress={handlePress}
      className="z-[999] items-center justify-center"
      style={rContainerStyle}
      pointerEvents={isSearchMode ? 'auto' : 'none'}>
      <Text className="font-medium" style={{ color: getPrimaryColor('400') }}>
        {buttonText}
      </Text>
    </AnimatedPressable>
  );
};
