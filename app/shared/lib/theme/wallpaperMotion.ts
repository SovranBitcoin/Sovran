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
import { countIdleWork } from '@/shared/lib/loggerIdleCounters';

export const wallpaperMotion = new Animated.ValueXY({ x: 0, y: 0 });

/** 1 px of travel is about 5.7° of tilt (`rotation * 10`). */
const MOTION_DEADBAND_PX = 1;
/** Fast but barely bouncing, so a step settles instead of ringing. */
const MOTION_SPRING = { bounciness: 4, speed: 40 } as const;

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
      // Sensor noise and hand tremor (a few degrees) must not keep restarting
      // native springs: follow only moves of at least MOTION_DEADBAND_PX.
      if (
        lastTarget &&
        Math.hypot(target.x - lastTarget.x, target.y - lastTarget.y) < MOTION_DEADBAND_PX
      )
        return;
      lastTarget = target;
      countIdleWork('wallpaper.spring');
      Animated.spring(wallpaperMotion, {
        toValue: target,
        useNativeDriver: true,
        ...MOTION_SPRING,
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
