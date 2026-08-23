/**
 * @jest-environment node
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { ReceiveTokenScreen } from '@/features/receive/screens/ReceiveTokenScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockBack = jest.fn(async () => undefined);
const mockRedeem = jest.fn(async () => undefined);

jest.mock('wallet', () => ({
  isReceiveTokenPending: jest.fn(() => false),
  isReceiveTokenRedeemed: jest.fn(() => false),
}));

jest.mock('wallet/react', () => ({
  useColadaTransactionAnnotation: jest.fn(() => ({})),
  useScreenActions: jest.fn(() => ({
    entry: {
      id: 'receive-1',
      type: 'receive',
      state: 'prepared',
      amount: 40,
      unit: 'sat',
      mintUrl: 'https://mint.sovran.money',
      createdAt: { datetime: '12 July 2026' },
    },
    error: null,
    source: 'Paste',
    mintUrl: 'https://mint.sovran.money',
    actions: {
      back: { execute: mockBack },
      redeem: { available: true, loading: false, execute: mockRedeem },
    },
  })),
}));

jest.mock('@/features/transactions', () => ({
  TransactionDetailShell: ({
    children,
    footer,
  }: React.PropsWithChildren<{ footer: React.ReactNode }>) => (
    <>
      {children}
      {footer}
    </>
  ),
  TransactionLocationSection: () => null,
  useBip321Info: jest.fn(() => ({ isBip321: false, optionKinds: null })),
  transactionLeadDetailItems: ({
    source,
    bip321,
    usedKind,
    createdAt,
  }: {
    source?: string | null;
    bip321: { isBip321: boolean; optionKinds: string[] | null };
    usedKind: string;
    createdAt: string;
  }) => [
    source ? { title: 'Source', value: source } : null,
    bip321.isBip321 ? { title: 'Format', value: 'BIP 321' } : null,
    bip321.optionKinds ? { title: 'Payment Methods', value: usedKind } : null,
    { title: 'Date', value: createdAt },
  ],
}));

jest.mock('@/shared/hooks/useMintInfo', () => ({ useMintInfo: jest.fn(() => null) }));
jest.mock('@/shared/lib/logger', () => ({
  paymentLog: { debug: jest.fn(), warn: jest.fn() },
  useLifecycleLogger: jest.fn(),
}));
jest.mock('@/shared/lib/currency', () => ({ formatAmount: jest.fn(() => '40 sats') }));
jest.mock('@/shared/ui/composed/DetailsSection', () => ({ DetailsSection: () => null }));
jest.mock('@/shared/ui/composed/ScreenStates', () => ({
  ScreenErrorState: () => null,
  ScreenLoadingState: () => null,
}));
jest.mock('@/shared/ui/composed/BottomButtons', () => ({
  BottomButtons: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
jest.mock('@/shared/ui/composed/ButtonHandler', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    ButtonHandler: ({
      buttons,
    }: {
      buttons: { testID: string; text: string; condition?: boolean; onPress: () => void }[];
    }) =>
      ReactActual.createElement(
        ReactActual.Fragment,
        null,
        ...buttons
          .filter((button) => button.condition !== false)
          .map((button) =>
            ReactActual.createElement(
              'MockButton',
              { key: button.testID, testID: button.testID, onPress: button.onPress },
              button.text
            )
          )
      ),
  };
});

describe('ReceiveTokenScreen dismissal', () => {
  it('shows Cancel beside Redeem while a token is still unredeemed', async () => {
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<ReceiveTokenScreen receiveHistoryEntry="receive-1" />);
    });

    expect(renderer!.root.findByProps({ testID: 'receive-token-cancel' })).toBeTruthy();
    expect(renderer!.root.findByProps({ testID: 'receive-token-redeem' })).toBeTruthy();
  });
});
