/** A 200ms scrim tween capped by the sheet's actual visibility. */
import { useEffect } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Menu, useMenu, useMenuAnimation } from 'heroui-native';
import {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';

import { alpha, duration } from '@/shared/styles/tokens';
import { useColorScheme } from '@/shared/hooks/useColorScheme';

export function MenuScrim() {
  const { isOpen } = useMenu();
  const { progress, isDragging } = useMenuAnimation();
  const opacity = useSharedValue(0);
  const scrimColor =
    useColorScheme() === 'light'
      ? `rgba(255,255,255,${alpha.strong})`
      : `rgba(0,0,0,${alpha.strong})`;

  useEffect(() => {
    opacity.value = withTiming(isOpen ? 1 : 0, { duration: duration.quick });
  }, [isOpen, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    backgroundColor: scrimColor,
    opacity: Math.min(
      opacity.value,
      isDragging.value ? 1 : interpolate(progress.value, [0, 1, 2], [0, 1, 0], Extrapolation.CLAMP)
    ),
  }));

  // SDK 56 / reanimated 4.3: useAnimatedStyle returns an AnimatedStyleHandle;
  // Menu.Overlay forwards it to an Animated view but types style as StyleProp.
  return (
    <Menu.Overlay
      testID="action-menu-dismiss"
      accessibilityLabel="Dismiss menu"
      accessibilityRole="button"
      isAnimatedStyleActive={false}
      style={animatedStyle as StyleProp<ViewStyle>}
    />
  );
}
