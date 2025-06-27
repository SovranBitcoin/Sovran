// components/common/AnimatedSpriteBackground.tsx
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { SpriteView } from './Image';
import { DeviceMotion } from 'expo-sensors';

const AnimatedSpriteBackground = () => {
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
  }, []);

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFillObject,
        {
          transform: motion.getTranslateTransform(),
        },
      ]}>
      <SpriteView source={require('assets/images/bg2.png')} />
    </Animated.View>
  );
};

export default AnimatedSpriteBackground;
