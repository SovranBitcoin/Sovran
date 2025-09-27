import React, { useRef, useState, useCallback } from 'react';
import {
  StyleProp,
  ViewStyle,
  Animated,
  LayoutChangeEvent,
  GestureResponderEvent,
} from 'react-native';
import { greys, black, reds } from 'helper/colors';
import { Text } from 'components/common/Text';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import Icon from 'assets/icons';
import { TouchableOpacity } from './TouchableOpacity';
import { View, HStack } from 'components/common/View';

interface RippleConfig {
  color?: string;
  opacity?: number;
  duration?: number;
  centered?: boolean;
}

interface UseRippleOptions {
  enabled: boolean;
  config: RippleConfig;
}

export const useRipple = ({ enabled, config }: UseRippleOptions) => {
  const [rippleSize, setRippleSize] = useState(0);
  const [buttonSize, setButtonSize] = useState({ width: 0, height: 0 });
  const [ripplePosition, setRipplePosition] = useState({ x: 0, y: 0 });
  const rippleScale = useRef(new Animated.Value(0)).current;
  const rippleOpacity = useRef(new Animated.Value(0)).current;

  const {
    color = 'rgba(255,255,255,0.8)',
    opacity = 0.3,
    duration = 400,
    centered = true,
  } = config;

  const handleLayout = useCallback(
    (e: LayoutChangeEvent) => {
      if (!enabled) return;
      const { width, height } = e.nativeEvent.layout;
      setButtonSize({ width, height });
      setRippleSize(Math.max(width, height) * 2);
    },
    [enabled]
  );

  const handlePressIn = useCallback(
    (event: GestureResponderEvent) => {
      if (!enabled) return;

      // Calculate ripple position
      if (!centered && event.nativeEvent) {
        const { locationX, locationY } = event.nativeEvent;
        setRipplePosition({ x: locationX, y: locationY });
      } else {
        setRipplePosition({ x: buttonSize.width / 2, y: buttonSize.height / 2 });
      }

      rippleScale.setValue(0);
      rippleOpacity.setValue(opacity);
      Animated.parallel([
        Animated.timing(rippleScale, {
          toValue: 1,
          duration,
          useNativeDriver: true,
        }),
        Animated.timing(rippleOpacity, {
          toValue: 0,
          duration,
          useNativeDriver: true,
        }),
      ]).start();
    },
    [enabled, centered, buttonSize, rippleScale, rippleOpacity, opacity, duration]
  );

  const getRippleStyle = useCallback(
    () => ({
      position: 'absolute' as const,
      top: ripplePosition.y - rippleSize / 2,
      left: ripplePosition.x - rippleSize / 2,
      width: rippleSize,
      height: rippleSize,
      borderRadius: rippleSize / 2,
      backgroundColor: color,
      transform: [{ scale: rippleScale }],
      opacity: rippleOpacity,
    }),
    [ripplePosition, rippleSize, color, rippleScale, rippleOpacity]
  );

  return {
    handleLayout,
    handlePressIn,
    getRippleStyle,
    shouldShowRipple: enabled,
  };
};

type ButtonVariant = 'primary' | 'secondary' | 'dangerous';

interface RippleConfig {
  color?: string;
  opacity?: number;
  duration?: number;
  centered?: boolean;
}

interface BlurConfig {
  intensity?: number;
  tint?: 'light' | 'dark' | 'default' | 'prominent';
}

export interface ButtonProps {
  testID?: string;
  disabled?: boolean;
  loading?: boolean;
  variant?: ButtonVariant;
  text?: string | React.ReactNode;
  onPress: (event: any) => Promise<void> | void;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  noPadding?: boolean;
  ripple?: boolean | RippleConfig;
  blur?: boolean | BlurConfig;
}

