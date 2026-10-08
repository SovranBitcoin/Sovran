/**
 * @jest-environment node
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import CustomKeyboard from '@/shared/ui/composed/CustomKeyboard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: () => 'theme-foreground',
}));
jest.mock('@/shared/lib/color', () => ({ withAlpha: (color: string) => color }));

jest.mock('@/shared/ui/primitives/Haptics', () => ({
  EnhancedHaptics: {
    actionHaptic: jest.fn(() => Promise.resolve()),
    buttonHaptic: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('react-native-reanimated', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const value = { get: () => 0, set: () => undefined };
  return {
    __esModule: true,
    default: {
      View: ({ children, ...props }: { children?: React.ReactNode }) =>
        ReactActual.createElement('View', props, children),
    },
    cancelAnimation: () => undefined,
    useAnimatedStyle: () => ({}),
    useReducedMotion: () => false,
    useSharedValue: () => value,
    withTiming: (to: number) => to,
  };
});

jest.mock('@/shared/lib/logger', () => ({
  Log: ({ children }: { children?: React.ReactNode }) => children,
}));

jest.mock('@/shared/ui/primitives/View/View', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    __esModule: true,
    View: ({ children, ...props }: { children?: React.ReactNode }) =>
      ReactActual.createElement('View', props, children),
  };
});

jest.mock('@/shared/ui/primitives/Pressable', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    __esModule: true,
    Pressable: ({ children, ...props }: { children?: React.ReactNode }) =>
      ReactActual.createElement('Pressable', props, children),
  };
});

jest.mock('@/shared/ui/primitives/Text', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    __esModule: true,
    Text: ({ children }: { children?: React.ReactNode }) =>
      ReactActual.createElement('Text', null, children),
  };
});

jest.mock(
  'assets/icons',
  () => ({
    __esModule: true,
    default: () => null,
  }),
  { virtual: true }
);

type KeyProps = {
  testID?: string;
  accessibilityRole?: string;
  accessibilityLabel?: string;
  accessibilityState?: { disabled?: boolean; busy?: boolean };
  onPress?: () => void;
};

const FUNCTIONS = [
  {
    testID: 'amount-currency-swapper',
    accessibilityLabel: 'Type in USD instead',
    label: 'USD',
    onPress: jest.fn(),
  },
];

function renderKeys(unit: string, loading = false, functions = FUNCTIONS) {
  const onKeyPress = jest.fn();
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <CustomKeyboard onKeyPress={onKeyPress} unit={unit} loading={loading} functions={functions} />
    );
  });
  const keys = renderer.root
    .findAll((node) => (node.type as unknown) === 'Pressable')
    .map((node) => node.props as KeyProps);
  return { keys, onKeyPress, renderer };
}

describe('CustomKeyboard accessibility', () => {
  it('gives every key a semantic testID, a name and the button role', () => {
    const { keys, renderer } = renderKeys('usd');

    expect(keys.map((k) => k.testID)).toEqual([
      'keypad-key-1',
      'keypad-key-2',
      'keypad-key-3',
      'keypad-key-4',
      'keypad-key-5',
      'keypad-key-6',
      'keypad-key-7',
      'keypad-key-8',
      'keypad-key-9',
      'keypad-key-decimal',
      'keypad-key-0',
      'keypad-key-triple-zero',
      'keypad-key-backspace',
      'amount-currency-swapper',
    ]);
    // Digits keep their digit as the label: e2e scenarios tap `{ label: "4" }`.
    expect(keys[3]?.accessibilityLabel).toBe('4');
    expect(keys[9]?.accessibilityLabel).toBe('Decimal point');
    expect(keys[11]?.accessibilityLabel).toBe('Thousand');
    expect(keys[12]?.accessibilityLabel).toBe('Delete');
    expect(keys[13]?.accessibilityLabel).toBe('Type in USD instead');
    expect(keys.every((k) => k.accessibilityRole === 'button')).toBe(true);

    act(() => renderer.unmount());
  });

  it("fills the sat keypad's decimal slot instead of leaving an unnamed key", () => {
    const { keys, renderer } = renderKeys('sat', false, []);

    expect(keys).toHaveLength(13);
    expect(keys.some((k) => k.testID === 'keypad-key-decimal')).toBe(false);
    expect(keys[9]?.testID).toBe('keypad-key-double-zero');
    expect(keys.every((k) => !!k.accessibilityLabel)).toBe(true);

    act(() => renderer.unmount());
  });

  it('exposes the loading state on every key', () => {
    const { keys, renderer } = renderKeys('sat', true);

    expect(keys.every((k) => k.accessibilityState?.disabled && k.accessibilityState.busy)).toBe(
      true
    );

    act(() => renderer.unmount());
  });

  it('reports the typed value when a key is pressed', () => {
    const { keys, onKeyPress, renderer } = renderKeys('sat');

    act(() => keys[0]?.onPress?.());
    expect(onKeyPress).toHaveBeenCalledWith('1');

    act(() => renderer.unmount());
  });
});
