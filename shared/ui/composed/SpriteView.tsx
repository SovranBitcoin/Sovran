import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { DeviceMotion } from 'expo-sensors';
import { View } from '@/shared/ui/primitives/View/View';
import Image from '@/shared/ui/primitives/Image';
import { backgroundImageThemes } from 'config/backgroundImageThemes';
import { useTheme } from '@/shared/providers/ThemeProvider';

const AnimatedSpriteBackground = ({ backgroundColor }: { backgroundColor: string }) => {
  const motion = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  useEffect(() => {
    DeviceMotion.setUpdateInterval(50);
    const subscription = DeviceMotion.addListener(({ rotation }) => {
      if (rotation) {
        const { beta = 0, gamma = 0 } = rotation;
        Animated.spring(motion, {
          toValue: {
            x: gamma * 10,
            y: beta * 10,
          },
          useNativeDriver: true,
          bounciness: 100,
          speed: 200,
        }).start();
      }
    });
    return () => subscription.remove();
  }, [motion]);

  const theme = useTheme();

  const backgroundImageSource = backgroundImageThemes[theme.currentTheme];

  if (!backgroundImageSource)
    return <View style={[StyleSheet.absoluteFillObject, { backgroundColor }]}></View>;

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFillObject,
        {
          transform: motion.getTranslateTransform(),
        },
      ]}>
      <Image
        source={backgroundImageSource}
        style={[StyleSheet.absoluteFillObject, { transform: [{ scale: 1.18 }] }]}
      />
    </Animated.View>
  );
};

export default AnimatedSpriteBackground;
