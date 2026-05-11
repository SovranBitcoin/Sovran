import React, { useEffect, useRef } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { getBootSplashHandoff, useBootSplashHandoff } from '@/shared/lib/qrButtonAnchor';

interface BootEntranceProps {
  children: React.ReactNode;
  /** Optional outer style. Layout (`flex: 1` etc.) goes here. */
  style?: ViewStyle;
}

/**
 * Wraps a screen subtree with a "spotlight expansion" entrance animation.
 *
 * IMPORTANT: this wrapper renders at `scale: 1` until the splash handoff
 * fires. That is deliberate — the QRButton inside the wallet is measured
 * during boot to compute the splash → button morph target, and
 * `measureInWindow` includes any ancestor `transform: scale`. If we held
 * the wallet at `scale: 1.08` from mount, every boot-time measurement
 * would be 1.08× the real value, the splash would morph to a position 4%
 * off from the real button, and the user would see a tiny but noticeable
 * misalignment when the splash settles.
 *
 * Sequence:
 *   1. Mount: hold at `scale: 1`, `opacity: 1` (wallet hidden behind the
 *      opaque splash overlay).
 *   2. QRButton fires its `onLayout`/measure passes — coords are clean.
 *   3. Splash handoff fires → SNAP to `scale: 1.08`, `opacity: 0` (still
 *      behind the splash — invisible to the user) → spring back to
 *      `scale: 1` and fade to `opacity: 1` over 550ms.
 *   4. As the splash retreats over the same 550–750ms, the user sees the
 *      wallet zooming + fading into place. Net visual: spotlight-
 *      expansion arrival without the measurement-corrupting transform.
 *
 * The animation runs once per `bootSplashHandoff` cycle. On profile
 * switches the splash gate resets the handoff flag, so the wallet replays
 * the entrance — appropriate for a profile transition.
 */
export function BootEntrance({ children, style }: BootEntranceProps): React.ReactElement {
  const handoff = useBootSplashHandoff();
  const initialHandoff = useRef(getBootSplashHandoff()).current;
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const hasArmedRef = useRef(initialHandoff);

  useEffect(() => {
    if (!handoff || hasArmedRef.current) return;
    hasArmedRef.current = true;
    // Step 1: snap to the entrance start state. This happens UNDER the
    // still-opaque splash overlay, so the snap itself is invisible.
    scale.value = 1.08;
    opacity.value = 0;
    // Step 2: animate to the final state. By this frame the splash has
    // begun morphing, so the user sees the wallet emerge at 1.08 → 1.
    scale.value = withSpring(1, {
      damping: 18,
      stiffness: 90,
      mass: 1,
    });
    opacity.value = withTiming(1, {
      duration: 550,
      easing: Easing.out(Easing.quad),
    });
  }, [handoff, scale, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={[styles.container, style, animatedStyle]} collapsable={false}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
