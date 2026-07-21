import { Platform } from 'react-native';

/**
 * True only inside an Android e2e session. Android's `uiautomator dump` (the
 * harness's only accessibility source) requires the window to reach idle, which
 * a continuous Reanimated animation — a fountain QR, a skeleton pulse, an
 * in-progress spinner — prevents forever, leaving the dump empty and every AX
 * assert on the screen blind. Presentational animations gate off under this
 * flag so those screens can be captured; production and iOS keep them.
 *
 * Reuses the universal owned-Metro e2e signal (EXPO_PUBLIC_E2E_STATE_MIRROR,
 * set on every e2e session). Static member access only — babel-preset-expo
 * inlines EXPO_PUBLIC_* at transform time, so the read must stay a literal
 * member expression; production (NODE_ENV) and an ordinary dev session without
 * the flag both evaluate false.
 */
export const IS_ANDROID_E2E =
  __DEV__ &&
  Platform.OS === 'android' &&
  typeof process.env.EXPO_PUBLIC_E2E_STATE_MIRROR === 'string' &&
  process.env.EXPO_PUBLIC_E2E_STATE_MIRROR.length > 0;
