import React, { useCallback } from 'react';
import { useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import Icon from 'assets/icons';

const THUMB_SIZE = 40;
const TRACK_PADDING = 4;
const SCREEN_PADDING_X = 48;
const COMPLETE_THRESHOLD = 0.9;
const SPRING = { damping: 20, stiffness: 200 } as const;

interface SlideToConfirmProps {
  onConfirm: () => void;
  iconName: React.ComponentProps<typeof Icon>['name'];
  trackColor: string;
  thumbColor: string;
  textColor: string;
  iconColor: string;
  label?: string;
}

export const SlideToConfirm: React.FC<SlideToConfirmProps> = ({
  onConfirm,
  iconName,
  trackColor,
  thumbColor,
  textColor,
  iconColor,
  label = 'Swipe to confirm',
}) => {
  const { width: windowWidth } = useWindowDimensions();
  const sliderWidth = windowWidth - SCREEN_PADDING_X;
  const maxTranslate = sliderWidth - THUMB_SIZE - TRACK_PADDING * 2;
  const translateX = useSharedValue(0);
  const isComplete = useSharedValue(false);

  const handleComplete = useCallback(() => {
    onConfirm();
  }, [onConfirm]);

  const panGesture = Gesture.Pan()
    .onUpdate((event) => {
      if (isComplete.value) return;
      translateX.value = Math.max(0, Math.min(event.translationX, maxTranslate));
    })
    .onEnd(() => {
      if (isComplete.value) return;
      if (translateX.value > maxTranslate * COMPLETE_THRESHOLD) {
        translateX.value = withSpring(maxTranslate, SPRING);
        isComplete.value = true;
        runOnJS(handleComplete)();
      } else {
        translateX.value = withSpring(0, SPRING);
      }
    });

  const thumbAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const textAnimatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [0, maxTranslate * 0.5], [1, 0], Extrapolation.CLAMP),
  }));

  return (
    <View
      className="h-12 justify-center rounded-full p-1"
      style={{ backgroundColor: trackColor, width: sliderWidth }}
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      testID="slide-to-confirm">
      <Animated.View
        className="absolute inset-x-0 items-center justify-center"
        style={textAnimatedStyle}>
        <Text size={16} medium style={{ color: textColor }}>
          {label}
        </Text>
      </Animated.View>
      <GestureDetector gesture={panGesture}>
        <Animated.View
          className="h-10 w-10 items-center justify-center rounded-full"
          style={[thumbAnimatedStyle, { backgroundColor: thumbColor }]}>
          <Icon name={iconName} size={24} color={iconColor} />
        </Animated.View>
      </GestureDetector>
    </View>
  );
};