export const Button = ({
  disabled = false,
  loading = false,
  variant = 'primary',
  text,
  onPress,
  icon,
  style,
  testID,
  ripple = false,
  blur = false,
}: ButtonProps) => {
  const theme = useSelector(memoizedGetTheme);

  // Ripple hook
  const rippleConfig = typeof ripple === 'object' ? ripple : {};
  const {
    handleLayout: handleRippleLayout,
    handlePressIn: handleRipplePressIn,
    getRippleStyle,
    shouldShowRipple,
  } = useRipple({
    enabled: !!ripple,
    config: rippleConfig,
  });

  // Blur config
  const blurConfig = typeof blur === 'object' ? blur : {};
  const { intensity = 75, tint = 'dark' } = blurConfig;

  const shouldUseBlur = blur !== false;

  const getButtonStyles = () => {
    // Standard Button styling
    const base = {
      paddingVertical: 4, // py-1
      borderRadius: 9999, // rounded-full
      borderWidth: 0.33, // border-[0.33px]
      overflow: 'hidden' as const,
      opacity: disabled || loading ? 0.5 : 1,
    };

    // If ripple is enabled, use minimal styling like original RippleButton
    if (ripple) {
      return {
        overflow: 'hidden' as const,
        position: 'relative' as const,
        opacity: disabled || loading ? 0.5 : 1,
      };
    }

    if (shouldUseBlur) {
      return {
        ...base,
        borderWidth: 0,
      };
    }

    switch (variant) {
      case 'primary':
        return {
          ...base,
          backgroundColor: greys(theme)[0], // White/light background for primary
          borderColor: greys(theme)[50],
        };
      case 'secondary':
        return {
          ...base,
          backgroundColor: greys(theme)[700],
          borderColor: greys(theme)[500],
        };
      case 'dangerous':
        return {
          ...base,
          backgroundColor: reds[300],
          borderColor: reds[300],
        };
      default:
        return base;
    }
  };

  const getTextColor = () => {
    switch (variant) {
      case 'primary':
        return black;
      case 'secondary':
      case 'dangerous':
      default:
        return greys(theme)[0];
    }
  };

  const handlePress = async (e: any) => {
    if (disabled || loading) return;
    await onPress(e);
  };

  const handlePressIn = (event: any) => {
    if (disabled || loading) return;
    handleRipplePressIn(event);
  };

  // Ripple mode: behaves like original RippleButton (minimal styling, direct content)
  if (ripple) {
    return (
      <TouchableOpacity
        testID={testID}
        disabled={disabled || loading}
        onPress={handlePress}
        onLayout={handleRippleLayout}
        onPressIn={handlePressIn}
        style={[getButtonStyles(), style]}>
        {shouldShowRipple && <Animated.View pointerEvents="none" style={getRippleStyle()} />}
        {typeof text === 'string' ? (
          <Text
            style={{
              color: getTextColor(),
              fontFamily: 'OverpassBold',
              fontSize: 16,
            }}>
            {text}
          </Text>
        ) : (
          text || icon
        )}
      </TouchableOpacity>
    );
  }

  // Icon only button (no text)
  if (!text && icon) {
    return (
      <TouchableOpacity
        testID={testID}
        disabled={disabled || loading}
        onPress={handlePress}
        onLayout={handleRippleLayout}
        onPressIn={handlePressIn}>
        <View
          style={[getButtonStyles(), { width: 52, height: 52, position: 'relative' }, style]}
          blur={shouldUseBlur}
          blurIntensity={intensity}
          blurTint={tint}>
          {shouldShowRipple && <Animated.View pointerEvents="none" style={getRippleStyle()} />}
          {loading ? (
            <Icon
              name="ant-design:loading-outlined"
              size={16}
              spin={{
                delay: 0,
                duration: 1000,
                outputRange: ['0deg', '360deg'],
                easing: 'linear',
              }}
            />
          ) : (
            icon
          )}
        </View>
      </TouchableOpacity>
    );
  }

  // Text button (with optional icon)
  return (
    <TouchableOpacity
      testID={testID}
      disabled={disabled || loading}
      onPress={handlePress}
      onLayout={handleRippleLayout}
      onPressIn={handlePressIn}>
      <View
        style={[getButtonStyles(), { position: 'relative', minHeight: 48 }, style]}
        blur={shouldUseBlur}
        blurIntensity={intensity}
        blurTint={tint}>
        {shouldShowRipple && <Animated.View pointerEvents="none" style={getRippleStyle()} />}
        <HStack align="center" justify="center" spacing={text && icon && !loading ? 8 : 0}>
          {loading ? (
            <Icon
              name="ant-design:loading-outlined"
              size={16}
              spin={{
                delay: 0,
                duration: 1000,
                outputRange: ['0deg', '360deg'],
                easing: 'linear',
              }}
            />
          ) : (
            <>
              {icon}
              {text && (
                <Text
                  style={{
                    color: getTextColor(),
                    fontFamily: 'OverpassBold',
                    paddingVertical: 12, // py-3
                    textAlign: 'center',
                  }}
                  size={14}>
                  {text}
                </Text>
              )}
            </>
          )}
        </HStack>
      </View>
    </TouchableOpacity>
  );
};
