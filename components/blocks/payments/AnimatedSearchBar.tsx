import React, { FC } from 'react';
import { TextInput, Pressable } from 'react-native';
import Animated, {
  useAnimatedStyle,
  withSpring,
  withTiming,
  useSharedValue,
  useAnimatedReaction,
  interpolateColor,
} from 'react-native-reanimated';
import { useTheme } from 'providers/ThemeProvider';
import {
  SEARCHBAR_DEFAULT_WIDTH,
  SEARCHBAR_SEARCH_WIDTH,
  TRIGGER_DRAG_DISTANCE,
  usePaymentsAnimation,
} from 'providers/PaymentsAnimationProvider';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { Avatar } from 'components/ui/Avatar';
import { HStack } from '@/components/ui/View';

export const AnimatedSearchBar: FC = () => {
  const { keys: nostrKeys } = useNostrKeysContext();
  const { getPrimaryColor } = useTheme();
  const { screenView, offsetY, isListDragging, searchQuery, onGoToSearch, onSearchQueryChange } =
    usePaymentsAnimation();

  // Get colors OUTSIDE the worklet
  const color800 = getPrimaryColor('800');
  const color700 = getPrimaryColor('700');
  const color500 = getPrimaryColor('500');
  const color200 = getPrimaryColor('200');
  const color300 = getPrimaryColor('300');

  // Create a shared value for color progress
  const colorProgress = useSharedValue(0);

  // Watch for changes and update colorProgress
  useAnimatedReaction(
    () => {
      return isListDragging.value && offsetY.value < 0 && offsetY.value < TRIGGER_DRAG_DISTANCE;
    },
    (shouldHighlight) => {
      colorProgress.value = withTiming(shouldHighlight ? 1 : 0, { duration: 200 });
    }
  );

  // Animate search bar width and scale based on drag state
  const rContainerStyle = useAnimatedStyle(() => {
    if (isListDragging.value && offsetY.value < 0 && offsetY.value < TRIGGER_DRAG_DISTANCE) {
      return {
        transform: [{ scale: withTiming(1.05) }],
      };
    }
    return {
      width: withSpring(
        screenView.value === 'contacts' ? SEARCHBAR_DEFAULT_WIDTH : SEARCHBAR_SEARCH_WIDTH,
        {
          damping: 100,
          stiffness: 1400,
        }
      ),
      transform: [{ scale: withTiming(1) }],
    };
  });

  // Animate background color without layout changes
  const rInputStyle = useAnimatedStyle(() => {
    const backgroundColor = interpolateColor(colorProgress.value, [0, 1], [color700, color800]);

    return {
      backgroundColor,
    };
  });

  const handlePress = () => {
    console.log('Search bar pressed!');
    onGoToSearch();
  };

  const handleTextChange = (text: string) => {
    onSearchQueryChange(text);
  };

  return (
    <Animated.View className="z-[999] h-[48px] overflow-hidden" style={rContainerStyle}>
      <HStack spacing={8} align="flex-start" className="h-[48px] overflow-hidden">
        <Avatar seed={nostrKeys?.pubkey} size={48} variant="person" />
        <Pressable onPress={handlePress} className="h-[48px] flex-1 overflow-hidden">
          <Animated.View style={rInputStyle} className="h-[48px] overflow-hidden rounded-2xl">
            <TextInput
              ref={usePaymentsAnimation().inputRef}
              placeholder="Search for contacts"
              placeholderTextColor={color500}
              value={searchQuery}
              onChangeText={handleTextChange}
              editable={false}
              pointerEvents="none"
              className="h-full overflow-hidden px-4"
              style={{
                backgroundColor: 'transparent',
                color: color200,
                fontSize: 16,
                fontFamily: 'OverpassRegular',
                // borderCurve: '',
              }}
              selectionColor={color300}
            />
          </Animated.View>
        </Pressable>
      </HStack>
    </Animated.View>
  );
};
