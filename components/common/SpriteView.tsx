// components/common/AnimatedSpriteBackground.tsx
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { SpriteView } from './Image';
import { DeviceMotion } from 'expo-sensors';
import { useSelector } from 'react-redux';
import { memoizedGetBackgroundImage } from 'helper/redux/settings';

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

  const backgroundImage = useSelector(memoizedGetBackgroundImage);

  const sources: Record<string, any> = {
    'bg.png': require('assets/images/backgrounds/bg.png'),
    'bg2.png': require('assets/images/backgrounds/bg2.png'),
    'bg3.png': require('assets/images/backgrounds/bg3.png'),
    'bg4.png': require('assets/images/backgrounds/bg4.png'),
    'bg_.png': require('assets/images/backgrounds/bg_.png'),
  };

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFillObject,
        {
          transform: motion.getTranslateTransform(),
        },
      ]}>
      <SpriteView source={sources[backgroundImage] || sources['bg.png']} />
    </Animated.View>
  );
};

export default AnimatedSpriteBackground;
