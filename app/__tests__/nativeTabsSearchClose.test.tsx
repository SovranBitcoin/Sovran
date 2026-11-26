/**
 * @jest-environment node
 *
 * iOS 26 liquid-glass tabs: pressing the open Search tab goes back to the tab
 * it was opened from. The navigation goes straight to the tab navigator, so
 * the guarded router's 600 ms double-tap cooldown cannot swallow a quick
 * close (it uses the router's unguarded `raw`); a tab picked before the deferred close runs wins; and the Search
 * item tells VoiceOver where closing it returns to.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import TabLayout from '@/app/(drawer)/(tabs)/_layout';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Listeners = (args: { route: { name: string } }) => {
  focus: () => void;
  tabPress: () => void;
};
let mockListeners: Listeners | undefined;
const mockTriggers: Record<string, Record<string, unknown>> = {};
const mockRouterNavigate = jest.fn();
const mockRawNavigate = jest.fn();

function mockHost(name: string) {
  return (props: Record<string, unknown>) =>
    jest
      .requireActual<typeof import('react')>('react')
      .createElement(name, null, props.children as React.ReactNode);
}

let mockSearchClose: { close: () => void; accessibilityLabel: string } | undefined;
jest.mock('@/shared/ui/composed/SearchLayout', () => ({
  SearchCloseProvider: (props: {
    value: { close: () => void; accessibilityLabel: string };
    children: React.ReactNode;
  }) => {
    mockSearchClose = props.value;
    return props.children;
  },
}));
jest.mock('@/navigation/DrawerSceneOverlay', () => ({
  DrawerSceneOverlay: () => null,
}));
jest.mock('@/navigation/nativeTabs', () => {
  const Trigger = Object.assign(
    (props: { name: string; unstable_nativeProps: Record<string, unknown> }) => {
      mockTriggers[props.name] = props.unstable_nativeProps;
      return null;
    },
    { Label: () => null, Icon: () => null }
  );
  const Expo55NativeTabs = Object.assign(
    (props: { screenListeners: Listeners; children: React.ReactNode }) => {
      mockListeners = props.screenListeners;
      return jest
        .requireActual<typeof import('react')>('react')
        .createElement('Tabs', null, props.children);
    },
    { Trigger }
  );
  return { Expo55NativeTabs, isExpo55NativeTabsSupported: () => true };
});
jest.mock('expo-router', () => ({ Tabs: () => null }));
jest.mock('@/shared/hooks/useScreenInsets', () => ({
  TabBarInsetsProvider: mockHost('Insets'),
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => ['fg', 'muted'] }));
jest.mock('@/shared/blocks/SovranTabBar', () => ({
  SearchTabIcon: () => null,
  SovranTabBar: () => null,
}));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: {
    navigate: (...args: unknown[]) => mockRouterNavigate(...args),
    raw: { navigate: (...args: unknown[]) => mockRawNavigate(...args) },
  },
}));
jest.mock('assets/icons', () => ({ __esModule: true, default: () => null }));
jest.mock('react-native', () => ({ View: mockHost('RNView') }));

let frames: (() => void)[] = [];
beforeEach(() => {
  frames = [];
  let id = 0;
  jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
    const at = frames.length;
    frames[at] = () => cb(0);
    return ++id;
  });
  jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((handle) => {
    frames[(handle as number) - 1] = () => undefined;
  });
  mockRouterNavigate.mockClear();
  mockRawNavigate.mockClear();
});
afterEach(() => jest.restoreAllMocks());

function setup() {
  let r!: TestRenderer.ReactTestRenderer;
  act(() => {
    r = TestRenderer.create(<TabLayout />);
  });
  const on = (name: string) => mockListeners!({ route: { name } });
  return { r, on };
}

it('closes Search back to the tab it came from, past the router cooldown', () => {
  const { r, on } = setup();
  act(() => on('settings').focus());
  act(() => on('search').focus());
  act(() => on('search').tabPress());
  act(() => frames.forEach((run) => run()));
  expect(mockRawNavigate).toHaveBeenCalledWith('/(drawer)/(tabs)/settings');
  expect(mockRouterNavigate).not.toHaveBeenCalled();
  act(() => r.unmount());
});

it('drops a queued close when another tab is picked first', () => {
  const { r, on } = setup();
  act(() => on('search').focus());
  act(() => on('search').tabPress());
  act(() => on('settings').focus());
  act(() => frames.forEach((run) => run()));
  expect(mockRawNavigate).not.toHaveBeenCalled();
  expect(mockRouterNavigate).not.toHaveBeenCalled();
  act(() => r.unmount());
});

it('says where closing Search returns to', () => {
  const { r, on } = setup();
  expect(mockTriggers.search?.tabBarItemAccessibilityLabel).toBe('Search');
  act(() => on('settings').focus());
  act(() => on('search').focus());
  expect(mockTriggers.search?.tabBarItemAccessibilityLabel).toBe(
    'Close search. Returns to Settings'
  );
  act(() => r.unmount());
});

it("gives the Search header's close button the same way out", () => {
  const { r, on } = setup();
  expect(mockSearchClose?.accessibilityLabel).toBe('Close search. Returns to Wallet');
  act(() => on('settings').focus());
  act(() => on('search').focus());
  expect(mockSearchClose?.accessibilityLabel).toBe('Close search. Returns to Settings');
  act(() => mockSearchClose!.close());
  // A header press is not a tab re-select, so it leaves at once, unguarded.
  expect(mockRawNavigate).toHaveBeenCalledWith('/(drawer)/(tabs)/settings');
  expect(mockRouterNavigate).not.toHaveBeenCalled();
  act(() => r.unmount());
});
