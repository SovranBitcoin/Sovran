import { act, renderHook } from '@testing-library/react-native';

import { useBoundaryClock } from '@/shared/hooks/useBoundaryClock';

jest.mock('@/shared/hooks/useVisualActivityEffect', () => ({
  useVisualActivityEffect: (effect: () => void | (() => void)) => {
    const React = jest.requireActual<typeof import('react')>('react');
    React.useEffect(effect, [effect]);
  },
}));

afterEach(() => jest.useRealTimers());

it.each([1_000, 30 * 24 * 60 * 60 * 1000])('updates past a boundary %i ms away', (delayMs) => {
  jest.useFakeTimers();
  jest.setSystemTime(1_800_000_000_000);
  const boundary = Date.now() + delayMs;
  const { result, unmount } = renderHook(() => useBoundaryClock(boundary));
  expect(result.current).toBe(1_800_000_000_000);
  act(() => jest.advanceTimersByTime(delayMs + 1));
  expect(result.current).toBe(boundary + 1);
  unmount();
  expect(jest.getTimerCount()).toBe(0);
});

it('clears a future boundary on unmount', () => {
  jest.useFakeTimers();
  jest.setSystemTime(1_800_000_000_000);
  const { unmount } = renderHook(() => useBoundaryClock(1_800_000_100_000));
  expect(jest.getTimerCount()).toBe(1);
  unmount();
  expect(jest.getTimerCount()).toBe(0);
});
