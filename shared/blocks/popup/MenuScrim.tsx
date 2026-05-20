/**
 * Drop-in replacement for `<Menu.Overlay>` that drives the dim scrim with a
 * 200ms tween on `isOpen` instead of heroui's progress-tracking opacity.
 *
 * Why: heroui's bottom-sheet overlay opacity is interpolated from gorhom's
 * snap `progress` (0=idle, 1=open, 2=close). Gorhom's spring is fast, so the
 * fade-in feels instantaneous, and the boundary at progress=1 plus the
 * `isDragging && progress <= 1` override produces a flash on drag-dismiss.
 *
 * `isAnimatedStyleActive={false}` strips heroui's progress-driven `opacity`
 * from the overlay style. We supply our own `withTiming(isOpen ? 1 : 0, 200ms)`
 * via an animated `style`, so:
 * - Open: smooth 200ms fade-in independent of gorhom snap speed.
 * - Tap dismiss: smooth 200ms fade-out.
 * - Drag dismiss: scrim holds full opacity during drag, fades out the moment
 *   gorhom commits to closing (matches native iOS sheet behavior).
 *
 * Placement matches `<Menu.Overlay>` exactly — same JSX position inside
 * `<Menu.Portal>`, same z-order, so the menu Content stacks above as
 * expected.
 */

import React, { useEffect } from 'react';
import { Menu, useMenu } from 'heroui-native';
import { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';

import { alpha, duration } from '@/shared/styles/tokens';
import { useColorScheme } from '@/shared/hooks/useColorScheme';

export function MenuScrim() {
  const { isOpen } = useMenu();
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
    opacity: opacity.value,
  }));

  return <Menu.Overlay isAnimatedStyleActive={false} style={animatedStyle} />;
}
