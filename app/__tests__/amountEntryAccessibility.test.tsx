/**
 * @jest-environment node
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { AmountEntryView } from '@/shared/ui/composed/AmountEntryView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
}));
jest.mock('@/shared/lib/color', () => ({
  ...jest.requireActual('@/shared/lib/color'),
  withAlpha: (color: string) => color,
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | string[]) =>
    Array.isArray(tokens) ? tokens.map(() => 'white') : 'white',
}));
jest.mock('@/shared/lib/logger', () => ({
  cashuLog: { debug: jest.fn(), info: jest.fn() },
}));
jest.mock('@/shared/ui/composed/AmountFormatter', () => ({
  AMOUNT_FONT_FAMILY: { heavy: 'MonaSans-Black' },
  AmountFormatter: () => null,
}));
let mockKeyboardFunctions: { testID: string }[] = [];
jest.mock('@/shared/ui/composed/CustomKeyboard', () => ({
  __esModule: true,
  default: (props: { functions?: { testID: string }[] }) => {
    mockKeyboardFunctions = props.functions ?? [];
    return null;
  },
}));
jest.mock('@/shared/ui/composed/BottomButtons', () => ({
  BottomButtons: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
jest.mock('@/shared/ui/composed/ButtonHandler', () => ({ ButtonHandler: () => null }));
jest.mock('@/shared/ui/composed/ActionMenuButton', () => ({ ActionMenuButton: () => null }));
jest.mock('@/shared/ui/composed/EcashNote', () => ({ EcashNote: () => null }));
jest.mock('@/shared/ui/primitives/Button', () => ({ Button: () => null }));
jest.mock('@/shared/ui/primitives/Text', () => ({
  Text: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <text {...props}>{children}</text>
  ),
}));
jest.mock('@/shared/ui/primitives/View/View', () => ({
  View: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <view {...props}>{children}</view>
  ),
}));
jest.mock('@/shared/ui/primitives/View/HStack', () => ({
  HStack: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
jest.mock('@/shared/ui/primitives/View/VStack', () => ({
  VStack: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
jest.mock('@/shared/ui/primitives/Pressable', () => ({ Pressable: () => null }));
jest.mock('assets/icons', () => ({ __esModule: true, default: () => null }));

describe('AmountEntryView accessibility', () => {
  const originalE2EStateMirror = process.env.EXPO_PUBLIC_E2E_STATE_MIRROR;

  afterEach(() => {
    if (originalE2EStateMirror === undefined) {
      delete process.env.EXPO_PUBLIC_E2E_STATE_MIRROR;
    } else {
      process.env.EXPO_PUBLIC_E2E_STATE_MIRROR = originalE2EStateMirror;
    }
  });

  const amountElement = (rawInput = '40', numericValue = 40) => (
    <AmountEntryView
      rawInput={rawInput}
      numericValue={numericValue}
      unit="sat"
      keyboardUnit="sat"
      inputMode="unit"
      onKeyPress={jest.fn()}
      onNext={jest.fn()}
    />
  );

  const renderAmount = async (rawInput = '40', numericValue = 40) => {
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(amountElement(rawInput, numericValue));
    });
    return renderer!;
  };

  it('keeps the ordinary accessible amount and omits duplicate spoken content', async () => {
    delete process.env.EXPO_PUBLIC_E2E_STATE_MIRROR;
    const renderer = await renderAmount();

    const amount = renderer.root.findByProps({ testID: 'amount-value' });
    expect(amount.props.accessible).toBe(true);
    expect(amount.props.accessibilityValue).toEqual({ text: '40' });
    expect(renderer.root.findAllByProps({ testID: 'amount-state:40' })).toHaveLength(0);
  });

  it('exposes the semantic amount state only for an owned e2e Metro', async () => {
    process.env.EXPO_PUBLIC_E2E_STATE_MIRROR = '1';
    const renderer = await renderAmount('', 0);
    expect(renderer.root.findByProps({ testID: 'amount-state:0' })).toBeDefined();

    await act(async () => {
      renderer.update(amountElement('40', 40));
    });
    expect(renderer.root.findAllByProps({ testID: 'amount-state:0' })).toHaveLength(0);
    const state = renderer.root.findByProps({ testID: 'amount-state:40' });
    expect(state.props.accessible).toBe(true);
    expect(state.props.accessibilityLabel).toBe('Amount state 40');
    expect(state.props.accessibilityValue).toBeUndefined();
  });

  it('keeps a function key through a flicker and drops it once it stays gone', async () => {
    jest.useFakeTimers();
    const element = (onPickNotes: (() => void) | undefined) => (
      <AmountEntryView
        rawInput="40"
        numericValue={40}
        unit="sat"
        keyboardUnit="sat"
        inputMode="unit"
        onKeyPress={jest.fn()}
        onNext={jest.fn()}
        secondaryDisplay="≈ $0.03"
        swapLabel="USD"
        onPickNotes={onPickNotes}
      />
    );
    const keys = () => mockKeyboardFunctions.map((fn) => fn.testID);
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(element(jest.fn()));
    });
    expect(keys()).toEqual(['amount-currency-swapper', 'amount-pick-notes']);

    // Gone for a few frames, then back: the column never changed.
    await act(async () => {
      renderer!.update(element(undefined));
    });
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    expect(keys()).toEqual(['amount-currency-swapper', 'amount-pick-notes']);
    await act(async () => {
      renderer!.update(element(jest.fn()));
    });
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(keys()).toEqual(['amount-currency-swapper', 'amount-pick-notes']);

    // Gone and staying gone: dropped once it has settled.
    await act(async () => {
      renderer!.update(element(undefined));
    });
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(keys()).toEqual(['amount-currency-swapper']);
    jest.useRealTimers();
  });
});
