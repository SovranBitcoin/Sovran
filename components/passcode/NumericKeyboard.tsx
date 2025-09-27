import React, { useCallback, useState } from 'react';
import { Text } from 'react-native';
import Haptics from 'components/common/Haptics';
import { Button } from 'components/common/Button';
import { View, HStack, VStack, Spacer } from 'components/common/View';

interface Props {
  onKeyPress: (value: string) => void;
}

type KeyVal = string | number;

interface KeyButtonProps {
  value: KeyVal;
  onPress: (value: KeyVal) => void;
}

const KeyButton: React.FC<KeyButtonProps> = ({ value, onPress }) => {
  // Handle empty values (don't render button)
  if (!value) {
    return <View style={{ flex: 1, marginHorizontal: 0.5 }} />;
  }

  return (
    <Button
      onPress={() => onPress(value)}
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
            <Text
              style={{
                color: 'white',
                fontSize: 32,
                textShadowColor: 'rgba(0,0,0,0.5)',
                textShadowOffset: { width: 0, height: 0 },
                textShadowRadius: 8,
              }}>
              ⌫
            </Text>
          ) : (
            <Text
              style={{
                padding: 16,
                paddingHorizontal: 24,
                fontSize: 32,
                color: 'white',
                fontWeight: 'bold',
                fontFamily: 'OverpassBold',
                textShadowColor: 'rgba(0,0,0,0.5)',
                textShadowOffset: { width: 0, height: 0 },
                textShadowRadius: 8,
              }}>
              {value}
            </Text>
          )}
        </VStack>
      }
    />
  );
};

const NumericKeyboard: React.FC<Props> = ({ onKeyPress }) => {
  const [, setInputValue] = useState('');

  const handlePress = useCallback(
    (value: KeyVal) => {
      setInputValue((prev) => {
        let newValue = prev;
        if (String(value) === '<') {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          newValue = prev.slice(0, -1);
        } else {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          newValue = prev + String(value);
        }
        onKeyPress(newValue);
        return newValue;
      });
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
    <VStack align="center" className="bg-transparent">
      {buttons.map((row, rowIndex) => (
        <HStack
          key={rowIndex}
          justify="space-between"
          className="bg-transparent"
          style={{ width: '100%' }}>
          {row.map(renderButton)}
          {rowIndex < buttons.length - 1 && <Spacer size={1} />}
        </HStack>
      ))}
    </VStack>
  );
};

export default NumericKeyboard;
