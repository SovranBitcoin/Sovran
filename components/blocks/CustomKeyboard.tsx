import React, { useState, useCallback, memo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'assets/icons';
import Haptics from 'components/ui/Haptics';
import { useTheme } from 'providers/ThemeProvider';

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
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          newValue = prevInputValue.slice(0, -1);
        } else {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          newValue = prevInputValue + stringValue;
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
            style={{
              padding: 16,
              paddingHorizontal: 24,
              fontSize: 24,
              color: 'white',
              fontWeight: 'bold',
              fontFamily: 'OverpassBold',
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
