import { act, render, renderHook } from '@testing-library/react-native';
// eslint-disable-next-line no-restricted-imports -- Exercise the shared wrapper's native press-in boundary.
import { Pressable as NativePressable } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { useCardTapGesture } from '@/features/feed/hooks/useCardTapGesture';

let mockEnd: (_event: unknown, success: boolean) => void;
jest.mock('react-native-gesture-handler', () => ({
  Gesture: {
    Tap: () => {
      const gesture = {
        runOnJS: () => gesture,
        onEnd: (callback: typeof mockEnd) => {
          mockEnd = callback;
          return gesture;
        },
      };
      return gesture;
    },
  },
}));
jest.mock('react-native-reanimated', () => ({ runOnJS: (fn: unknown) => fn }));
jest.mock('@/shared/ui/primitives/Haptics', () => ({
  EnhancedHaptics: { buttonHaptic: () => new Promise(() => {}) },
}));
jest.mock('@/shared/lib/logger', () => ({ log: { warn: jest.fn() } }));

it('gives nested controls press ownership without waiting for haptic completion', () => {
  const onPressIn = jest.fn();
  const view = render(<Pressable testID="menu" haptics onPressIn={onPressIn} />);
  act(() => {
    view.UNSAFE_getByType(NativePressable).props.onPressIn({});
  });
  expect(onPressIn).toHaveBeenCalledTimes(1);
});

it('keeps a nested press suppressed after press-out, even if JS recognition is delayed', () => {
  jest.useFakeTimers();
  const navigate = jest.fn();
  const { result } = renderHook(() => useCardTapGesture(navigate));
  act(() => {
    result.current.suppress();
    jest.runAllTimers();
    mockEnd({}, true);
  });
  expect(navigate).not.toHaveBeenCalled();
  act(() => {
    expect(result.current.begin()).toBe(false);
    mockEnd({}, true);
  });
  expect(navigate).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});

it('never opens a thread for a failed or cancelled recognizer', () => {
  const navigate = jest.fn();
  renderHook(() => useCardTapGesture(navigate));
  act(() => mockEnd({}, false));
  expect(navigate).not.toHaveBeenCalled();
});

it('resets both repost and inner-card suppression before the next touch', () => {
  const navigate = jest.fn();
  const { result } = renderHook(() => ({
    outer: useCardTapGesture(navigate),
    inner: useCardTapGesture(navigate),
  }));
  act(() => {
    result.current.outer.begin();
    result.current.inner.begin();
    result.current.inner.suppress();
    result.current.outer.suppress();
    result.current.inner.handleTap();
    result.current.outer.handleTap();
  });
  expect(navigate).not.toHaveBeenCalled();
  act(() => {
    result.current.outer.begin();
    result.current.outer.handleTap();
  });
  expect(navigate).toHaveBeenCalledTimes(1);
});
