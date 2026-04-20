import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { DeviceMotion } from 'expo-sensors';
import { View } from '@/shared/ui/primitives/View/View';
import Image from '@/shared/ui/primitives/Image';
import { backgroundImageThemes } from 'config/backgroundImageThemes';
import { useTheme } from '@/shared/providers/ThemeProvider';
import { Log, log } from '@/shared/lib/logger';

interface AnimatedSpriteBackgroundProps {
  backgroundColor: string;
  /**
   * Theme to render. When omitted, falls back to the global theme context
   * (preserves behaviour of existing callsites that haven't migrated to
   * passing per-unit wallpapers explicitly).
   */
  themeName?: string;
}

const AnimatedSpriteBackground = ({
  backgroundColor,
  themeName,
}: AnimatedSpriteBackgroundProps) => {
  const motion = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  useEffect(() => {
    DeviceMotion.setUpdateInterval(50);
    log.debug('bg.sprite.motion.start', { intervalMs: 50 });
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
    return () => {
      log.debug('bg.sprite.motion.stop');
      subscription.remove();
    };
  }, [motion]);

  const ctxTheme = useTheme();
  const activeTheme = themeName ?? ctxTheme.currentTheme;
  const backgroundImageSource = backgroundImageThemes[activeTheme];

  if (!backgroundImageSource) {
    log.debug('bg.sprite.render', { theme: activeTheme, hasImage: false });
    return (
      <Log name="SpriteView">
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor }]}></View>
      </Log>
    );
  }

  log.debug('bg.sprite.render', { theme: activeTheme, hasImage: true });

  return (
    <Log name="SpriteView">
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
    </Log>
  );
};

export default AnimatedSpriteBackground;
