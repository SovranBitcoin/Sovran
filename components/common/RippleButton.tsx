import React, { useCallback, useState, useRef } from 'react';
import { Animated, LayoutChangeEvent, ViewStyle, GestureResponderEvent } from 'react-native';
import { TouchableOpacity } from './TouchableOpacity';

interface RippleConfig {
  color?: string;
  opacity?: number;
  duration?: number;
  centered?: boolean;
}

interface RippleButtonProps {
  onPress: () => void;
  disabled?: boolean;
  style?: ViewStyle;
  children: React.ReactNode;
  rippleConfig?: RippleConfig;
}

const RippleButton: React.FC<RippleButtonProps> = ({
  onPress,
  disabled,
  style,
  children,
  rippleConfig = {},
}) => {
  const [size, setSize] = useState(0);
  const [buttonSize, setButtonSize] = useState({ width: 0, height: 0 });
  const [ripplePosition, setRipplePosition] = useState({ x: 0, y: 0 });
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  const {
    color = 'rgba(255,255,255,0.8)',
    opacity: rippleOpacity = 0.3,
    duration = 400,
    centered = true,
  } = rippleConfig;

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setButtonSize({ width, height });
    setSize(Math.max(width, height) * 2);
  }, []);

  const handlePressIn = useCallback(
    (event: GestureResponderEvent) => {
      if (disabled) return;

      // Calculate ripple position based on centered prop
      if (!centered && event.nativeEvent) {
        const { locationX, locationY } = event.nativeEvent;
        setRipplePosition({ x: locationX, y: locationY });
      } else {
        setRipplePosition({ x: buttonSize.width / 2, y: buttonSize.height / 2 });
      }

      scale.setValue(0);
      opacity.setValue(rippleOpacity);
      Animated.parallel([
        Animated.timing(scale, {
          toValue: 1,
          duration,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration,
          useNativeDriver: true,
        }),
      ]).start();
    },
    [opacity, scale, disabled, rippleOpacity, duration, centered, buttonSize]
  );

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
          top: ripplePosition.y - size / 2,
          left: ripplePosition.x - size / 2,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          transform: [{ scale }],
          opacity,
        }}
      />
      {children}
    </TouchableOpacity>
  );
};

export default RippleButton;
