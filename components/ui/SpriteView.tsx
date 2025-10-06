import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { DeviceMotion } from 'expo-sensors';
import { useSelector } from 'react-redux';
import { memoizedGetBackgroundImage } from 'helper/redux/settings';
import { View } from './View';
import Image from './Image';
import { BACKGROUND_IMAGES } from '@/helper/backgroundImages';

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

  const backgroundImage = useSelector(memoizedGetBackgroundImage);

  if (!backgroundImage)
    return <View style={[StyleSheet.absoluteFillObject, { backgroundColor }]}></View>;

  // Map background image IDs to Tailwind gradient classes (for future use)
  // const _getBackgroundClassName = (imageId: string) => {
  //   const backgroundMap: Record<string, string> = {
  //     royalpurple: 'bg-gradient-to-br from-purple-900 via-purple-800 to-purple-950',
  //     mysticblue: 'bg-gradient-to-br from-blue-900 via-blue-800 to-blue-950',
  //     cosmicpurple: 'bg-gradient-to-br from-indigo-900 via-purple-900 to-indigo-950',
  //     deepocean: 'bg-gradient-to-br from-cyan-900 via-blue-900 to-cyan-950',
  //   };

  //   return backgroundMap[imageId] || 'bg-gradient-to-br from-gray-900 via-gray-800 to-gray-950';
  // };

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFillObject,
        {
          transform: motion.getTranslateTransform(),
        },
      ]}>
      {/* {isDynamic ? (
        <SpriteView
          source={BACKGROUND_IMAGES[backgroundImage]?.source || BACKGROUND_IMAGES['bg.png'].source}
        />
      ) : ( */}
      <Image
        source={BACKGROUND_IMAGES[backgroundImage]?.source}
        style={[StyleSheet.absoluteFillObject, { transform: [{ scale: 1.18 }] }]}
      />
      {/* )} */}
    </Animated.View>
  );
};

export default AnimatedSpriteBackground;
