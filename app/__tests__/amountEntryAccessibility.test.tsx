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
jest.mock('hex-color-opacity', () => ({
  __esModule: true,
  default: (color: string) => color,
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
jest.mock('@/shared/ui/composed/CustomKeyboard', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/shared/ui/composed/BottomButtons', () => ({
  BottomButtons: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
jest.mock('@/shared/ui/composed/ButtonHandler', () => ({ ButtonHandler: () => null }));
jest.mock('@/shared/ui/composed/ActionMenuButton', () => ({ ActionMenuButton: () => null }));
jest.mock('@/features/wallet/components/CurrencySwapperPill', () => ({
  CurrencySwapperPill: () => null,
}));
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
  it('exposes the undecorated input as amount-value', async () => {
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <AmountEntryView
          rawInput="40"
          numericValue={40}
          unit="sat"
          keyboardUnit="sat"
          inputMode="unit"
          onKeyPress={jest.fn()}
          onNext={jest.fn()}
        />
      );
    });

    const amount = renderer!.root.findByProps({ testID: 'amount-value' });
    expect(amount.props.accessible).toBe(true);
    expect(amount.props.accessibilityValue).toEqual({ text: '40' });
  });
});
