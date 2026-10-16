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
    SheetPageLayer: jest.requireActual('@/shared/ui/composed/AndroidSheetRoot').SheetPageLayer,
  };
});

jest.mock('@/shared/ui/composed/FlowSheetHeader', () => ({
  FLOW_SHEET_HEADER_HEIGHT: 64,
  FlowSheetHeader: () => null,
}));

jest.mock('@/shared/ui/composed/ScreenHeaderAction', () => ({
  ScreenHeaderAction: () => null,
}));

jest.mock('@/shared/ui/composed/HeaderGradient', () => ({
  HeaderGradient: () => null,
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
        <AndroidSheetFlowStack flow="(filter-flow)">
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

  it('renders a pushed flow as a plain stack with the native header, outside any sheet frame', async () => {
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <AndroidSheetFlowStack flow="(send-flow)">
          <Stack.Screen name="example" />
        </AndroidSheetFlowStack>
      );
    });

    expect(renderer!.root.findAllByType(AndroidSheetRoot)).toHaveLength(0);
    const stack = renderer!.root.findByType(Stack);
    expect(stack.props.screenLayout).toBeUndefined();
    const options = stack.props.screenOptions({
      navigation: { getState: () => ({ index: 0 }) },
    });
    // No JS sheet header: the native one draws.
    expect(options.header).toBeUndefined();
    expect(options.headerShown).toBe(true);
  });

  // Fabric sorts an un-isolated page's zIndex layers (ScrollEdgeFade at 50)
  // against the header wrapper's zIndex 1, drawing the gradient over the title.
  it('isolates each page so its layers stay under the sheet header', async () => {
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <AndroidSheetFlowStack flow="(filter-flow)">
          <Stack.Screen name="example" />
        </AndroidSheetFlowStack>
      );
    });

    const { screenLayout } = renderer!.root.findByType(Stack).props;
    let page: TestRenderer.ReactTestRenderer;
    await act(async () => {
      page = TestRenderer.create(screenLayout({ children: React.createElement('page') }));
    });

    const layer = page!.toJSON() as TestRenderer.ReactTestRendererJSON;
    expect(layer.props.style).toMatchObject({ isolation: 'isolate' });
    expect(page!.root.findByType('page' as never)).toBeTruthy();
  });
});
