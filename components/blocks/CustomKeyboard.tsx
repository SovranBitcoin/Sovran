/**
 * @fileoverview Custom numeric keyboard for amount entry
 *
 * ## Unit-Based Behavior
 *
 * ### Sats Mode (`unit === 'sat'`)
 * - No decimal point button shown
 * - Leading zeros not allowed (typing "0" is blocked)
 * - Integer-only input
 *
 * ### Fiat Mode (`unit !== 'sat'`)
 * - Decimal point button shown
 * - Maximum 2 decimal places enforced
 * - Special zero handling (see below)
 *
 * ## Fiat Zero Replacement
 *
 * When current value is exactly "0" and user types a digit (not decimal):
 * - The zero is REPLACED, not appended
 * - Prevents invalid inputs like "05", "07", etc.
 * - Keeps input stack clean (backspace won't reveal stale zero)
 *
 * | Current | User Types | Result | Why                              |
 * |---------|------------|--------|----------------------------------|
 * | `0`     | `.`        | `0.`   | Valid: starting decimal entry    |
 * | `0`     | `5`        | `5`    | Zero replaced (not "05")         |
 * | `0.`    | `5`        | `0.5`  | Normal append after decimal      |
 * | `12`    | `0`        | `120`  | Normal append (not leading zero) |
 *
 * @see CurrencyScreen - for full fiat input display behavior documentation
 */

import React, { useState, useCallback, memo } from 'react';
import { View, TouchableOpacity } from 'react-native';
import Icon from 'assets/icons';
import { EnhancedHaptics } from 'components/ui/Haptics';
import { useTheme } from 'providers/ThemeProvider';
import { Text } from 'components/ui/Text';

interface CustomKeyboardProps {
  onKeyPress: (value: string) => void;
  unit: 'sat' | string;
  loading?: boolean;
}

type KeyboardValue = string | number;

const CustomKeyboard: React.FC<CustomKeyboardProps> = ({ onKeyPress, unit, loading = false }) => {
  const [, setInputValue] = useState<string>('');
  const { getPrimaryColor } = useTheme();

  const handlePress = useCallback(
    (value: KeyboardValue) => {
      setInputValue((prevInputValue) => {
        const stringValue = String(value);
        let newValue: string;

        if (stringValue === '<') {
          EnhancedHaptics.actionHaptic();
          newValue = prevInputValue.slice(0, -1);
        } else {
          EnhancedHaptics.buttonHaptic();

          // In fiat mode: if current value is exactly "0" and user types a digit (not decimal),
          // replace the 0 instead of appending (so typing "5" gives "5", not "05")
          if (unit !== 'sat' && prevInputValue === '0' && stringValue !== '.') {
            newValue = stringValue;
          } else {
            newValue = prevInputValue + stringValue;
          }
        }

        // Validation rules
        if (newValue.startsWith('.')) {
          return prevInputValue;
        }

        const dotCount = (newValue.match(/\./g) || []).length;
        if (dotCount > 1) {
          return prevInputValue;
        }

        // Handle zeros based on unit type
        if (newValue.startsWith('0')) {
          // In integer mode (sats), don't allow any leading zeros
          if (unit === 'sat') {
            return prevInputValue;
          }
          // In decimal mode, only prevent multiple leading zeros
          else if (newValue.startsWith('00')) {
            return prevInputValue;
          }
        }

        // Handle decimal precision
        const parts = newValue.split('.');
        if (parts[1] && parts[1].length > 2) {
          newValue = `${parts[0]}.${parts[1].slice(0, 2)}`;
        }

        onKeyPress(newValue);
        return newValue;
      });
    },
    [onKeyPress, unit]
  );

  const renderButton = useCallback(
    (value: KeyboardValue) => (
      <TouchableOpacity
        key={String(value)}
        className="mx-0.5 w-1/3 items-center justify-center overflow-hidden"
        style={{
          backgroundColor: getPrimaryColor('950'),
          opacity: loading ? 0.5 : 1,
        }}
        disabled={loading}
        onPress={() => handlePress(value)}>
        {value === '<' ? (
          <Icon name="lucide:delete" size={24} color="white" />
        ) : (
          <Text
            size={24}
            bold
            overpass
            style={{
              padding: 16,
              paddingHorizontal: 24,
              color: 'white',
            }}>
            {value}
          </Text>
        )}
      </TouchableOpacity>
    ),
    [handlePress, loading, getPrimaryColor]
  );

  const buttons: KeyboardValue[][] = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    [unit === 'sat' ? '' : '.', '0', '<'],
  ];

  return (
    <View
      className="items-center justify-center bg-transparent"
      style={{ opacity: loading ? 0.5 : 1 }}>
      {buttons.map((row, rowIndex) => (
        <View key={rowIndex} className="mb-0.25 flex-row justify-between">
          {row.map(renderButton)}
        </View>
      ))}
    </View>
  );
};

export default memo(CustomKeyboard);
