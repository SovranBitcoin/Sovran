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

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

function setup() {
  const navigate = jest.fn();
  const { result } = renderHook(() => useCardTapGesture(navigate));
  const recognise = (success = true) =>
    act(() => {
      mockEnd({}, success);
    });
  const flush = () =>
    act(() => {
      jest.runAllTimers();
    });
  return { navigate, card: () => result.current, recognise, flush };
}

it('gives nested controls press ownership without waiting for haptic completion', () => {
  const onPressIn = jest.fn();
  const view = render(<Pressable testID="menu" haptics onPressIn={onPressIn} />);
  act(() => {
    view.UNSAFE_getByType(NativePressable).props.onPressIn({});
  });
  expect(onPressIn).toHaveBeenCalledTimes(1);
});

it('opens the thread for a body tap once pending touch events have landed', () => {
  const { navigate, card, recognise, flush } = setup();
  card().begin();
  card().probe();
  recognise();
  expect(navigate).not.toHaveBeenCalled();
  flush();
  expect(navigate).toHaveBeenCalledTimes(1);
});

it('never opens when a nested control claimed the responder', () => {
  const { navigate, card, recognise, flush } = setup();
  card().begin(); // descendant claimed, so the root probe is never asked
  recognise();
  flush();
  expect(navigate).not.toHaveBeenCalled();
});

it('never opens for a disabled action that only latches suppression on touch start', () => {
  const { navigate, card, recognise, flush } = setup();
  card().begin();
  card().suppress(); // action bar touch start
  card().probe(); // the disabled Pressable declined, so the root was asked
  recognise();
  flush();
  expect(navigate).not.toHaveBeenCalled();
});

it('still sees the RN touch events when recognition outruns them', () => {
  const body = setup();
  body.recognise();
  body.card().begin();
  body.card().probe();
  body.flush();
  expect(body.navigate).toHaveBeenCalledTimes(1);

  const nested = setup();
  nested.recognise();
  nested.card().begin();
  nested.card().suppress();
  nested.flush();
  expect(nested.navigate).not.toHaveBeenCalled();
});

it('keeps a nested press suppressed after press-out, until the next touch begins', () => {
  const { navigate, card, recognise, flush } = setup();
  card().begin();
  card().suppress();
  flush();
  recognise();
  flush();
  expect(navigate).not.toHaveBeenCalled();
  card().begin();
  card().probe();
  recognise();
  flush();
  expect(navigate).toHaveBeenCalledTimes(1);
});

it('does not reuse a consumed body touch for a recognition with no new touch', () => {
  const { navigate, card, recognise, flush } = setup();
  card().begin();
  card().probe();
  recognise();
  flush();
  recognise(); // e.g. tapping a flinging list to stop it
  flush();
  expect(navigate).toHaveBeenCalledTimes(1);
});

it('never opens a thread for a failed or cancelled recognizer', () => {
  const { navigate, card, recognise, flush } = setup();
  card().begin();
  card().probe();
  recognise(false);
  flush();
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
