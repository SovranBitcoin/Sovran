/**
 * Stand-ins for the native runtime under the house `Sheet`
 * (`shared/ui/composed/Sheet.tsx`): reanimated, gesture-handler,
 * keyboard-controller, react-native-screens and react-native-worklets.
 *
 * Use from a `jest.mock` factory, e.g.
 *
 *   jest.mock('react-native-reanimated', () => require('./helpers/sheetRuntimeMocks').reanimated);
 *
 * Shared values hold plain values and, like the real library, writing one
 * redraws every mounted animated style. Animations land on their target at
 * once, but their completion callbacks wait for `finishAnimations()`, so a
 * test decides when a sheet has finished sliding in (`onPresented`) or out
 * (`onClosed`).
 */

import React from 'react';

type Callback = (finished: boolean) => void;

const pendingCallbacks: Callback[] = [];
const redraws = new Set<() => void>();

/** Lands every running animation: fires the completion callbacks queued so far. */
export function finishAnimations(): void {
  while (pendingCallbacks.length > 0) pendingCallbacks.shift()!(true);
}

/** Lands only the oldest running animation. */
export function finishOldestAnimation(): void {
  pendingCallbacks.shift()?.(true);
}

/** Drops queued completion callbacks (between tests). */
export function resetAnimations(): void {
  pendingCallbacks.length = 0;
}

function animateTo<T>(target: T, callback?: Callback): T {
  if (callback) pendingCallbacks.push(callback);
  return target;
}

function useRedrawOnWrite() {
  const [, redraw] = React.useReducer((count: number) => count + 1, 0);
  React.useEffect(() => {
    const listener = () => redraw();
    redraws.add(listener);
    return () => void redraws.delete(listener);
  }, []);
}

function makeShared<T>(initial: T) {
  let current = initial;
  const shared = {
    get: () => current,
    set: (next: T) => {
      if (Object.is(current, next)) return;
      current = next;
      redraws.forEach((listener) => listener());
    },
    get value() {
      return current;
    },
    set value(next: T) {
      shared.set(next);
    },
  };
  return shared;
}

/** A layout-animation builder: every modifier returns the builder. */
function layoutBuilder(): Record<string, unknown> {
  const builder: Record<string, unknown> = new Proxy(
    {},
    { get: (_target, key) => (key === 'then' ? undefined : () => builder) }
  );
  return builder;
}

/** An animated stand-in for `Component` (or a react-native export, resolved on first render). */
function animatedHost(Component: React.ElementType | 'View' | 'ScrollView' | 'Text') {
  return React.forwardRef(function AnimatedHost(
    { entering: _entering, exiting: _exiting, ...props }: Record<string, unknown>,
    ref
  ) {
    const Resolved =
      typeof Component === 'string'
        ? // The node preset compiles `react-native` imports to react-native-web.
          (jest.requireActual('react-native-web') as Record<string, React.ElementType>)[Component]
        : Component;
    return React.createElement(Resolved, { ...props, ref });
  });
}

const easing = (value: number) => value;

export const reanimated = {
  __esModule: true,
  default: {
    View: animatedHost('View'),
    ScrollView: animatedHost('ScrollView'),
    Text: animatedHost('Text'),
    createAnimatedComponent: (Component: React.ElementType) => animatedHost(Component),
  },
  Easing: {
    bezier: () => easing,
    ease: easing,
    exp: easing,
    linear: easing,
    quad: easing,
    cubic: easing,
    in: <T,>(fn: T) => fn,
    out: <T,>(fn: T) => fn,
    inOut: <T,>(fn: T) => fn,
  },
  FadeIn: layoutBuilder(),
  FadeOut: layoutBuilder(),
  FadeInUp: layoutBuilder(),
  Keyframe: class {
    duration() {
      return this;
    }
  },
  cancelAnimation: () => {},
  interpolate: (value: number, input: number[], output: number[]) => {
    if (value <= input[0]) return output[0];
    if (value >= input[input.length - 1]) return output[output.length - 1];
    const index = input.findIndex((point) => value <= point);
    const ratio = (value - input[index - 1]) / (input[index] - input[index - 1]);
    return output[index - 1] + ratio * (output[index] - output[index - 1]);
  },
  interpolateColor: (value: number, _input: number[], colors: string[]) =>
    value >= 1 ? colors[colors.length - 1] : colors[0],
  useAnimatedScrollHandler:
    (handler: (event: unknown) => void) => (event: { nativeEvent: unknown }) =>
      handler(event.nativeEvent),
  useAnimatedStyle: <T,>(factory: () => T) => {
    useRedrawOnWrite();
    return factory();
  },
  useSharedValue: <T,>(initial: T) => React.useRef(makeShared(initial)).current,
  withSpring: <T,>(target: T, _config?: unknown, callback?: Callback) =>
    animateTo(target, callback),
  withTiming: <T,>(target: T, _config?: unknown, callback?: Callback) =>
    animateTo(target, callback),
};

/** A chainable gesture whose handlers stay readable on `handlers`. */
function gesture(kind: string) {
  const handlers: Record<string, unknown> = {};
  const chain: Record<string, unknown> = new Proxy(
    { kind, handlers },
    {
      get: (target, key) => {
        if (key in target) return target[key as keyof typeof target];
        if (typeof key !== 'string') return undefined;
        return (value: unknown) => {
          handlers[key] = value;
          return chain;
        };
      },
    }
  );
  return chain;
}

export const gestureHandler = {
  Gesture: {
    Pan: () => gesture('pan'),
    Tap: () => gesture('tap'),
    Native: () => gesture('native'),
    Exclusive: (...gestures: unknown[]) => ({ kind: 'exclusive', gestures }),
  },
  GestureDetector: ({
    children,
    gesture: detected,
  }: {
    children?: React.ReactNode;
    gesture: unknown;
  }) => React.createElement('GestureDetector', { gesture: detected }, children),
  GestureHandlerRootView: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('GestureHandlerRootView', props, children),
};

export const keyboardController = {
  useReanimatedKeyboardAnimation: () => ({
    height: makeShared(0),
    progress: makeShared(0),
  }),
};

export const screens = {
  FullWindowOverlay: ({
    children,
    ...props
  }: {
    children?: React.ReactNode;
    unstable_accessibilityContainerViewIsModal?: boolean;
  }) => React.createElement('FullWindowOverlay', props, children),
};

export const worklets = {
  scheduleOnRN: (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => fn(...args),
};

export const safeArea = {
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
};

/** Window size for `useWindowDimensions` (react-native-web reports 0×0 without a DOM). */
export const windowDimensions = {
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
};
