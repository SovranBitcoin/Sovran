import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';

interface Props {
  onKeyPress: (value: string) => void;
}

type KeyVal = string | number;

const NumericKeyboard: React.FC<Props> = ({ onKeyPress }) => {
  const [inputValue, setInputValue] = useState('');
  const theme = useSelector(memoizedGetTheme);

  const handlePress = useCallback(
    (value: KeyVal) => {
      setInputValue((prev) => {
        let newValue = prev;
        if (String(value) === '<') {
          newValue = prev.slice(0, -1);
        } else {
          newValue = prev + String(value);
        }
        onKeyPress(newValue);
        return newValue;
      });
    },
    [onKeyPress]
  );

  const renderButton = useCallback(
    (value: KeyVal) => (
      <TouchableOpacity
        key={String(value)}
        className="mx-0.5 w-1/3 items-center justify-center overflow-hidden"
        style={{ backgroundColor: greys(theme)[2300] }}
        onPress={() => handlePress(value)}
      >
        {value === '<' ? (
          <Text style={{ color: 'white', fontSize: 24 }}>⌫</Text>
        ) : (
          <Text
            style={{
              padding: 16,
              paddingHorizontal: 24,
              fontSize: 24,
              color: 'white',
              fontWeight: 'bold',
              fontFamily: 'OverpassBold',
            }}
          >
            {value}
          </Text>
        )}
      </TouchableOpacity>
    ),
    [handlePress, theme]
  );

  const buttons: KeyVal[][] = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['', '0', '<'],
  ];

  return (
    <View className="items-center justify-center bg-transparent">
      {buttons.map((row, rowIndex) => (
        <View key={rowIndex} className="mb-0.25 flex-row justify-between">
          {row.map(renderButton)}
        </View>
      ))}
    </View>
  );
};

export default NumericKeyboard;
