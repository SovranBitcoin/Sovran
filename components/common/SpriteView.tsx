// components/common/AnimatedSpriteBackground.tsx
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
import Image, { SpriteView } from './Image';
import { DeviceMotion } from 'expo-sensors';
import { useSelector } from 'react-redux';
import { memoizedGetBackgroundImage } from 'helper/redux/settings';
import { View } from './View';

const AnimatedSpriteBackground = ({ backgroundColor }) => {
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
    'bg6.png': require('assets/images/backgrounds/bg6.png'),
    'bg7.png': require('assets/images/backgrounds/bg7.png'),
    'bg8.png': require('assets/images/backgrounds/bg8.png'),
    'bg9.png': require('assets/images/backgrounds/bg9.png'),
    'bg10.png': require('assets/images/backgrounds/bg10.png'),

    'bg11.gif': require('assets/images/backgrounds/bg11.gif'),

    'bg12.png': require('assets/images/backgrounds/bg12.png'),

    'bg14.png': require('assets/images/backgrounds/bg14.png'),
    'bg15.png': require('assets/images/backgrounds/bg15.png'),
    'bg16.png': require('assets/images/backgrounds/bg16.png'),
    'bg17.png': require('assets/images/backgrounds/bg17.png'),
  };

  if (!backgroundImage)
    return <View style={[StyleSheet.absoluteFillObject, { backgroundColor }]}></View>;

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
          style={[StyleSheet.absoluteFillObject, { transform: [{ scale: 1.18 }] }]}
        />
      )}
    </Animated.View>
  );
};

export default AnimatedSpriteBackground;
