import type { GestureResponderEvent } from 'react-native';
import {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { duration } from '@/shared/styles/tokens';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';

const REST_SCALE = 1;
const PRESSED_SCALE = 1.06;
const RETURN_SPRING = {
  damping: 12,
  stiffness: 380,
  mass: 0.6,
} as const;

export function useQRButtonPressFeedback() {
  const scale = useSharedValue(REST_SCALE);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
  }));

  const onPressIn = (_event: GestureResponderEvent) => {
    void EnhancedHaptics.buttonHaptic();
    scale.set(
      withTiming(PRESSED_SCALE, {
        duration: duration.instant,
        easing: Easing.out(Easing.cubic),
      })
    );
  };

  const onPressOut = (_event: GestureResponderEvent) => {
    scale.set(withSpring(REST_SCALE, RETURN_SPRING));
  };

  return { animatedStyle, onPressIn, onPressOut };
}
