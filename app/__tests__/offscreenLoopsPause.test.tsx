/**
 * @jest-environment node
 *
 * Endless visual loops (skeleton shimmer, NearPay lightning, the recovery
 * elapsed-seconds readout) run only while their screen is focused and the app
 * is in the foreground.
 */
import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { NavigationContext } from 'expo-router/react-navigation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockLoops = { started: 0, cancelled: 0 };
const mockFrame = { setActive: jest.fn() };
jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated');
  return {
    ...actual,
    __esModule: true,
    // The readouts render through an animated TextInput; no host is needed here.
    default: { ...actual.default, createAnimatedComponent: () => () => null },
    withRepeat: (...args: unknown[]) => {
      mockLoops.started += 1;
      return actual.withRepeat(...args);
    },
    cancelAnimation: (...args: unknown[]) => {
      mockLoops.cancelled += 1;
      return actual.cancelAnimation(...args);
    },
    useFrameCallback: () => mockFrame,
  };
});
jest.mock('expo-router/react-navigation', () => ({
  NavigationContext: jest.requireActual('react').createContext(undefined),
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => 'black' }));
jest.mock('@/shared/lib/color', () => ({ withAlpha: (color: string) => color }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: () => null }));
jest.mock('@shopify/react-native-skia', () => {
  const Null = () => null;
  const path = () => ({
    addCircle: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    quadTo: () => undefined,
    cubicTo: () => undefined,
    close: () => undefined,
  });
  return {
    BlurMask: Null,
    Canvas: Null,
    Circle: Null,
    Group: Null,
    Path: Null,
    RadialGradient: Null,
    Skia: { Path: { Make: path } },
    vec: (x: number, y: number) => ({ x, y }),
  };
});

const { SkeletonLoadingShimmer } =
  require('@/shared/ui/composed/SkeletonExitShimmer') as typeof import('@/shared/ui/composed/SkeletonExitShimmer');
const { ElapsedSeconds } =
  require('@/shared/ui/composed/ElapsedSeconds') as typeof import('@/shared/ui/composed/ElapsedSeconds');
const { LightningStrike } =
  require('@/features/nearPay/components/LightningStrike') as typeof import('@/features/nearPay/components/LightningStrike');

let focused = true;
const navListeners = new Map<string, () => void>();
const appListeners = new Set<(state: AppStateStatus) => void>();
const navigation = {
  isFocused: () => focused,
  addListener: (event: string, fn: () => void) => {
    navListeners.set(event, fn);
    return () => navListeners.delete(event);
  },
};

beforeEach(() => {
  focused = true;
  navListeners.clear();
  appListeners.clear();
  mockLoops.started = 0;
  mockLoops.cancelled = 0;
  mockFrame.setActive.mockClear();
  AppState.currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    event: string,
    fn: (state: AppStateStatus) => void
  ) => {
    if (event !== 'change') return { remove: () => undefined };
    appListeners.add(fn);
    return { remove: () => appListeners.delete(fn) };
  }) as never);
});
afterEach(() => jest.restoreAllMocks());

function mount(element: React.ReactElement) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      // @ts-expect-error Minimal navigation object: focus state and listeners only.
      <NavigationContext.Provider value={navigation}>{element}</NavigationContext.Provider>
    );
  });
  return renderer;
}
const blur = () =>
  act(() => {
    focused = false;
    navListeners.get('blur')?.();
  });
const focus = () =>
  act(() => {
    focused = true;
    navListeners.get('focus')?.();
  });
const background = () => act(() => appListeners.forEach((listener) => listener('background')));
const foreground = () => act(() => appListeners.forEach((listener) => listener('active')));

it.each([
  ['skeleton shimmer', <SkeletonLoadingShimmer key="s" active />, 1],
  [
    'lightning strike',
    <LightningStrike key="l" status="active" entrance="strike" seed="peer-a" />,
    5,
  ],
])('stops the %s loops off screen and in the background', (_name, element, loops) => {
  const view = mount(element);
  expect(mockLoops.started).toBe(loops);
  const cancelledWhileShown = mockLoops.cancelled;
  blur();
  expect(mockLoops.cancelled).toBeGreaterThan(cancelledWhileShown);
  focus();
  expect(mockLoops.started).toBe(2 * loops);
  background();
  foreground();
  expect(mockLoops.started).toBe(3 * loops);
  act(() => view.unmount());
});

it('does not start the shimmer under a screen that is not focused', () => {
  focused = false;
  const view = mount(<SkeletonLoadingShimmer active />);
  expect(mockLoops.started).toBe(0);
  focus();
  expect(mockLoops.started).toBe(1);
  act(() => view.unmount());
});

it('runs the elapsed-seconds frame callback only while visible', () => {
  const view = mount(<ElapsedSeconds running color="white" />);
  expect(mockFrame.setActive).toHaveBeenLastCalledWith(true);
  blur();
  expect(mockFrame.setActive).toHaveBeenLastCalledWith(false);
  focus();
  expect(mockFrame.setActive).toHaveBeenLastCalledWith(true);
  act(() => view.unmount());
  expect(mockFrame.setActive).toHaveBeenLastCalledWith(false);
});
