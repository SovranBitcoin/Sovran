/**
 * @jest-environment node
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { LightningSendScreen } from '@/features/send/screens/LightningSendScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockCancel = jest.fn(async () => undefined);
const mockUseScreenActions = jest.fn();

jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
jest.mock('wallet', () => ({
  isMeltQuotePaid: (entry: { state: string }) => entry.state === 'PAID',
  isMeltQuoteReadyToPay: (entry: { state: string }) => entry.state === 'UNPAID',
}));
jest.mock('wallet/react', () => ({
  useScreenActions: (...args: unknown[]) => mockUseScreenActions(...args),
}));
jest.mock('@/features/wallet', () => ({ MintSelector: () => null }));
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
  HistoryEntryRefresh: () => null,
  useBip321Info: jest.fn(() => ({ isBip321: false, optionKinds: null })),
  amountDetailItem: ({ amount, unit }: { amount: unknown; unit: string }) => ({
    title: 'Amount',
    value: `${String(amount)} ${unit}`,
  }),
  stateDetailItem: (state: string) => ({ title: 'State', value: state }),
  quoteIdDetailItem: (quoteId?: string) => (quoteId ? { title: 'Quote ID', value: quoteId } : null),
  mintDetailItem: (mintUrl?: string | null) => (mintUrl ? { title: 'Mint', value: mintUrl } : null),
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
  useIsTransactionHistoryView: jest.fn(() => false),
}));
jest.mock('@/shared/lib/logger', () => ({
  log: { debug: jest.fn(), warn: jest.fn() },
  useLifecycleLogger: jest.fn(),
}));
jest.mock('@/shared/hooks/useMintInfo', () => ({ useMintInfo: jest.fn(() => null) }));
jest.mock('@/shared/hooks/useNostrProfileMetadata', () => ({
  useNostrProfileMetadata: jest.fn(() => ({ metadata: null })),
}));
jest.mock('@/shared/lib/identity', () => ({ resolveIdentityName: jest.fn(() => null) }));
jest.mock('@/shared/stores/profile/transactionAnnotationStore', () => ({
  setTransactionAnnotation: jest.fn(),
}));
jest.mock('@/features/send/components/RecipientHeader', () => ({ RecipientHeader: () => null }));
jest.mock('@/features/send/components/MeltDestinationFingerprintProbe', () => ({
  MeltDestinationFingerprintProbe: () => null,
}));
jest.mock('@/features/send/components/MeltSelectedMintProbe', () => ({
  MeltSelectedMintProbe: () => null,
}));
jest.mock('@/shared/lib/currency', () => ({ formatAmount: jest.fn(() => '40 sats') }));
jest.mock('@/shared/lib/strings', () => ({ truncateMiddle: (value: string) => value }));
jest.mock('@/shared/ui/composed/DetailsSection', () => ({ DetailsSection: () => null }));
jest.mock('@/shared/ui/composed/CopyableValue', () => ({ CopyableValue: () => null }));
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
jest.mock('@/shared/ui/primitives/View/HStack', () => ({
  HStack: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

function screenActions(quoteId: string) {
  return {
    entry: {
      id: quoteId || 'preview-1',
      type: 'melt',
      state: 'UNPAID',
      quoteId,
      amount: 40,
      unit: 'sat',
      mintUrl: 'https://mint.sovran.money',
      metadata: {},
      createdAt: { datetime: '13 July 2026' },
    },
    error: null,
    source: null,
    mintUrl: 'https://mint.sovran.money',
    actions: {
      pay: { available: true, loading: false, execute: jest.fn() },
      cancel: { available: quoteId.length > 0, loading: false, execute: mockCancel },
    },
  };
}

describe('LightningSendScreen dismissal', () => {
  beforeEach(() => {
    mockCancel.mockClear();
    mockUseScreenActions.mockReset();
  });

  it('dismisses an unpaid synthetic preview without attempting rollback', async () => {
    mockUseScreenActions.mockReturnValue(screenActions(''));
    const onCancel = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<LightningSendScreen onCancel={onCancel} />);
    });

    const cancel = renderer!.root.findByProps({ testID: 'melt-cancel' });
    await act(async () => cancel.props.onPress());

    expect(mockCancel).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('rolls back a real unpaid quote before leaving', async () => {
    mockUseScreenActions.mockReturnValue(screenActions('quote-1'));
    const onCancel = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<LightningSendScreen onCancel={onCancel} />);
    });

    const cancel = renderer!.root.findByProps({ testID: 'melt-cancel' });
    await act(async () => cancel.props.onPress());

    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(mockCancel.mock.invocationCallOrder[0]).toBeLessThan(
      onCancel.mock.invocationCallOrder[0]
    );
  });
});
