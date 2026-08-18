import React, { useState, useCallback, useEffect, memo } from 'react';
import { View } from '@/shared/ui/primitives/View/View';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import Icon from 'assets/icons';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import { Text } from '@/shared/ui/primitives/Text';
import { Log } from '@/shared/lib/logger';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

interface CustomKeyboardProps {
  onKeyPress: (value: string) => void;
  unit: 'sat' | string;
  loading?: boolean;
  compact?: boolean;
  /** External value to sync internal state (e.g. after fiat/sats toggle) */
  value?: string;
}

type KeyboardValue = string | number;

const CustomKeyboard: React.FC<CustomKeyboardProps> = ({
  onKeyPress,
  unit,
  loading = false,
  compact = false,
  value,
}) => {
  const [, setInputValue] = useState(value ?? '');
  const foreground = useThemeColor('foreground');

  useEffect(() => {
    if (value !== undefined) {
      setInputValue(value);
    }
  }, [value]);

  const handlePress = useCallback(
    (value: KeyboardValue) => {
      setInputValue((prev) => {
        const str = String(value);
        let next: string;

        if (str === '<') {
          void EnhancedHaptics.actionHaptic();
          next = prev.slice(0, -1);
        } else if (unit !== 'sat' && prev === '0' && str !== '.') {
          void EnhancedHaptics.buttonHaptic();
          next = str;
        } else {
          void EnhancedHaptics.buttonHaptic();
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
      <Pressable
        key={String(value)}
        className="mx-0.5 w-1/3 items-center justify-center overflow-hidden"
        style={{ opacity: loading ? 0.5 : 1 }}
        disabled={loading}
        onPress={() => handlePress(value)}>
        {value === '<' ? (
          <Icon name="lucide:delete" size={compact ? 22 : 24} color={foreground} />
        ) : (
          <Text
            size={compact ? 22 : 24}
            bold
            color={foreground}
            style={{ padding: compact ? 14 : 16, paddingHorizontal: compact ? 22 : 24 }}>
            {value}
          </Text>
        )}
      </Pressable>
    ),
    [compact, foreground, handlePress, loading]
  );

  const buttons: KeyboardValue[][] = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    [unit === 'sat' ? '' : '.', '0', '<'],
  ];

  return (
    <Log name="CustomKeyboard">
      <View className="items-center justify-center" style={{ opacity: loading ? 0.5 : 1 }}>
        {buttons.map((row, rowIndex) => (
          <View key={rowIndex} className="mb-0.25 flex-row justify-between">
            {row.map(renderButton)}
          </View>
        ))}
      </View>
    </Log>
  );
};

export default memo(CustomKeyboard);
