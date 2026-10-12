import React, { memo } from 'react';

import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Log } from '@/shared/lib/logger';
import { useCapabilities } from '@/shared/ui/capability';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

import { KeypadGlassKey } from './KeypadGlassKey';
import { KeypadKey } from './KeypadKey';
import { useKeypadPress } from './useKeypadPress';

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

/**
 * The amount keypad: a calculator's. Three columns of digits, and a fourth of
 * functions that starts with delete. The sat keypad has no decimal point, so
 * its bottom row offers `00` and `000` instead of leaving a hole. Where the
 * device has Liquid Glass the keys are glass; elsewhere they wear the control
 * chrome of the mint selector pill.
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
  const keyHeight = compact ? 50 : 58;
  const rows = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    [unit === 'sat' ? '00' : '.', '0', '000'],
  ];
  const Key = useCapabilities().liquidGlass ? KeypadGlassKey : KeypadKey;

  return (
    <Log name="CustomKeyboard">
      <View className={loading ? 'flex-row gap-2 opacity-50' : 'flex-row gap-2'}>
        <View className="flex-[3] gap-2">
          {rows.map((row) => (
            <View key={row.join('')} className="flex-row gap-2">
              {row.map((key) => (
                <Key
                  key={key}
                  testID={`keypad-key-${KEY_NAMES[key]?.testID ?? key}`}
                  accessibilityLabel={KEY_NAMES[key]?.label ?? key}
                  disabled={loading}
                  height={keyHeight}
                  onPress={() => handlePress(key)}>
                  <Text family="mono" size={22} bold color={foreground}>
                    {key}
                  </Text>
                </Key>
              ))}
            </View>
          ))}
        </View>

        <View className="flex-1 gap-2">
          <Key
            testID="keypad-key-backspace"
            accessibilityLabel="Delete"
            disabled={loading}
            strong
            onPress={() => handlePress('<')}>
            <Icon name="lucide:delete" size={22} color={foreground} />
          </Key>
          {functions.map((fn) => (
            <Key
              key={fn.testID}
              testID={fn.testID}
              accessibilityLabel={fn.accessibilityLabel}
              disabled={loading}
              strong
              onPress={fn.onPress}>
              {fn.icon ? <Icon name={fn.icon} size={18} color={foreground} /> : null}
              {fn.label ? (
                <Text family="mono" size={fn.icon ? 11 : 13} bold color={foreground}>
                  {fn.label}
                </Text>
              ) : null}
            </Key>
          ))}
        </View>
      </View>
    </Log>
  );
};

export type { KeypadFunction };
export default memo(CustomKeyboard);
