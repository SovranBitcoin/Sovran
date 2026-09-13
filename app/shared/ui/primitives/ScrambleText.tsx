/**
 * Text that arrives like a decrypting cipher: every glyph cycles through random
 * characters, then settles left → right onto the real string. With no `text`
 * yet it keeps scrambling `length` glyphs as a live placeholder for the value
 * a rail is still building.
 *
 * The decode plays only when a value ARRIVES: this instance showed the loading
 * scramble and then got text, or the caller passes `reveal` because the value
 * just landed from a lazy fetch (honoured once, on mount). A row that mounts
 * with data it already had, or whose value merely changes (a rail toggle
 * recomposing a URI), shows the new text immediately — the effect is for
 * loading, not for every render.
 *
 * Runs entirely on the UI thread — `useFrameCallback` advances the scramble
 * and the frame is pushed straight into a TextInput's `text` prop from a
 * worklet (the `ElapsedSeconds` contract). The placeholder plays precisely
 * while the JS thread is busy composing the payload it stands in for, so a
 * `setInterval`/state-driven version would freeze at exactly the wrong time.
 *
 * Own leaf component on purpose: ticking must never re-render the row.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, type TextInputProps, type TextStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedProps,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { IS_ANDROID_E2E } from '@/shared/lib/e2e/isAndroidE2E';
import { SCRAMBLE_DECODE_MS, scrambleFrame } from '@/shared/lib/scrambleText';

/** How often the random glyphs re-roll. Slower than 60 Hz reads as a cipher
 * ticking over; every frame reads as noise. */
const SCRAMBLE_TICK_MS = 48;
/** Placeholder width when neither text nor length is given — the width of a
 * middle-truncated payment string (`10…10`). */
const DEFAULT_SCRAMBLE_LENGTH = 23;

interface AnimatedTextProps {
  text: string;
}

// `text` is settable on the native TextInput but absent from RN's public prop
// types; widen once here so `animatedProps` stays typed at the call site.
const TypedTextInput = TextInput as React.ComponentType<
  TextInputProps & Partial<AnimatedTextProps>
>;
const AnimatedTextInput = Animated.createAnimatedComponent(TypedTextInput);

interface ScrambleTextProps {
  /** The string to settle on. Omit (or pass `''`) to keep scrambling. */
  text?: string;
  /** Glyph count while `text` is unknown. Defaults to a truncated payment string's width. */
  length?: number;
  /** The mount-time `text` just arrived from a fetch: play the decode once. */
  reveal?: boolean;
  size?: number;
  /** Defaults to the theme foreground. */
  color?: string;
  weight?: TextStyle['fontWeight'];
  /** Line box height — pin it to the Text it replaces so the row never shifts. */
  lineHeight?: number;
  style?: TextStyle;
  testID?: string;
}

export function ScrambleText({
  text = '',
  length,
  reveal = false,
  size = 16,
  color,
  weight = '500',
  lineHeight = 24,
  style,
  testID,
}: ScrambleTextProps) {
  const foreground = useThemeColor('foreground');
  const reducedMotion = useReducedMotion();
  // Skip motion entirely under reduced motion, and under Android e2e where a
  // perpetual tick stops uiautomator ever reaching idle (the same gate
  // Skeleton/LoadingIndicator/ElapsedSeconds carry).
  const instant = reducedMotion || IS_ANDROID_E2E;
  const glyphs = text ? text.length : (length ?? DEFAULT_SCRAMBLE_LENGTH);

  // Settled from the start when mounted with text that is not being revealed.
  const [settled, setSettled] = useState(() => Boolean(text) && (instant || !reveal));
  const tick = useSharedValue(0);
  const progress = useSharedValue(settled ? 1 : 0);
  // The previous `text`, to tell "value arrived after loading" from "value
  // changed"; `null` until the mount effect has run.
  const prevTextRef = useRef<string | null>(null);

  const frameCallback = useFrameCallback((frame) => {
    'worklet';
    const next = Math.floor(frame.timestamp / SCRAMBLE_TICK_MS);
    if (next !== tick.get()) tick.set(next);
  }, false);

  const markSettled = useCallback(() => setSettled(true), []);

  useEffect(() => {
    const prev = prevTextRef.current;
    prevTextRef.current = text;
    if (!text) {
      setSettled(false);
      progress.set(0);
      return;
    }
    const arrived = prev === null ? reveal : prev === '';
    if (instant || !arrived) {
      progress.set(1);
      setSettled(true);
      return;
    }
    setSettled(false);
    progress.set(0);
    progress.set(
      withTiming(1, { duration: SCRAMBLE_DECODE_MS, easing: Easing.linear }, (finished) => {
        if (finished) runOnJS(markSettled)();
      })
    );
    return () => cancelAnimation(progress);
  }, [text, instant, reveal, progress, markSettled]);

  useEffect(() => {
    frameCallback.setActive(!instant && !settled);
    return () => frameCallback.setActive(false);
  }, [instant, settled, frameCallback]);

  // Reanimated re-evaluates this on the JS thread whenever the row re-renders
  // (e.g. a sibling toggle), and there the UI-only shared values read as their
  // JS-side seeds — tick 0, progress 0 — so a settled readout would be pushed
  // back to static junk with nothing left ticking to correct it. Once settled,
  // return the real text without consulting shared values.
  const animatedProps = useAnimatedProps<AnimatedTextProps>(() => ({
    text: settled ? text : scrambleFrame(text, glyphs, tick.get(), progress.get()),
  }));

  const readoutStyle = React.useMemo(
    () => [
      styles.readout,
      { fontSize: size, color: color ?? foreground, fontWeight: weight, height: lineHeight },
      style,
    ],
    [size, color, foreground, weight, lineHeight, style]
  );

  return (
    <AnimatedTextInput
      editable={false}
      // A readout, not an input: not focusable, taps fall through to the row.
      pointerEvents="none"
      accessibilityRole="text"
      accessibilityLabel={text || undefined}
      underlineColorAndroid="transparent"
      // RN forwards `value ?? defaultValue` as the native `text` prop on EVERY
      // render, and a React commit wins over the worklet's last write. So this
      // must be the terminal text once settled — otherwise any sibling
      // re-render (an Advanced toggle) snaps the readout back to the mount-time
      // junk with nothing left ticking to correct it.
      defaultValue={settled ? text : scrambleFrame(text, glyphs, 0, 0)}
      animatedProps={animatedProps}
      testID={testID}
      style={readoutStyle}
    />
  );
}

const styles = StyleSheet.create({
  readout: {
    padding: 0,
    margin: 0,
    // TextInput reserves a taller line box than Text at the same font size;
    // pin it so swapping in the real text never nudges the row.
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
});
