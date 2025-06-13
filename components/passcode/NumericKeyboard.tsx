import React, { useCallback, useState, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  Animated,
  LayoutChangeEvent,
  GestureResponderEvent,
} from 'react-native';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import Haptics from 'components/common/Haptics';

interface Props {
  onKeyPress: (value: string) => void;
  /**
   * Optional custom key layout. Each sub array represents a row.
   */
  keys?: KeyVal[][];
  /**
   * When true (default) the keyboard will accumulate input before calling
   * onKeyPress. When false each key press will be sent directly.
   */
  accumulate?: boolean;
}

type KeyVal = string | number;

interface KeyButtonProps {
  value: KeyVal;
  onPress: (value: KeyVal) => void;
  theme: string;
}

const KeyButton: React.FC<KeyButtonProps> = ({ value, onPress, theme }) => {
  const [size, setSize] = useState(0);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize(Math.max(width, height) * 2);
  }, []);

  const handlePressIn = useCallback(
    (e: GestureResponderEvent) => {
      const { locationX, locationY } = e.nativeEvent;
      setPos({ x: locationX, y: locationY });
      scale.setValue(0);
      opacity.setValue(0.3);
      Animated.parallel([
        Animated.timing(scale, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }),
      ]).start();
    },
    [opacity, scale]
  );

  return (
    <Pressable
      onLayout={handleLayout}
      onPressIn={handlePressIn}
      onPress={() => onPress(value)}
      style={{
        flex: 1,
        marginHorizontal: 0.5,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        backgroundColor: greys(theme)[2300],
      }}
    >
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: pos.y - size / 2,
          left: pos.x - size / 2,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: 'rgba(255,255,255,0.3)',
          transform: [{ scale }],
          opacity,
        }}
      />
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
    </Pressable>
  );
};

const NumericKeyboard: React.FC<Props> = ({ onKeyPress, keys, accumulate = true }) => {
  const [inputValue, setInputValue] = useState('');
  const theme = useSelector(memoizedGetTheme);

  const handlePress = useCallback(
    (value: KeyVal) => {
      if (!accumulate) {
        if (String(value) === '<') {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        } else {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        onKeyPress(String(value));
        return;
      }

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
    [onKeyPress, accumulate]
  );

  const renderButton = useCallback(
    (value: KeyVal) => (
      <KeyButton key={String(value)} value={value} onPress={handlePress} theme={theme} />
    ),
    [handlePress, theme]
  );

  const defaultButtons: KeyVal[][] = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['', '0', '<'],
  ];

  const buttons = keys || defaultButtons;

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
