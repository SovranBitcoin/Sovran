import React, { useRef, useEffect, useState, ReactNode, useMemo } from 'react';
import { View, Animated, useWindowDimensions, StyleProp, ViewStyle } from 'react-native';
import { greys, black, shades, reds } from 'helper/colors';
import { Text } from 'components/common/Text';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import Icon from 'assets/icons';
import { TouchableOpacity } from './TouchableOpacity';

type ButtonVariant = 'primary' | 'secondary' | 'dangerous';

export interface ButtonBaseProps {
  testID?: string;
  disabled?: boolean;
  loading?: boolean;
  variant: ButtonVariant;
  text?: string;
  onPress: (event: any) => Promise<void> | void;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  noPadding?: boolean;
  renderBackground?: (colors: string[], width: number) => ReactNode;
}

export const ButtonBase = ({
  disabled = false,
  loading = false,
  variant = 'primary',
  text,
  onPress,
  icon,
  style,
  noPadding = false,
  renderBackground,
  ...props
}: ButtonBaseProps): React.ReactNode => {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [showLoading, setShowLoading] = useState<boolean>(false);
  const theme = useSelector(memoizedGetTheme);
  const scaleRef = useRef(new Animated.Value(1));
  const loadingTimerRef = useRef<NodeJS.Timeout | null>(null);

  const colorsMap = useMemo(
    () => ({
      primary: [theme.greys[0], theme.greys[0]],
      secondary: [theme.greys[1400], theme.greys[1500], theme.greys[1800]],
      transparent: ['transparent', 'transparent'],
      dangerous: [reds[300]],
    }),
    [theme]
  );

  const { width } = useWindowDimensions();
  const [colors, setColors] = useState<string[]>(colorsMap[variant]);

  useEffect(() => {
    setColors(colorsMap[variant]);
  }, [variant, theme, colorsMap]);

  useEffect(() => {
    return () => {
      if (loadingTimerRef.current) {
        clearTimeout(loadingTimerRef.current);
      }
    };
  }, []);

  const handlePress = async (e: any): Promise<void> => {
    setIsLoading(true);

    loadingTimerRef.current = setTimeout(() => {
      if (isLoading) {
        setShowLoading(true);
      }
    }, 100);

    try {
      await onPress(e);
    } finally {
      if (loadingTimerRef.current) {
        clearTimeout(loadingTimerRef.current);
        loadingTimerRef.current = null;
      }
      setIsLoading(false);
      setShowLoading(false);
    }
  };

  const handlePressIn = (): void => {
    Animated.spring(scaleRef.current, {
      toValue: 0.95,
      friction: 30,
      tension: 90,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = (): void => {
    Animated.spring(scaleRef.current, {
      toValue: 1,
      friction: 30,
      tension: 90,
      useNativeDriver: true,
    }).start();
  };

  const isDisabled = disabled || isLoading || loading;
  const shouldShowLoading = showLoading || loading;

  return (
    <Animated.View
      style={[
        {
          transform: [{ scale: scaleRef.current }],
          opacity: isDisabled ? 0.5 : 1,
        },
      ]}>
      <TouchableOpacity
        testID={props?.testID}
        disabled={isDisabled}
        className="m-1 mb-2 items-center justify-center overflow-hidden rounded-full border border-[0.33px] py-1"
        style={[
          {
            ...(noPadding ? { margin: 0 } : {}),
            opacity: disabled || isLoading ? 0.5 : 1,
            borderColor: variant === 'primary' ? theme.greys[100] : theme.greys[1000],
            width: !text ? 48 : undefined,
            height: !text ? 48 : undefined,
          },
          style,
        ]}
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}>
        <View className="flex flex-row items-center justify-center">
          {shouldShowLoading ? (
            <Icon
              size={16}
              name="ant-design:loading-outlined"
              color={shades[300]}
              spin={{
                delay: 0,
                duration: 1000,
                outputRange: ['0deg', '360deg'],
                easing: 'linear',
              }}
            />
          ) : (
            icon && (
              <View style={{ marginRight: text ? 8 : 0 }}>
                <Text>{icon}</Text>
              </View>
            )
          )}
          <Text
            className="py-3 text-center text-base"
            style={{
              color: variant === 'primary' ? black : theme.greys[100],
              fontFamily: 'OverpassBold',
              width: !shouldShowLoading && text ? 'auto' : 0,
            }}>
            {text}
          </Text>
        </View>
        {renderBackground && renderBackground(colors, width)}
      </TouchableOpacity>
    </Animated.View>
  );
};
