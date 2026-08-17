import React, { useMemo } from 'react';
import { StyleSheet, View as RNView } from 'react-native';

import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import Icon from 'assets/icons';
import { Text } from '@/shared/ui/primitives/Text';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';

// WhatsApp-style swipe: drag the row left-to-right to expose an action on
// the LEFT. Past `COMMIT_PX`, release commits; release earlier springs back.
const REVEAL_PX = 88;
const COMMIT_PX = 132;
const SPRING = { damping: 22, stiffness: 220, mass: 0.6 };

// Hoisted: closure-free, allocated once per module — not per row.
const tickHaptic = () => {
  void EnhancedHaptics.buttonHaptic();
};
const commitHaptic = () => {
  void EnhancedHaptics.warningHaptic();
};

interface SwipeableRowProps {
  children: React.ReactNode;
  onCommit: () => void;
  /** When false, the gesture is inert — the row stays mounted (so shared
   * values + worklets persist) but no swipe reveals the action track. */
  enabled?: boolean;
  testID?: string;
}

export function SwipeableRow({ children, onCommit, enabled = true, testID }: SwipeableRowProps) {
  const [danger, foreground] = useThemeColor(['danger', 'foreground'] as const);

  // translateX is always >= 0 here — the row only slides RIGHT.
  const translateX = useSharedValue(0);
  const armed = useSharedValue(0);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        // Activate only on right-leaning horizontal motion past 12 px;
        // cede vertical drags > 8 px to the parent ScrollView.
        .activeOffsetX([-9999, 12])
        .failOffsetY([-8, 8])
        .enabled(enabled)
        .onUpdate((event) => {
          'worklet';
          const next = Math.max(0, event.translationX);
          translateX.set(next);
          const past = next >= COMMIT_PX ? 1 : 0;
          if (past !== armed.get()) {
            armed.set(past);
            runOnJS(tickHaptic)();
          }
        })
        .onEnd((event) => {
          'worklet';
          armed.set(0);
          const past = event.translationX >= COMMIT_PX;
          if (past) {
            runOnJS(commitHaptic)();
            // Spring the row back to rest — the spinner takes over visual
            // feedback while reclaim runs. The list-item exit animation
            // fires once reclaim completes and the row leaves the bucket.
            translateX.set(withSpring(0, SPRING));
            runOnJS(onCommit)();
          } else {
            translateX.set(withSpring(0, SPRING));
          }
        }),
    [enabled, onCommit, translateX, armed]
  );

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.get() }],
  }));

  // Track is sized to current swipe distance, anchored on the left, so it
  // only fills the gap exposed as the row slides right.
  const trackStyle = useAnimatedStyle(() => ({
    width: translateX.get(),
  }));

  const labelStyle = useAnimatedStyle(() => {
    const px = translateX.get();
    return {
      transform: [{ scale: interpolate(px, [0, COMMIT_PX], [0.9, 1.05], Extrapolation.CLAMP) }],
      opacity: interpolate(px, [REVEAL_PX * 0.5, REVEAL_PX], [0, 1], Extrapolation.CLAMP),
    };
  });

  return (
    <RNView style={styles.container} testID={testID}>
      <Animated.View
        style={[styles.track, { backgroundColor: danger }, trackStyle]}
        pointerEvents="none">
        <Animated.View style={[styles.action, labelStyle]}>
          <Icon name="mdi:close-circle" size={22} color={foreground} />
          <Text size={12} heavy style={{ color: foreground, marginTop: 2 }}>
            Cancel
          </Text>
        </Animated.View>
      </Animated.View>

      <GestureDetector gesture={pan}>
        <Animated.View style={rowStyle}>{children}</Animated.View>
      </GestureDetector>
    </RNView>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    overflow: 'hidden',
  },
  track: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    overflow: 'hidden',
  },
  action: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 64,
    marginLeft: 24,
  },
});
