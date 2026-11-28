/**
 * @jest-environment node
 */

// The Lightning send screen hands its timeline the melt quote's expiry, so an
// unpaid quote that runs out says so instead of "Tap Send" for ever (I-6).

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { LightningSendScreen } from '@/features/send/screens/LightningSendScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockUseScreenActions = jest.fn();
const mockQuoteGet = jest.fn();
const mockTimeline = jest.fn((_props: { meltQuote?: { expiry: number } }) => null);

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { push: jest.fn(), navigate: jest.fn(), back: jest.fn() },
}));
jest.mock('wallet', () => ({
  isMeltQuotePaid: (entry: { state: string }) => entry.state === 'PAID',
  isMeltQuoteReadyToPay: (entry: { state: string }) => entry.state === 'UNPAID',
}));
jest.mock('wallet/react', () => ({
  useScreenActions: (...args: unknown[]) => mockUseScreenActions(...args),
}));
jest.mock('@/features/wallet', () => ({ MintSelector: () => null }));
jest.mock('@/features/transactions', () => ({
  entryDetailItems: () => [],
  TransactionDetailShell: ({ timeline }: { timeline?: React.ReactNode }) => <>{timeline}</>,
  HistoryEntryTimeline: (props: { meltQuote?: { expiry: number } }) => mockTimeline(props),
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
const mockManagerContext = {
  manager: { quotes: { melt: { get: (...args: unknown[]) => mockQuoteGet(...args) } } },
};
jest.mock('@cashu/coco-react', () => ({ useManagerContext: () => mockManagerContext }));
jest.mock('@/shared/lib/cashu/onchainMelt', () => ({
  canOnchainMeltQuoteExpire: (state: string) => state === 'UNPAID' || state === 'prepared',
}));
jest.mock('@/shared/lib/logger', () => ({
  log: { debug: jest.fn(), warn: jest.fn() },
  cashuLog: { debug: jest.fn(), warn: jest.fn() },
  // persistConfig's onRehydrateStorage error branch calls storeLog.warn; a
  // hand-listed logger factory that omits it turns a rehydrate warning into a
  // TypeError inside the store under test.
  storeLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => error,
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

function screenActions(state: string, quoteId: string, metadata: Record<string, string> = {}) {
  return {
    entry: {
      id: quoteId || 'preview-1',
      type: 'melt',
      state,
      quoteId,
      amount: 40,
      unit: 'sat',
      mintUrl: 'https://mint.sovran.money',
      metadata,
      createdAt: { datetime: '13 July 2026' },
    },
    error: null,
    source: null,
    mintUrl: 'https://mint.sovran.money',
    actions: {
      pay: { available: true, loading: false, execute: jest.fn() },
      cancel: { available: false, loading: false, execute: jest.fn() },
    },
  };
}

async function renderScreen() {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<LightningSendScreen onCancel={jest.fn()} />);
  });
  return renderer;
}

const lastMeltQuote = () => mockTimeline.mock.calls.at(-1)?.[0].meltQuote;

describe('LightningSendScreen melt quote', () => {
  beforeEach(() => {
    mockUseScreenActions.mockReset();
    mockTimeline.mockClear();
    mockQuoteGet.mockReset();
    mockQuoteGet.mockResolvedValue({ quoteId: 'quote-1', expiry: 1_800_000_600 });
  });

  it('passes the quote expiry to the timeline while the quote can still expire', async () => {
    mockUseScreenActions.mockReturnValue(screenActions('UNPAID', 'quote-1'));
    const renderer = await renderScreen();
    expect(mockQuoteGet).toHaveBeenCalledWith({
      mintUrl: 'https://mint.sovran.money',
      quoteId: 'quote-1',
    });
    expect(lastMeltQuote()).toEqual({ expiry: 1_800_000_600 });
    act(() => renderer.unmount());
  });

  it('reads the pre-created quote of a preview', async () => {
    mockUseScreenActions.mockReturnValue(screenActions('UNPAID', '', { meltQuoteId: 'quote-1' }));
    const renderer = await renderScreen();
    expect(mockQuoteGet).toHaveBeenCalledWith({
      mintUrl: 'https://mint.sovran.money',
      quoteId: 'quote-1',
    });
    expect(lastMeltQuote()).toEqual({ expiry: 1_800_000_600 });
    act(() => renderer.unmount());
  });

  it('gives a paid send no expiry to count down', async () => {
    mockUseScreenActions.mockReturnValue(screenActions('PAID', 'quote-1'));
    const renderer = await renderScreen();
    expect(lastMeltQuote()).toBeUndefined();
    act(() => renderer.unmount());
  });
});
