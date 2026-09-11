/**
 * @jest-environment node
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { SendTokenScreen } from '@/features/send/screens/SendTokenScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockCopy = jest.fn(async () => undefined);
const mockActionMenuPopup = jest.fn();
const mockActionMenuSheet = jest.fn();
let mockCancelLoading = false;

jest.mock('wallet', () => ({
  getSendTokenReachabilityWarning: jest.fn(() => null),
  isSendTokenCancelled: jest.fn(() => false),
  isSendTokenComplete: jest.fn(() => false),
}));

jest.mock('wallet/react', () => ({
  useColadaTransactionAnnotation: jest.fn(() => ({})),
  useScreenActions: jest.fn(() => ({
    entry: {
      id: 'send:1',
      type: 'send',
      state: 'pending',
      amount: 63,
      unit: 'sat',
      mintUrl: 'https://mint.sovran.money',
      token: {},
      tokenString: {
        length: 600,
        toString: () => 'cashuA-token',
        truncate: () => 'cashuA…token',
      },
      createdAt: { datetime: '13 July 2026' },
    },
    error: null,
    source: null,
    mintUrl: 'https://mint.sovran.money',
    actions: {
      copy: {
        available: true,
        execute: mockCopy,
        variants: [
          { id: 'text', label: 'as Text', available: true },
          { id: 'emoji', label: 'as Emoji', available: true },
        ],
      },
      share: { available: true, execute: jest.fn() },
      nfc: { available: true, execute: jest.fn() },
      checkStatus: { available: true, loading: false, execute: jest.fn() },
      cancel: { available: true, loading: mockCancelLoading, execute: jest.fn() },
    },
  })),
}));

jest.mock('@/features/transactions', () => ({
  TransactionDetailShell: ({
    cancelling,
    timelineFocusKey,
    children,
    footer,
    beforeStatus,
  }: React.PropsWithChildren<{
    cancelling?: boolean;
    timelineFocusKey?: string;
    footer: React.ReactNode;
    beforeStatus: React.ReactNode;
  }>) => (
    <>
      {jest.requireActual<typeof React>('react').createElement('TimelineFeedbackMock', {
        testID: 'timeline-feedback',
        cancelling,
        focusKey: timelineFocusKey,
      })}
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

jest.mock('@/shared/lib/popup/popups/actionMenu', () => ({
  actionMenuPopup: (...args: unknown[]) => mockActionMenuPopup(...args),
}));
jest.mock('@/shared/lib/popup/popups/actionMenuSheet', () => ({
  actionMenuSheet: (...args: unknown[]) => mockActionMenuSheet(...args),
}));
jest.mock('@/shared/hooks/useMintInfo', () => ({ useMintInfo: jest.fn(() => null) }));
jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: jest.fn(() => 'black') }));
jest.mock('@/shared/lib/logger', () => ({
  log: { debug: jest.fn(), warn: jest.fn() },
  useLifecycleLogger: jest.fn(),
}));
jest.mock('@/shared/lib/currency', () => ({ formatAmount: jest.fn(() => '63 sats') }));
jest.mock('@/shared/lib/strings', () => ({ truncateMiddle: (value: string) => value }));
jest.mock('@/shared/lib/apiClient', () => ({ fetchMintInfo: jest.fn() }));
jest.mock('@/shared/providers/OfflineProvider', () => ({
  useOfflineStatus: jest.fn(() => ({ isOffline: false })),
}));
jest.mock('@/shared/stores/profile/sendReachabilityStore', () => ({
  useSendReachability: jest.fn(() => null),
  useSendReachabilityStore: { getState: jest.fn() },
}));
jest.mock('@/shared/hooks/useNostrProfileMetadata', () => ({
  useNostrProfileMetadataMany: jest.fn(() => ({ metadata: new Map() })),
}));
jest.mock('@/shared/lib/nostr/memoMentions', () => ({
  extractMemoNprofileReferences: jest.fn(() => []),
  formatMemoForDisplay: (memo: string) => memo,
}));
jest.mock('@/shared/lib/identity', () => ({ resolveIdentityName: jest.fn(() => '') }));
jest.mock('@/features/send/components/P2PKLockIndicator', () => ({
  hasP2PKLock: jest.fn(() => false),
  P2PKLockIndicator: () => null,
}));
jest.mock('@/shared/blocks/PaymentInfo', () => {
  const ReactActual = jest.requireActual<typeof React>('react');
  return {
    PaymentInfo: (props: { active?: boolean }) =>
      ReactActual.createElement('MockPaymentInfo', { ...props, testID: 'mock-payment-info' }),
  };
});
jest.mock('@/shared/ui/composed/DetailsSection', () => ({ DetailsSection: () => null }));
jest.mock('@/shared/ui/composed/GradientCard', () => ({ GradientCard: () => null }));
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
            ReactActual.createElement('MockButton', { ...button, key: button.testID }, button.text)
          )
      ),
  };
});
jest.mock('@/shared/ui/primitives/View/View', () => {
  const ReactActual = jest.requireActual<typeof React>('react');
  return { View: (props: React.PropsWithChildren) => ReactActual.createElement('MockView', props) };
});
jest.mock('@/shared/ui/primitives/Spinner', () => ({ Spinner: () => null }));
jest.mock('@/shared/ui/primitives/View/HStack', () => ({
  HStack: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: () => null }));
jest.mock('heroui-native', () => ({ Alert: () => null }));

describe('SendTokenScreen Copy menu', () => {
  beforeEach(() => {
    mockCancelLoading = false;
    mockActionMenuPopup.mockReset();
    mockActionMenuSheet.mockReset();
    mockCopy.mockClear();
  });

  it('keeps cancellation feedback visible after the overflow closes without changing financial state', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    mockCancelLoading = true;
    await act(async () => {
      renderer = TestRenderer.create(
        <SendTokenScreen sendHistoryEntry="send:1" onNavigateBack={jest.fn()} />
      );
    });
    expect(renderer.root.findAllByProps({ testID: 'send-token-cancelling' })).toHaveLength(0);
    expect(renderer.root.findByProps({ testID: 'mock-payment-info' }).props.copyDisabled).toBe(
      true
    );
    expect(renderer.root.findByProps({ testID: 'mock-payment-info' }).props.active).toBeUndefined();
    expect(renderer.root.findByProps({ testID: 'timeline-feedback' }).props.cancelling).toBe(true);
    expect(renderer.root.findByProps({ testID: 'timeline-feedback' }).props.focusKey).toBeDefined();
    for (const id of ['cancel-transaction', 'copy', 'share', 'nfc', 'check-status']) {
      expect(renderer.root.findByProps({ testID: `send-token-${id}` }).props.disabled).toBe(true);
    }
    mockCancelLoading = false;
    await act(async () =>
      renderer.update(<SendTokenScreen sendHistoryEntry="send:1" onNavigateBack={jest.fn()} />)
    );
    expect(renderer.root.findAllByProps({ testID: 'send-token-cancelling' })).toHaveLength(0);
    expect(renderer.root.findByProps({ testID: 'mock-payment-info' }).props.copyDisabled).toBe(
      false
    );
    expect(
      renderer.root.findByProps({ testID: 'send-token-cancel-transaction' }).props.disabled
    ).toBe(false);
  });

  it('opens its variants above the native transaction-flow modal', async () => {
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <SendTokenScreen sendHistoryEntry="send:1" onNavigateBack={jest.fn()} />
      );
    });

    act(() => {
      void renderer!.root.findByProps({ testID: 'send-token-copy' }).props.onPress();
    });

    expect(mockActionMenuPopup).not.toHaveBeenCalled();
    expect(mockActionMenuSheet).toHaveBeenCalledWith({
      title: 'Copy token',
      buttons: [
        expect.objectContaining({ text: 'as Text', testID: 'send-token-copy-menu-text' }),
        expect.objectContaining({ text: 'as Emoji', testID: 'send-token-copy-menu-emoji' }),
      ],
    });
  });
});
