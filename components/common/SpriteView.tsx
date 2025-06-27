// components/common/AnimatedSpriteBackground.tsx
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
import Image, { SpriteView } from './Image';
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
    'bg5.png': require('assets/images/backgrounds/bg5.png'),
  };

  if (!backgroundImage) return null;

  const dynamicImages = ['bg.png', 'bg2.png', 'bg3.png', 'bg4.png'];
  const isDynamic = dynamicImages.includes(backgroundImage);

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFillObject,
        {
          transform: motion.getTranslateTransform(),
        },
      ]}>
      {isDynamic ? (
        <SpriteView source={sources[backgroundImage] || sources['bg.png']} />
      ) : (
        <Image
          source={sources[backgroundImage] || sources['bg5.png']}
          style={StyleSheet.absoluteFillObject}
        />
      )}
    </Animated.View>
  );
};

export default AnimatedSpriteBackground;
