import React, { useCallback, useEffect, useRef, memo } from 'react';
import { View } from '@/shared/ui/primitives/View/View';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import Icon from 'assets/icons';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import { Text } from '@/shared/ui/primitives/Text';
import { Log } from '@/shared/lib/logger';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { nextKeypadValue, type KeyboardValue } from './keypadInput';

interface CustomKeyboardProps {
  onKeyPress: (value: string) => void;
  unit: 'sat' | string;
  loading?: boolean;
  compact?: boolean;
  /** External value to sync internal state (e.g. after fiat/sats toggle) */
  value?: string;
}

const CustomKeyboard: React.FC<CustomKeyboardProps> = ({
  onKeyPress,
  unit,
  loading = false,
  compact = false,
  value,
}) => {
  // A ref, not state: nothing in this component renders the value — the parent
  // owns the display and hears every change through `onKeyPress`. Holding it
  // here keeps `handlePress` stable (so the twelve keys never re-render), and
  // updating it synchronously at tap time means two presses in one React batch
  // still compose, which reading it from state would not guarantee.
  const inputRef = useRef(value ?? '');
  const foreground = useThemeColor('foreground');

  useEffect(() => {
    if (value !== undefined) {
      inputRef.current = value;
    }
  }, [value]);

  const handlePress = useCallback(
    (key: KeyboardValue) => {
      void (String(key) === '<' ? EnhancedHaptics.actionHaptic() : EnhancedHaptics.buttonHaptic());
      const next = nextKeypadValue(inputRef.current, key, unit);
      if (next === null) return;
      inputRef.current = next;
      onKeyPress(next);
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
