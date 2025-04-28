import { StyleSheet, View, Pressable, Animated, useWindowDimensions } from 'react-native';
import { useRef, useEffect, useState } from 'react';
import { greys, shades, black } from 'helper/colors';
import { Text } from 'components/common/Themed';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';

export const ButtonBase = ({
  disabled = false,
  loading = false,
  variant = 'primary',
  text,
  onPress,
  icon,
  position = 'center',
  style,
  noPadding = false,
  useGradientBackground = false, // New prop to control gradient rendering in specific implementations
  renderBackground, // Pass platform-specific background rendering logic as a function
  circle = false,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  const scaleRef = useRef(new Animated.Value(1));
  const spinValue = useRef(new Animated.Value(0)).current;
  const colorsMap = {
    primary: [greys(theme)[0], greys(theme)[0]],
    secondary: [greys(theme)[1400], greys(theme)[1500], greys(theme)[1800]],
    transparent: ['transparent', 'transparent'],
  };

  const { width } = useWindowDimensions();
  const [colors, setColors] = useState(colorsMap[variant]);

  useEffect(() => {
    setColors(colorsMap[variant]);
  }, [variant]);

  useEffect(() => {
    const spinAnimation = Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 1250,
        useNativeDriver: true,
      })
    );
    if (isLoading) {
      spinAnimation.start();
    } else {
      spinAnimation.stop();
      spinValue.setValue(0);
    }
  }, [spinValue, isLoading]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <Animated.View
      style={[
        {
          transform: [{ scale: scaleRef.current }],
          opacity: disabled || loading ? 0.5 : 1,
        },
      ]}>
      <Pressable
        disabled={disabled || isLoading || loading}
        style={[
          {
            paddingVertical: 4,
            overflow: 'hidden',
            margin: 3,
            borderRadius: 32,
            // margin: position === "center" ? 16 : 0,
            // marginLeft: position === "right" ? 4 : 16,
            // marginRight: position === "left" ? 4 : 16,
            // marginTop: 8,
            marginBottom: 8,
            ...(variant === 'transparent' || noPadding ? { margin: 0 } : {}),
            opacity: disabled || isLoading ? 0.5 : 1,
            width: circle ? 48 : 'auto',
            height: circle ? 48 : 'auto',
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 0.33,
            borderColor: variant === 'primary' ? greys(theme)[100] : greys(theme)[1000],
            ...style,
          },
        ]}
        onPress={async (e) => {
          setIsLoading(true);
          setTimeout(() => {
            requestAnimationFrame(async () => {
              await onPress(e);
              setIsLoading(false);
            });
          }, 100);
        }}
        onPressIn={() => {
          Animated.spring(scaleRef.current, {
            toValue: 0.95,
            friction: 30,
            tension: 90,
            useNativeDriver: true,
          }).start();
        }}
        onPressOut={() => {
          Animated.spring(scaleRef.current, {
            toValue: 1,
            friction: 30,
            tension: 90,
            useNativeDriver: true,
          }).start();
        }}>
        <View style={styles.buttonContent}>
          {isLoading ? (
            <Animated.View style={{ transform: [{ rotate: spin }] }}>
              {/* Replace this icon with your loading icon */}
            </Animated.View>
          ) : (
            <View style={{ marginRight: icon ? (text ? 8 : 0) : 0 }}>
              <Text>{icon}</Text>
            </View>
          )}
          <Text
            style={{
              backgroundColor: 'transparent',
              color: variant === 'primary' ? black : greys(theme)[100],
              textAlign: 'center',
              paddingTop: 12,
              paddingBottom: 12,
              fontFamily: 'OverpassBold',
              fontSize: 16,
              width: text ? 'auto' : 0,
            }}>
            {text}
          </Text>
        </View>
        {renderBackground && renderBackground(colors, width)}
      </Pressable>
    </Animated.View>
  );
};

const createStyles = (theme) =>
  StyleSheet.create({
    buttonContent: {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
