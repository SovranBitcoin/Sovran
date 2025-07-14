// components/common/AnimatedSpriteBackground.tsx
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
import Image, { SpriteView } from './Image';
import { DeviceMotion } from 'expo-sensors';
import { useSelector } from 'react-redux';
import { memoizedGetBackgroundImage } from 'helper/redux/settings';
import { BACKGROUND_IMAGES } from 'helper/backgroundImages';
import { View } from './View';

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
  }, []);

  const backgroundImage = useSelector(memoizedGetBackgroundImage);

  if (!backgroundImage)
    return <View style={[StyleSheet.absoluteFillObject, { backgroundColor }]}></View>;

  const dynamicImages = Object.values(BACKGROUND_IMAGES)
    .filter((img) => img.category !== 'Static')
    .map((img) => img.id);
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
        <SpriteView
          source={BACKGROUND_IMAGES[backgroundImage]?.source || BACKGROUND_IMAGES['bg.png'].source}
        />
      ) : (
        <Image
          source={BACKGROUND_IMAGES[backgroundImage]?.source || BACKGROUND_IMAGES['bg5.png'].source}
          style={[StyleSheet.absoluteFillObject, { transform: [{ scale: 1.18 }] }]}
        />
      )}
    </Animated.View>
  );
};

export default AnimatedSpriteBackground;
