/**
 * The app root feeds the native safe-area insets to Uniwind, so `*-safe*`
 * classes (`pb-safe-offset-5` on the bottom sheet) resolve to the real inset
 * instead of 0. HeroUINativeProvider used to do this; it was removed.
 */

import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { AppRoot } from '@/runtime/AppRoot';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockUpdateInsets = jest.fn();
jest.mock('uniwind', () => ({
  Uniwind: { updateInsets: (insets: unknown) => mockUpdateInsets(insets) },
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return {
    SafeAreaListener: ({
      children,
      onChange,
    }: {
      children: React.ReactNode;
      onChange: unknown;
    }) => (
      <View testID="safe-area-listener" onChange={onChange}>
        {children}
      </View>
    ),
  };
});

const passthrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
jest.mock('react-native-gesture-handler', () => ({ GestureHandlerRootView: passthrough }));
jest.mock('react-native-keyboard-controller', () => ({ KeyboardProvider: passthrough }));
jest.mock('@/shared/hooks/useFonts', () => ({ useFonts: () => [true, null] }));
jest.mock('@/shared/lib/logger', () => ({ IS_E2E_LOG_BUILD: false, initLog: () => {} }));
jest.mock('@/shared/lib/e2e/E2EStateMirror', () => ({ E2EStateMirror: () => null }));
jest.mock('@/shared/blocks/GlobalMigrationGate', () => passthrough);
jest.mock('@/shared/blocks/NativeSplashLayoutGate', () => ({
  NativeSplashLayoutGate: passthrough,
}));
jest.mock('@/shared/ui/capability', () => ({ CapabilityProvider: passthrough }));
jest.mock('@/shared/ui/composed/LayoutGuides', () => ({ LayoutGuides: () => null }));
jest.mock('@/shared/ui/composed/TouchIndicator', () => ({
  TouchIndicatorEnabled: jest.requireActual('react').createContext(false),
  TouchIndicatorLayer: passthrough,
}));
jest.mock('@/shared/providers/hero-transition/HeroTransitionProvider', () => ({
  HeroTransitionProvider: passthrough,
}));
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: (select: (s: object) => unknown) =>
    select({ layoutGuides: false, showTouches: false }),
}));
jest.mock('@/runtime/AppRuntime', () => ({ appRuntime: { startProcess: () => undefined } }));
jest.mock('@/runtime/theme', () => ({ useThemeApplier: () => true }));

it('wraps the app in a SafeAreaListener that forwards insets to Uniwind', () => {
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    renderer = TestRenderer.create(
      <AppRoot>
        <Text testID="app">App</Text>
      </AppRoot>
    );
  });
  const listener = renderer!.root.findByProps({ testID: 'safe-area-listener' });
  // The whole app tree sits inside it.
  expect(listener.findAllByProps({ testID: 'app' }).length).toBeGreaterThan(0);

  const insets = { top: 59, bottom: 34, left: 0, right: 0 };
  act(() => {
    listener.props.onChange({ insets, frame: { x: 0, y: 0, width: 393, height: 852 } });
  });
  expect(mockUpdateInsets).toHaveBeenCalledWith(insets);

  act(() => renderer!.unmount());
});
