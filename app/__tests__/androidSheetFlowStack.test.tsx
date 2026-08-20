/**
 * @jest-environment node
 */

import React from 'react';
import { Platform } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { Stack } from 'expo-router';

import { AndroidSheetFlowStack } from '@/config/flowLayoutOptions';
import { AndroidSheetRoot } from '@/shared/ui/composed/AndroidSheetRoot';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const originalPlatform = Platform.OS;

jest.mock('expo-router', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const Stack = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('stack', props, children);
  Stack.Screen = (props: Record<string, unknown>) => ReactActual.createElement('route', props);
  return { Stack, router: { back: jest.fn() } };
});

jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: () => ['foreground-color', 'background-color'],
}));

jest.mock('@/shared/ui/composed/AndroidSheetRoot', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    AndroidSheetRoot: ({ children, ...props }: { children?: React.ReactNode }) =>
      ReactActual.createElement('sheet-root', props, children),
  };
});

jest.mock('@/shared/ui/composed/FlowSheetHeader', () => ({
  FLOW_SHEET_HEADER_HEIGHT: 64,
  FlowSheetHeader: () => null,
}));

jest.mock('@/shared/ui/composed/ScreenHeaderAction', () => ({
  ScreenHeaderAction: () => null,
}));

jest.mock('@/shared/ui/composed/AndroidHeaderScrim', () => ({
  AndroidHeaderScrim: () => null,
}));

jest.mock('@/navigation/headerItems', () => ({
  withGlassHeaderItems: (options: Record<string, unknown>) => options,
}));

describe('AndroidSheetFlowStack', () => {
  beforeAll(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  });

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform });
  });

  it('owns the sheet frame and themed stack options behind a children-only interface', async () => {
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <AndroidSheetFlowStack>
          <Stack.Screen name="example" />
        </AndroidSheetFlowStack>
      );
    });

    const sheet = renderer!.root.findByType(AndroidSheetRoot);
    expect(sheet.props.headerHeight).toBe(64);

    const stack = renderer!.root.findByType(Stack);
    const options = stack.props.screenOptions({
      navigation: { getState: () => ({ index: 0 }) },
    });
    expect(options).toMatchObject({
      headerShown: true,
      headerTintColor: 'foreground-color',
      contentStyle: { backgroundColor: 'background-color' },
      header: expect.any(Function),
      headerBackground: undefined,
    });
    expect(stack.findByType(Stack.Screen).props.name).toBe('example');
  });
});
