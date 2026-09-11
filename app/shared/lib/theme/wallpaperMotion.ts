/**
 * Shared wallpaper parallax. ONE DeviceMotion subscription (ref-counted)
 * drives ONE Animated.ValueXY that every wallpaper layer reads — so the
 * pre-mounted account-carousel layers translate identically to the base
 * layer and crossfades stay pixel-aligned (per-instance motion values left
 * hidden layers stuck at 0,0, which read as a weird offset while fading).
 */

// This singleton IS a legacy Animated.ValueXY: SpriteView's parallax
// transform runs native-driver springs on RN Animated (expo-image under
// Animated.View); Reanimated can't drive those legacy styles.
// eslint-disable-next-line no-restricted-imports
import { Animated } from 'react-native';
import { DeviceMotion } from 'expo-sensors';
import { log } from '@/shared/lib/logger';

export const wallpaperMotion = new Animated.ValueXY({ x: 0, y: 0 });

let subscribers = 0;
let subscription: { remove(): void } | null = null;

export function retainWallpaperMotion(): () => void {
  subscribers += 1;
  if (subscribers === 1 && !subscription) {
    DeviceMotion.setUpdateInterval(100);
    log.debug('bg.motion.shared_start', { intervalMs: 100 });
    let lastTarget: { x: number; y: number } | null = null;
    subscription = DeviceMotion.addListener(({ rotation }) => {
      if (!rotation) return;
      const { beta = 0, gamma = 0 } = rotation;
      const target = { x: gamma * 10, y: beta * 10 };
      // Stationary sensor noise must not continuously restart native springs.
      if (lastTarget && Math.hypot(target.x - lastTarget.x, target.y - lastTarget.y) < 0.25) return;
      lastTarget = target;
      Animated.spring(wallpaperMotion, {
        toValue: target,
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
      wallpaperMotion.stopAnimation();
      log.debug('bg.motion.shared_stop');
    }
  };
}
