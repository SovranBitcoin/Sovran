/**
 * A live "42s" counter that keeps ticking while the JS thread is blocked.
 *
 * Why not `setInterval`: during a wallet recovery the JS thread blocks in
 * 10–40 second synchronous chunks (measured `perf.js_thread_blocked`: 33.9s,
 * 39.2s, 15.9s inside one 102s run) while cashu-ts unblinds and DLEQ-verifies
 * restored proofs. Timers are starved for exactly that long, so a JS-driven
 * clock freezes precisely when the user most needs proof the app is alive —
 * which is the bug this component exists to fix, not one it may reintroduce.
 *
 * `useFrameCallback` runs on the UI thread and is unaffected, so the count
 * stays honest through the block. The value is pushed straight into a
 * TextInput's `text` prop from the worklet, never through React state, so a
 * blocked JS thread cannot stall the render either.
 *
 * Own leaf component on purpose (same rule as `ExpiryCountdown`): the tick
 * must never re-render the rows around it.
 */
import React, { useEffect } from 'react';
import { StyleSheet, TextInput, type TextInputProps, type TextStyle } from 'react-native';
import Animated, {
  useAnimatedProps,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated';

import { IS_ANDROID_E2E } from '@/shared/lib/e2e/isAndroidE2E';

interface AnimatedTextProps {
  text: string;
}

// `text` is settable on the underlying native TextInput but absent from RN's
// public prop types, so widen the component before wrapping it. Doing it here
// keeps the single cast next to the reason for it, and keeps `animatedProps`
// fully typed at the call site.
const TypedTextInput = TextInput as React.ComponentType<
  TextInputProps & Partial<AnimatedTextProps>
>;
const AnimatedTextInput = Animated.createAnimatedComponent(TypedTextInput);

interface ElapsedSecondsProps {
  /** Ticks while true; holds its last value when false. */
  running: boolean;
  size?: number;
  color: string;
  /** Rendered before the count, e.g. `'· '`. */
  prefix?: string;
  style?: TextStyle;
  testID?: string;
}

/**
 * Must be a worklet: it is called from `useAnimatedProps`, which runs on the UI
 * runtime. Without the directive the babel plugin leaves it as a JS-thread
 * remote function and Reanimated throws "Tried to synchronously call a Remote
 * Function" the moment the readout first renders.
 */
function label(totalSeconds: number, prefix: string): string {
  'worklet';
  if (totalSeconds < 60) return `${prefix}${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${prefix}${minutes}m ${seconds}s`;
}

export const ElapsedSeconds: React.FC<ElapsedSecondsProps> = ({
  running,
  size = 14,
  color,
  prefix = '',
  style,
  testID,
}) => {
  const seconds = useSharedValue(0);
  const firstFrameMs = useSharedValue(-1);

  // Derive from the frame timestamp rather than `timeSinceFirstFrame` so the
  // origin is well-defined no matter when the callback is activated.
  const frameCallback = useFrameCallback((frame) => {
    'worklet';
    if (firstFrameMs.get() < 0) {
      firstFrameMs.set(frame.timestamp);
      return;
    }
    const next = Math.floor((frame.timestamp - firstFrameMs.get()) / 1000);
    if (next !== seconds.get()) seconds.set(next);
  }, false);

  useEffect(() => {
    // A perpetual tick stops uiautomator ever reaching idle, which blinds every
    // Android e2e AX dump — the same gate Skeleton/LoadingIndicator/
    // ExpiryCountdown carry.
    const active = running && !IS_ANDROID_E2E;
    if (active) {
      firstFrameMs.set(-1);
      seconds.set(0);
    }
    frameCallback.setActive(active);
    return () => frameCallback.setActive(false);
  }, [running, frameCallback, firstFrameMs, seconds]);

  const animatedProps = useAnimatedProps<AnimatedTextProps>(() => ({
    text: label(seconds.get(), prefix),
  }));

  const readoutStyle = React.useMemo(
    () => [styles.readout, { fontSize: size, color }, style],
    [size, color, style]
  );

  return (
    <AnimatedTextInput
      editable={false}
      // Not focusable/selectable — this is a readout, not an input. VoiceOver
      // reads the live value from the TextInput's own text.
      pointerEvents="none"
      accessibilityRole="text"
      underlineColorAndroid="transparent"
      defaultValue={label(0, prefix)}
      animatedProps={animatedProps}
      testID={testID}
      style={readoutStyle}
    />
  );
};

const styles = StyleSheet.create({
  readout: {
    padding: 0,
    margin: 0,
    // TextInput reserves a taller line box than Text at the same font size;
    // pin it so swapping the label in never nudges the row.
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
});
