/** @jest-environment node */
import { renderHook } from '@testing-library/react-native';

let mockFinish = true;
jest.mock('react-native-reanimated', () => ({
  Easing: { bezier: () => (t: number) => t },
  makeMutable: <T,>(value: T) => {
    let current = value;
    return {
      get: () => current,
      set: (next: T | { to: T; done?: (finished: boolean) => void }) => {
        if (next && typeof next === 'object' && 'to' in next) {
          current = next.to;
          next.done?.(mockFinish);
        } else current = next as T;
      },
    };
  },
  withTiming: (to: unknown, _config: unknown, done?: (finished: boolean) => void) => ({
    to,
    done,
  }),
}));
jest.mock('react-native-worklets', () => ({ scheduleOnRN: (fn: () => void) => fn() }));
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, [effect]),
}));
jest.mock('@/shared/lib/logger', () => ({ log: { info: jest.fn() } }));

const blur =
  require('@/shared/lib/theme/backgroundBlur') as typeof import('@/shared/lib/theme/backgroundBlur');

it('mounts the full-screen blur only while full mode is shown or fading out', () => {
  // The home's partial mode never mounts it.
  const view = renderHook(
    ({ mode }: { mode: 'partial' | 'full' | 'none' }) =>
      blur.useBackgroundConfig({ blurMode: mode }),
    { initialProps: { mode: 'partial' as 'partial' | 'full' | 'none' } }
  );
  expect(blur.isFullBlurShown()).toBe(false);

  const changes = jest.fn();
  const unsubscribe = blur.subscribeFullBlurShown(changes);
  view.rerender({ mode: 'full' });
  expect(blur.isFullBlurShown()).toBe(true);

  // A fade-out that is interrupted keeps it mounted ...
  mockFinish = false;
  view.rerender({ mode: 'none' });
  expect(blur.isFullBlurShown()).toBe(true);
  // ... and one that finishes unmounts it.
  mockFinish = true;
  view.rerender({ mode: 'partial' });
  expect(blur.isFullBlurShown()).toBe(false);
  expect(changes).toHaveBeenCalledTimes(2);
  unsubscribe();
  view.unmount();
});
