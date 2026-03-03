import React, { useState, useCallback, memo } from 'react';
import { View } from '@/shared/ui/primitives/View/View';
import { TouchableOpacity } from '@/shared/ui/primitives/TouchableOpacity';
import Icon from 'assets/icons';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import { Text } from '@/shared/ui/primitives/Text';

interface CustomKeyboardProps {
  onKeyPress: (value: string) => void;
  unit: 'sat' | string;
  loading?: boolean;
  compact?: boolean;
}

type KeyboardValue = string | number;

const CustomKeyboard: React.FC<CustomKeyboardProps> = ({
  onKeyPress,
  unit,
  loading = false,
  compact = false,
}) => {
  const [, setInputValue] = useState('');

  const handlePress = useCallback(
    (value: KeyboardValue) => {
      setInputValue((prev) => {
        const str = String(value);
        let next: string;

        if (str === '<') {
          EnhancedHaptics.actionHaptic();
          next = prev.slice(0, -1);
        } else if (unit !== 'sat' && prev === '0' && str !== '.') {
          EnhancedHaptics.buttonHaptic();
          next = str;
        } else {
          EnhancedHaptics.buttonHaptic();
          next = prev + str;
        }

        if (next.startsWith('.')) return prev;
        if ((next.match(/\./g) || []).length > 1) return prev;

        if (next.startsWith('0')) {
          if (unit === 'sat') return prev;
          if (next.startsWith('00')) return prev;
        }

        const parts = next.split('.');
        if (parts[1] && parts[1].length > 2) {
          next = `${parts[0]}.${parts[1].slice(0, 2)}`;
        }

        onKeyPress(next);
        return next;
      });
    },
    [onKeyPress, unit]
  );

  const renderButton = useCallback(
    (value: KeyboardValue) => (
      <TouchableOpacity
        key={String(value)}
        className="bg-background mx-0.5 w-1/3 items-center justify-center overflow-hidden"
        style={{ opacity: loading ? 0.5 : 1 }}
        disabled={loading}
        onPress={() => handlePress(value)}>
        {value === '<' ? (
          <Icon name="lucide:delete" size={compact ? 22 : 24} color="white" />
        ) : (
          <Text
            size={compact ? 22 : 24}
            bold
            color="white"
            style={{ padding: compact ? 14 : 16, paddingHorizontal: compact ? 22 : 24 }}>
            {value}
          </Text>
        )}
      </TouchableOpacity>
    ),
    [compact, handlePress, loading]
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
