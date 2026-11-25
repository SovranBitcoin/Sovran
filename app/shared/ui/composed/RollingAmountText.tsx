/**
 * A formatted amount whose changed digits roll into place: up when the value
 * grows, down when it shrinks (a carry `9 → 0` on an increase still rolls
 * up). Unchanged digits, the sign, grouping and the unit glyph stay still.
 *
 * Each digit is its own clipped column keyed from the least significant
 * digit (see `amountSlots`), so `999 → 1,000` rolls the three existing
 * digits and adds the fourth without shifting the others' identity. Digits
 * use tabular numerals so a roll never changes the amount's width.
 *
 * The display snaps without motion on first mount, when `formatKey` changes
 * (a denomination or unit switch is a new reading, not a change of value),
 * and when the system asks for reduced motion.
 *
 * Screen readers get one element: the container carries the formatted
 * amount as its label and the per-digit nodes are hidden.
 *
 * The iOS 26 Liquid Glass path does the same in SwiftUI
 * (`modules/liquid-glass-text`); this is the Android and pre-iOS-26 path.
 */

import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';

import { rollDirection, tokenizeAmount, type AmountSlot } from '@/shared/lib/amountSlots';

/** Matches the native roll (`.spring(duration: 0.36, bounce: 0.1)`). */
const ROLL_SPRING = { duration: 360, dampingRatio: 0.9 } as const;

interface RollingAmountTextProps {
  /** The formatted amount, exactly as it should read. */
  text: string;
  /** The value behind `text`, used for the roll direction. */
  numericValue?: number;
  /** Changes when the same value is shown another way (BTC ↔ sats, unit). */
  formatKey?: string;
  /** Text style; `fontSize` (and `lineHeight` when set) size the columns. */
  style?: StyleProp<TextStyle>;
  /** Turn the roll off: renders the same slots, always snapping. */
  animated?: boolean;
  testID?: string;
}

export function RollingAmountText({
  text,
  numericValue,
  formatKey = '',
  style,
  animated = true,
  testID,
}: RollingAmountTextProps) {
  const reducedMotion = useReducedMotion();
  const flat = StyleSheet.flatten(style) ?? {};
  const fontSize = flat.fontSize ?? 14;
  // Far enough to clear the column whatever the font's line box.
  const travel = flat.lineHeight ?? Math.ceil(fontSize * 1.3);
  const slots = tokenizeAmount(text);
  // Centred in its column: a narrower glyph sits mid-cell, never left.
  const textStyle = [style, CENTERED];

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={text}
      testID={testID}
      className="flex-row items-center">
      <View
        className="flex-row items-center"
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden>
        {slots.map((slot) =>
          slot.kind === 'digit' ? (
            <DigitSlot
              key={slot.key}
              slot={slot}
              value={numericValue}
              formatKey={formatKey}
              animate={animated && !reducedMotion}
              travel={travel}
              textStyle={textStyle}
            />
          ) : (
            <Text
              key={slot.key}
              allowFontScaling={false}
              className="tabular-nums"
              style={textStyle}>
              {slot.char}
            </Text>
          )
        )}
      </View>
    </View>
  );
}

type Shown = {
  digit: number;
  value: number | undefined;
  formatKey: string;
  /** The digit rolling out, or null when settled / snapped. */
  previous: number | null;
  direction: 1 | -1;
  /** Bumps on every roll so the effect restarts even for a repeat digit. */
  rollId: number;
};

function DigitSlot({
  slot,
  value,
  formatKey,
  animate,
  travel,
  textStyle,
}: {
  slot: Extract<AmountSlot, { kind: 'digit' }>;
  value: number | undefined;
  formatKey: string;
  animate: boolean;
  travel: number;
  textStyle: StyleProp<TextStyle>;
}) {
  // Mounting is a snap: `previous: null`.
  const [shown, setShown] = useState<Shown>(() => ({
    digit: slot.digit,
    value,
    formatKey,
    previous: null,
    direction: 1,
    rollId: 0,
  }));

  // Derive the next roll during render (React's "adjust state on prop change"
  // pattern) so the first frame after a change already shows it.
  if (shown.formatKey !== formatKey) {
    setShown({ ...shown, digit: slot.digit, value, formatKey, previous: null });
  } else if (shown.digit !== slot.digit) {
    setShown({
      digit: slot.digit,
      value,
      formatKey,
      previous: animate ? shown.digit : null,
      direction: rollDirection(shown, { digit: slot.digit, value }),
      rollId: shown.rollId + 1,
    });
  } else if (shown.value !== value) {
    setShown({ ...shown, value });
  }

  const progress = useSharedValue(1);
  const rolling = shown.previous !== null;
  useEffect(() => {
    if (!rolling) {
      cancelAnimation(progress);
      progress.set(1);
      return;
    }
    progress.set(0);
    progress.set(withSpring(1, ROLL_SPRING));
    return () => cancelAnimation(progress);
  }, [rolling, shown.rollId, progress]);

  return (
    <View className="overflow-hidden" testID={`amount-slot-${slot.key}`}>
      {/* In flow, invisible: gives the column its tabular width and height. */}
      <Text allowFontScaling={false} className="tabular-nums opacity-0" style={textStyle}>
        {slot.char}
      </Text>
      {rolling ? (
        <RollingGlyph
          char={String(shown.previous)}
          progress={progress}
          from={0}
          to={-shown.direction * travel}
          textStyle={textStyle}
          testID={`amount-slot-${slot.key}-out`}
        />
      ) : null}
      <RollingGlyph
        char={String(shown.digit)}
        progress={progress}
        from={rolling ? shown.direction * travel : 0}
        to={0}
        textStyle={textStyle}
        testID={`amount-slot-${slot.key}-in`}
      />
    </View>
  );
}

function RollingGlyph({
  char,
  progress,
  from,
  to,
  textStyle,
  testID,
}: {
  char: string;
  progress: SharedValue<number>;
  from: number;
  to: number;
  textStyle: StyleProp<TextStyle>;
  testID: string;
}) {
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: from + (to - from) * progress.get() }],
  }));
  return (
    <Animated.Text
      allowFontScaling={false}
      testID={testID}
      className="absolute left-0 right-0 top-0 tabular-nums"
      style={[textStyle, animatedStyle]}>
      {char}
    </Animated.Text>
  );
}

const CENTERED: TextStyle = { textAlign: 'center' };
