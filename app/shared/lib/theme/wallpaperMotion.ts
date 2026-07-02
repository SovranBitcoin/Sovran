/**
 * Shared wallpaper parallax. ONE DeviceMotion subscription (ref-counted)
 * drives ONE Animated.ValueXY that every wallpaper layer reads — so the
 * pre-mounted account-carousel layers translate identically to the base
 * layer and crossfades stay pixel-aligned (per-instance motion values left
 * hidden layers stuck at 0,0, which read as a weird offset while fading).
 */

import { Animated } from 'react-native';
import { DeviceMotion } from 'expo-sensors';
import { log } from '@/shared/lib/logger';

export const wallpaperMotion = new Animated.ValueXY({ x: 0, y: 0 });

let subscribers = 0;
let subscription: { remove(): void } | null = null;

export function retainWallpaperMotion(): () => void {
  subscribers += 1;
  if (subscribers === 1 && !subscription) {
    DeviceMotion.setUpdateInterval(50);
    log.debug('bg.motion.shared_start', { intervalMs: 50 });
    subscription = DeviceMotion.addListener(({ rotation }) => {
      if (!rotation) return;
      const { beta = 0, gamma = 0 } = rotation;
      Animated.spring(wallpaperMotion, {
        toValue: { x: gamma * 10, y: beta * 10 },
        useNativeDriver: true,
        bounciness: 100,
        speed: 200,
      }).start();
    });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    subscribers -= 1;
    if (subscribers <= 0 && subscription) {
      subscription.remove();
      subscription = null;
      log.debug('bg.motion.shared_stop');
    }
  };
}
