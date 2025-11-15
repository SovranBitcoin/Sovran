import React, { FC } from 'react';
import { TextInput, View, Pressable } from 'react-native';
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
import { useNavigation } from 'expo-router';
import { DrawerActions } from '@react-navigation/native';
import { EnhancedHaptics } from 'components/ui/Haptics';

export const AnimatedSearchBar: FC = () => {
  const { keys: nostrKeys } = useNostrKeysContext();
  const { getPrimaryColor } = useTheme();
  const navigation = useNavigation();
  const {
    screenView,
    offsetY,
    isListDragging,
    searchQuery,
    onGoToSearch,
    onSearchQueryChange,
    inputRef,
  } = usePaymentsAnimation();

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

  // Animate avatar visibility with translateX
  const rAvatarStyle = useAnimatedStyle(() => {
    const isSearching = screenView.value === 'search';

    return {
      opacity: withTiming(isSearching ? 0 : 1, {
        duration: 200,
      }),
      transform: [
        {
          translateX: withSpring(isSearching ? -56 : 0, {
            damping: 100,
            stiffness: 1400,
          }),
        },
        {
          scale: withSpring(isSearching ? 0.8 : 1, {
            damping: 100,
            stiffness: 1400,
          }),
        },
      ],
    };
  });

  // Animate input container to account for avatar space
  const rInputContainerStyle = useAnimatedStyle(() => {
    const isSearching = screenView.value === 'search';

    return {
      paddingLeft: withSpring(isSearching ? 0 : 56, {
        damping: 100,
        stiffness: 1400,
      }),
    };
  });

  const handlePress = () => {
    console.log('[DEBUG AnimatedSearchBar] Search bar pressed!');
    console.log('[DEBUG AnimatedSearchBar] Current screenView:', screenView.value);
    onGoToSearch();
    // Focus the input after transitioning to search mode
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }, 100);
  };

  const handleTextChange = (text: string) => {
    onSearchQueryChange(text);
  };

  const handleAvatarPress = async () => {
    await EnhancedHaptics.navigateHaptic();
    navigation.dispatch(DrawerActions.openDrawer());
  };

  return (
    <Animated.View className="z-[999] h-[48px] overflow-hidden " style={rContainerStyle}>
      <View className="relative h-[48px]">
        {/* Avatar - absolutely positioned */}
        <Animated.View
          style={[rAvatarStyle, { position: 'absolute', left: 14, top: 0, zIndex: 1 }]}>
          <Pressable onPress={handleAvatarPress}>
            <Avatar seed={nostrKeys?.pubkey} size={48} variant="person" />
          </Pressable>
        </Animated.View>

        {/* Search Input */}
        <Animated.View style={rInputContainerStyle} className="ml-4 h-[48px]">
          <Animated.View style={rInputStyle} className="h-[48px] rounded-2xl">
            <TextInput
              ref={inputRef}
              placeholder="Search for contacts"
              placeholderTextColor={color500}
              value={searchQuery}
              onChangeText={handleTextChange}
              onFocus={handlePress}
              className="h-full px-4"
              style={{
                backgroundColor: 'transparent',
                color: color200,
                fontSize: 16,
                fontFamily: 'OverpassRegular',
              }}
              selectionColor={color300}
            />
          </Animated.View>
        </Animated.View>
      </View>
    </Animated.View>
  );
};
