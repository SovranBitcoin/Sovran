/**
 * @jest-environment node
 */

import React from 'react';
import { Platform } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { Stack } from 'expo-router';

import { FlowStack } from '@/config/flowLayoutOptions';

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

jest.mock('@/shared/ui/composed/ScreenHeaderAction', () => ({
  ScreenHeaderAction: (props: Record<string, unknown>) =>
    jest.requireActual<typeof import('react')>('react').createElement('header-action', props),
}));

jest.mock('@/navigation/headerItems', () => ({
  withGlassHeaderItems: (options: Record<string, unknown>) => options,
}));

function optionsAt(index: number, name = 'example', pushed = false) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <FlowStack pushed={pushed}>
        <Stack.Screen name={name} />
      </FlowStack>
    );
  });
  const stack = renderer.root.findByType(Stack);
  expect(stack.findByType(Stack.Screen).props.name).toBe(name);
  return stack.props.screenOptions({
    navigation: { getState: () => ({ index }) },
    route: { name },
  });
}

function headerButton(options: { headerLeft: () => React.ReactElement }) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(options.headerLeft());
  });
  return renderer.root.findByType('header-action' as never).props;
}

describe.each(['ios', 'android'] as const)('FlowStack on %s', (os) => {
  beforeAll(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
  });

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform });
  });

  it('is a plain themed stack with the native header', () => {
    const options = optionsAt(0);
    expect(options).toMatchObject({
      headerShown: true,
      headerTintColor: 'foreground-color',
      contentStyle: { backgroundColor: 'background-color' },
      animation: 'slide_from_right',
    });
    // No JS sheet header: the native one draws.
    expect(options.header).toBeUndefined();
  });

  it('closes from the first screen and goes back from the next', () => {
    const first = headerButton(optionsAt(0));
    expect(first.testID).toBe('flow-header-close');
    // A pushed Android screen is left with the back arrow; an iPhone sheet with the X.
    expect(first.icon).toBe(
      os === 'android' ? 'material-symbols:arrow-back-rounded' : 'material-symbols:close-rounded'
    );
    const next = headerButton(optionsAt(1));
    expect(next).toMatchObject({
      testID: 'flow-header-back',
      icon: 'material-symbols:arrow-back-rounded',
    });
  });

  it('goes back from the first screen of a pushed flow (Settings), keeping its selectors', () => {
    const first = headerButton(optionsAt(0, 'design-system', true));
    expect(first).toMatchObject({
      testID: 'flow-header-close',
      icon: 'material-symbols:arrow-back-rounded',
    });
    const next = headerButton(optionsAt(1, 'design-system-ui-kit', true));
    expect(next).toMatchObject({
      testID: 'flow-header-back',
      icon: 'material-symbols:arrow-back-rounded',
      accessibilityLabel: 'Go back',
    });
  });
});
