import React, { useCallback, useRef } from 'react';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import { Button } from '@/shared/ui/primitives/Button';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import { Text } from '@/shared/ui/primitives/Text';
import { Log } from '@/shared/lib/logger';

interface Props {
  onKeyPress: (value: string) => void;
}

type KeyVal = string | number;

interface KeyButtonProps {
  value: KeyVal;
  onPress: (value: KeyVal) => void;
}

const TEXT_SHADOW = {
  textShadowColor: 'rgba(0,0,0,0.5)',
  textShadowOffset: { width: 0, height: 0 },
  textShadowRadius: 8,
} as const;

const KeyButton: React.FC<KeyButtonProps> = ({ value, onPress }) => {
  if (!value) {
    return <View className="flex-1" style={{ marginHorizontal: 0.5 }} />;
  }

  // The visible glyph for backspace is `⌫` which screen readers either
  // misread ("eraser") or skip — explicit label is required for the
  // passcode flow.
  const a11yLabel = value === '<' ? 'Delete' : `Digit ${value}`;

  return (
    <Button
      onPress={() => onPress(value)}
      accessibilityLabel={a11yLabel}
      ripple={{
        color: 'rgba(255,255,255,1)',
        opacity: 0.3,
        duration: 400,
        centered: false,
      }}
      style={{
        flex: 1,
        marginHorizontal: 0.5,
        height: 64,
        minHeight: 64,
      }}
      text={
        <VStack align="center" justify="center" flex={1}>
          {value === '<' ? (
            <Text size={32} bold className="text-white-0" style={TEXT_SHADOW}>
              ⌫
            </Text>
          ) : (
            <Text size={32} bold className="text-white-0 p-4 px-6" style={TEXT_SHADOW}>
              {value}
            </Text>
          )}
        </VStack>
      }
    />
  );
};

const NumericKeyboard: React.FC<Props> = ({ onKeyPress }) => {
  const inputRef = useRef('');

  const handlePress = useCallback(
    (value: KeyVal) => {
      let newValue: string;
      if (String(value) === '<') {
        EnhancedHaptics.actionHaptic();
        newValue = inputRef.current.slice(0, -1);
      } else {
        EnhancedHaptics.buttonHaptic();
        newValue = inputRef.current + String(value);
      }
      inputRef.current = newValue;
      onKeyPress(newValue);
    },
    [onKeyPress]
  );

  const renderButton = useCallback(
    (value: KeyVal) => <KeyButton key={String(value)} value={value} onPress={handlePress} />,
    [handlePress]
  );

  const buttons: KeyVal[][] = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['', '0', '<'],
  ];

  return (
    <Log name="NumericKeyboard">
      <VStack align="center" className="bg-transparent">
        {buttons.map((row, rowIndex) => (
          <HStack key={rowIndex} justify="space-between" className="w-full bg-transparent">
            {row.map(renderButton)}
            {rowIndex < buttons.length - 1 && <Spacer size={1} />}
          </HStack>
        ))}
      </VStack>
    </Log>
  );
};

export default NumericKeyboard;
