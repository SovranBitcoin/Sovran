/**
 * @jest-environment node
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { ReceiveTokenScreen } from '@/features/receive/screens/ReceiveTokenScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockBack = jest.fn(async () => undefined);
const mockRedeem = jest.fn(async () => undefined);
let mockFee: number | undefined;
let mockRedeemAvailable = true;
const mockFeeArgs: unknown[][] = [];
jest.mock('@/features/receive/hooks/useTokenReceiveFee', () => ({
  useTokenReceiveFee: (...args: unknown[]) => {
    mockFeeArgs.push(args);
    return mockFee;
  },
}));

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
      tokenString: 'cashuBtoken',
    },
    error: null,
    source: 'Paste',
    mintUrl: 'https://mint.sovran.money',
    actions: {
      back: { execute: mockBack },
      redeem: { available: mockRedeemAvailable, loading: false, execute: mockRedeem },
    },
  })),
}));

jest.mock('@/features/transactions', () => ({
  entryDetailItems: () => [],
  TransactionDetailShell: ({
    children,
    footer,
    beforeStatus,
  }: React.PropsWithChildren<{ footer: React.ReactNode; beforeStatus?: React.ReactNode }>) => (
    <>
      {beforeStatus}
      {children}
      {footer}
    </>
  ),
  TransactionLocationSection: () => null,
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
}));

jest.mock('@/shared/hooks/useMintInfo', () => ({ useMintInfo: jest.fn(() => null) }));
jest.mock('@/shared/lib/logger', () => ({
  paymentLog: { debug: jest.fn(), warn: jest.fn() },
  useLifecycleLogger: jest.fn(),
}));
jest.mock('@/shared/lib/currency', () => ({
  formatAmount: jest.fn(
    ({ amount, unit }: { amount: number; unit: string }) => `${amount} ${unit}`
  ),
}));
jest.mock('@/shared/ui/primitives/Text', () => ({
  Text: (props: object) => jest.requireActual('react').createElement('MockText', props),
}));
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

describe('ReceiveTokenScreen redeem fee', () => {
  beforeEach(() => {
    mockFee = undefined;
    mockRedeemAvailable = true;
    mockFeeArgs.length = 0;
  });

  async function render() {
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<ReceiveTokenScreen receiveHistoryEntry="receive-1" />);
    });
    return renderer!;
  }

  it('states the fee and what arrives before Redeem', async () => {
    mockFee = 2;
    const renderer = await render();
    expect(mockFeeArgs.at(-1)).toEqual(['https://mint.sovran.money', 'cashuBtoken']);
    expect(renderer.root.findByProps({ testID: 'receive-token-fee' }).props.children).toBe(
      'Fee: -2 sat · You receive 38 sat'
    );
  });

  it.each([
    ['the mint charges nothing', 0],
    ['the fee cannot be read', undefined],
  ])('says nothing when %s', async (_name, fee) => {
    mockFee = fee;
    const renderer = await render();
    expect(renderer.root.findAllByProps({ testID: 'receive-token-fee' })).toHaveLength(0);
  });

  it('does not look the fee up once Redeem is not on offer', async () => {
    mockFee = 2;
    mockRedeemAvailable = false;
    const renderer = await render();
    expect(mockFeeArgs.at(-1)?.[0]).toBeUndefined();
    expect(renderer.root.findAllByProps({ testID: 'receive-token-fee' })).toHaveLength(0);
  });
});
