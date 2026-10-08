import React, { memo, type ReactNode } from 'react';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { withAlpha } from '@/shared/lib/color';
import { Log } from '@/shared/lib/logger';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

import { useKeypadPress } from './useKeypadPress';
import { usePressProgress } from './usePressProgress';

/** A key in the function column: something other than typing a digit. */
interface KeypadFunction {
  testID: string;
  accessibilityLabel: string;
  onPress: () => void;
  /** An icon name, or a short word set in the key's own face. */
  icon?: string;
  label?: string;
}

interface CustomKeyboardProps {
  onKeyPress: (value: string) => void;
  unit: 'sat' | string;
  loading?: boolean;
  compact?: boolean;
  /** External value to sync internal state (e.g. after fiat/sats toggle) */
  value?: string;
  /**
   * Keys stacked under delete in the fourth column, in order. The column is as
   * tall as the digit block whatever it holds, so the keys share its height.
   */
  functions?: readonly KeypadFunction[];
}

const KEY_NAMES: Record<string, { testID: string; label: string }> = {
  '<': { testID: 'backspace', label: 'Delete' },
  '.': { testID: 'decimal', label: 'Decimal point' },
  '00': { testID: 'double-zero', label: 'Double zero' },
  '000': { testID: 'triple-zero', label: 'Thousand' },
};

/** How far a cap sinks into its base when pressed. */
const TRAVEL = 4;

/**
 * One physical key: a cap resting on a darker base, which is the key's own
 * shadow. Pressing sinks the cap into the base. The motion runs on the UI
 * thread from the touch itself, so typing never waits on a render.
 */
function Cap({
  height,
  strong = false,
  children,
}: {
  /** Omit to take whatever height the column gives. */
  height?: number;
  strong?: boolean;
  children: ReactNode;
}) {
  const foreground = useThemeColor('foreground');
  const { progress, touch } = usePressProgress(70);
  const sink = useAnimatedStyle(() => ({ transform: [{ translateY: progress.get() * TRAVEL }] }));
  const base = {
    ...(height === undefined ? { flex: 1 } : { height: height + TRAVEL }),
    backgroundColor: withAlpha(foreground, 0.04),
  };
  const cap = {
    ...(height === undefined ? { flex: 1, marginBottom: TRAVEL } : { height }),
    backgroundColor: withAlpha(foreground, strong ? 0.2 : 0.11),
    borderColor: withAlpha(foreground, 0.1),
  };
  return (
    <View className="rounded-[13px]" style={base} {...touch}>
      <Animated.View
        className="items-center justify-center gap-0.5 rounded-[13px] border-t"
        style={[cap, sink]}>
        {children}
      </Animated.View>
    </View>
  );
}

/**
 * The amount keypad: a calculator's. Three columns of digits, and a fourth of
 * functions that starts with delete. The sat keypad has no decimal point, so
 * its bottom row offers `00` and `000` instead of leaving a hole.
 */
const CustomKeyboard: React.FC<CustomKeyboardProps> = ({
  onKeyPress,
  unit,
  loading = false,
  compact = false,
  value,
  functions = [],
}) => {
  const foreground = useThemeColor('foreground');
  const handlePress = useKeypadPress(value, unit, onKeyPress);
  const keyHeight = compact ? 46 : 54;
  const rows = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    [unit === 'sat' ? '00' : '.', '0', '000'],
  ];
  const state = { disabled: loading, busy: loading };

  return (
    <Log name="CustomKeyboard">
      <View className={loading ? 'flex-row gap-2 opacity-50' : 'flex-row gap-2'}>
        <View className="flex-[3] gap-2">
          {rows.map((row) => (
            <View key={row.join('')} className="flex-row gap-2">
              {row.map((key) => (
                <Pressable
                  key={key}
                  testID={`keypad-key-${KEY_NAMES[key]?.testID ?? key}`}
                  accessibilityRole="button"
                  accessibilityLabel={KEY_NAMES[key]?.label ?? key}
                  accessibilityState={state}
                  disabled={loading}
                  activeOpacity={1}
                  className="flex-1"
                  onPress={() => handlePress(key)}>
                  <Cap height={keyHeight}>
                    <Text family="mono" size={22} bold color={foreground}>
                      {key}
                    </Text>
                  </Cap>
                </Pressable>
              ))}
            </View>
          ))}
        </View>

        <View className="flex-1 gap-2">
          <Pressable
            testID="keypad-key-backspace"
            accessibilityRole="button"
            accessibilityLabel="Delete"
            accessibilityState={state}
            disabled={loading}
            activeOpacity={1}
            className="flex-1"
            onPress={() => handlePress('<')}>
            <Cap strong>
              <Icon name="lucide:delete" size={22} color={foreground} />
            </Cap>
          </Pressable>
          {functions.map((fn) => (
            <Pressable
              key={fn.testID}
              testID={fn.testID}
              accessibilityRole="button"
              accessibilityLabel={fn.accessibilityLabel}
              accessibilityState={state}
              disabled={loading}
              activeOpacity={1}
              className="flex-1"
              onPress={fn.onPress}>
              <Cap strong>
                {fn.icon ? <Icon name={fn.icon} size={18} color={foreground} /> : null}
                {fn.label ? (
                  <Text family="mono" size={fn.icon ? 11 : 13} bold color={foreground}>
                    {fn.label}
                  </Text>
                ) : null}
              </Cap>
            </Pressable>
          ))}
        </View>
      </View>
    </Log>
  );
};

export type { KeypadFunction };
export default memo(CustomKeyboard);
