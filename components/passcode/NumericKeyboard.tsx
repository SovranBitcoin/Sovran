import React, { useCallback, useState, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  Animated,
  LayoutChangeEvent,
  GestureResponderEvent,
} from 'react-native';
import Haptics from 'components/common/Haptics';

interface Props {
  onKeyPress: (value: string) => void;
}

type KeyVal = string | number;

interface KeyButtonProps {
  value: KeyVal;
  onPress: (value: KeyVal) => void;
}

const KeyButton: React.FC<KeyButtonProps> = ({ value, onPress }) => {
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
        // backgroundColor: greys(theme)[950],
      }}>
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: pos.y - size / 2,
          left: pos.x - size / 2,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: 'rgba(255,255,255,1)',
          transform: [{ scale }],
          opacity,
        }}></Animated.View>
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
    </Pressable>
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
