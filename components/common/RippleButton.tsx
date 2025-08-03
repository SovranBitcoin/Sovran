import React, { useCallback, useState, useRef } from 'react';
import { Animated, LayoutChangeEvent, ViewStyle } from 'react-native';
import { TouchableOpacity } from './TouchableOpacity';

interface RippleButtonProps {
  onPress: () => void;
  disabled?: boolean;
  style?: ViewStyle;
  children: React.ReactNode;
}

const RippleButton: React.FC<RippleButtonProps> = ({ onPress, disabled, style, children }) => {
  const [size, setSize] = useState(0);
  const [buttonSize, setButtonSize] = useState({ width: 0, height: 0 });
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setButtonSize({ width, height });
    setSize(Math.max(width, height) * 2);
  }, []);

  const handlePressIn = useCallback(() => {
    if (disabled) return;

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
  }, [opacity, scale, disabled]);

  return (
    <TouchableOpacity
      onLayout={handleLayout}
      onPressIn={handlePressIn}
      onPress={onPress}
      disabled={disabled}
      style={[
        style,
        {
          overflow: 'hidden',
          position: 'relative',
        },
      ]}>
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: buttonSize.height / 2 - size / 2,
          left: buttonSize.width / 2 - size / 2,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: 'rgba(255,255,255,0.8)',
          transform: [{ scale }],
          opacity,
        }}
      />
      {children}
    </TouchableOpacity>
  );
};

export default RippleButton;
