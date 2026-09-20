import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Amount, type HistoryEntry } from '@cashu/coco-core';
import { ReceivedThisMonth } from '@/features/transactions/components/MonthlyChart';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { Text } from '@/shared/ui/primitives/Text';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/shared/stores/global/settingsStore', () => {
  const { create } = jest.requireActual('zustand');
  return {
    useSettingsStore: create((_: unknown, get: () => { displayBtc: number }) => ({
      mockMode: false,
      displayBtc: 2,
      getDisplayBtc: () => get().displayBtc,
    })),
  };
});
jest.mock('@/shared/stores/global/pricelistStore', () => ({
  usePricelistStore: { getState: () => ({ pricelist: null }) },
}));
jest.mock('@/shared/stores/profile/swapTransactionsStore', () => ({
  useSwapTransactionsStore: (selector: (state: { quoteIdToGroup: object }) => unknown) =>
    selector({ quoteIdToGroup: {} }),
}));
jest.mock('wallet', () => ({
  ...jest.requireActual('../../wallet/src/history/filters'),
  ...jest.requireActual('../../wallet/src/units/index'),
}));
jest.mock('@/shared/stores/global/mintTestnutStore', () => ({
  useIsTestnutMint: () => (mintUrl: string) => mintUrl.includes('testnut'),
}));
jest.mock('@/shared/lib/logger', () => ({
  Log: ({ children }: { children: React.ReactNode }) => children,
  paymentLog: { debug: jest.fn() },
  cashuLog: { warn: jest.fn() },
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | string[]) =>
    // eslint-disable-next-line no-restricted-syntax -- withAlpha requires a real hex in this theme mock.
    Array.isArray(tokens) ? tokens.map(() => '#888888') : '#888888',
}));
jest.mock('@/shared/hooks/useColorScheme', () => ({ useColorScheme: () => 'dark' }));
jest.mock('@/shared/ui/capability', () => ({
  useCapabilities: () => ({ liquidGlass: false }),
}));
jest.mock('liquid-glass-text', () => ({ LiquidGlassText: () => null }));
jest.mock('react-native-svg', () => {
  const { View } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: View,
    Path: View,
    Defs: View,
    LinearGradient: View,
    Stop: View,
    Text: View,
  };
});
jest.mock('@/shared/ui/primitives/View/View', () => ({
  View: jest.requireActual('react-native').View,
}));
jest.mock('@/shared/ui/primitives/SquircleView', () => ({
  SquircleView: jest.requireActual('react-native').View,
}));
jest.mock('@/shared/ui/composed/BlurCardFrame', () => ({
  BlurCardFrame: jest.requireActual('react-native').View,
}));
jest.mock('@/shared/ui/primitives/Text', () => ({
  Text: 'Text',
}));
jest.mock('@/assets/icons', () => ({ __esModule: true, default: () => null }));

const now = new Date(2026, 8, 15, 12);

function receiveHistory(unit: string): HistoryEntry[] {
  return [
    {
      id: 'monthly-receive',
      source: 'operation',
      operationId: 'monthly-receive',
      type: 'receive',
      state: 'finalized',
      amount: Amount.from(123_456_789_012),
      unit,
      mintUrl: 'https://mint.example',
      createdAt: now.getTime(),
      updatedAt: now.getTime(),
    },
  ];
}

describe('MonthlyChart', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([
    [0, 'sat', '1,234.56789012'],
    [2, 'sat', '123,456,789,012 sats'],
    [0, 'usd', '$1,234,567,890.12'],
    [2, 'eur', '€1,234,567,890.12'],
  ] as const)(
    'renders a large %s-preference %s amount and its daily change',
    (preference, unit, expected) => {
      useSettingsStore.setState({ displayBtc: preference });

      let renderer!: TestRenderer.ReactTestRenderer;
      act(() => {
        renderer = TestRenderer.create(
          <ReceivedThisMonth history={receiveHistory(unit)} unit={unit} />
        );
      });
      const chip = renderer.root.findByProps({ testID: 'monthly-chart-received-change' });
      expect(chip.findByType(Text).props.children).toBe(expected);
      act(() => renderer.unmount());
    }
  );

  it('updates the change chip when the display preference changes', () => {
    useSettingsStore.setState({ displayBtc: 2 });
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<ReceivedThisMonth history={receiveHistory('sat')} />);
    });

    act(() => {
      useSettingsStore.setState({ displayBtc: 0 });
    });

    const chip = renderer.root.findByProps({ testID: 'monthly-chart-received-change' });
    expect(chip.findByType(Text).props.children).toBe('1,234.56789012');
    act(() => renderer.unmount());
  });
});
