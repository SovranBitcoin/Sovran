import React, { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { GlassView } from 'expo-glass-effect';

import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useSingleFlight } from '@/shared/hooks/useSingleFlight';
import { CIRCLE_SIZE, ICON_SIZE, type CircleActionButtonProps } from './CircleActionButton.types';
import { CircleActionButtonShell } from './CircleActionButtonShell';

// Liquid Glass via expo-glass-effect's GlassView (a UIVisualEffectView-backed
// RN view) rather than an @expo/ui SwiftUI `Host`. Host views (UIHostingController)
// don't follow an RN ScrollView's content transform and visually pin to the top
// while scrolling (expo/expo#46278); GlassView scrolls like any RN view.
//
// `isInteractive` restores the native press lensing the camera toolbar buttons
// have. The tap is driven by a gesture-handler `Tap` rather than an RN
// `Pressable`: the interactive glass installs its own UIKit gesture recognizer,
// and an RN Pressable's JS responder loses arbitration to it intermittently (the
// iOS-26 tap-swallow that forced `isInteractive` off in 17b70500). A
// gesture-handler recognizer arbitrates natively alongside the glass, so the tap
// fires reliably while the glass still reacts to touch.
export function CircleActionButtonLiquid(props: CircleActionButtonProps): React.ReactElement {
  const [foreground] = useThemeColor(['foreground'] as const);
  const { icon, onPress, onPressIn, onPressOut, disabled = false, color } = props;
  const iconColor = color ?? foreground;
  const interactive = !disabled && !!(onPress || onPressIn || onPressOut);

  // Preserve the single-flight guard the shared Pressable used to provide so a
  // rapid double-tap whose handler navigates (Swap/More/…) can't fire twice.
  const guardedPress = useSingleFlight(async () => {
    if (!onPress) return;
    const result = onPress() as unknown;
    if (result instanceof Promise) await result;
  });

  const tap = useMemo(
    () =>
      Gesture.Tap()
        .runOnJS(true)
        .enabled(interactive)
        .onBegin(() => onPressIn?.())
        .onFinalize(() => onPressOut?.())
        .onEnd((_event, success) => {
          if (success) void guardedPress();
        }),
    [interactive, onPressIn, onPressOut, guardedPress]
  );

  // The RNGH Tap above lives entirely OUTSIDE React Native's JS responder
  // system, so an ancestor RN Pressable (e.g. a tappable list row embedding
  // this button in its trailing slot, like the mint selector's ContactRow)
  // sees no competing child, claims the touch, and fires ITS onPress for a
  // tap meant for this button. Claiming the responder on a plain RN View
  // (Expo's native GlassView may not deliver responder callbacks) blocks the
  // ancestor press while the RNGH recognizer still fires natively. Termination
  // stays allowed (default) so a drag that starts on the button still scrolls.
  const claimResponder = useCallback(() => true, []);

  return (
    <CircleActionButtonShell {...props}>
      <View onStartShouldSetResponder={interactive ? claimResponder : undefined}>
        <GestureDetector gesture={tap}>
          <GlassView
            glassEffectStyle="regular"
            isInteractive={interactive}
            style={[
              styles.circle,
              { width: CIRCLE_SIZE, height: CIRCLE_SIZE, borderRadius: CIRCLE_SIZE / 2 },
            ]}>
            <Icon name={icon} size={ICON_SIZE} color={iconColor} />
          </GlassView>
        </GestureDetector>
      </View>
    </CircleActionButtonShell>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
