/**
 * @jest-environment node
 *
 * Toast gating for onchain melts: the processing toast is suppressed at Pay
 * time (onchain settles in minutes-to-hours; only the terminal state toasts),
 * and failures must still surface even though no processing toast exists to
 * flip. Lightning (no `method` in the payload) keeps the full multi-stage
 * behavior.
 */

import { createSovranNotifications } from '@/features/send/lib/sovranPaymentConfig';
import { ERROR_COPY } from '@/shared/lib/errors/catalog';
import { paymentStatusPopup } from '@/shared/lib/popup';
import { setTransactionAnnotation } from '@/shared/stores/profile/transactionAnnotationStore';
import { usePaymentStatusStore } from '@/shared/stores/runtime/paymentStatusStore';

jest.mock('expo-router', () => ({
  router: { navigate: jest.fn(), replace: jest.fn(), dismiss: jest.fn() },
  useSegments: jest.fn(() => []),
}));
jest.mock('expo-camera', () => ({ scanFromURLAsync: jest.fn() }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('react-native', () => ({ Share: { share: jest.fn() } }));
jest.mock('@/features/bitchat/hooks/useBitchatNickname', () => ({
  getBitchatNickname: jest.fn(() => 'Self Sender'),
}));
jest.mock('@/features/bitchat/lib/profileScope', () => ({
  getBitchatProfileScope: jest.fn(() => 'profile-scope'),
}));
jest.mock('@/shared/lib/logger', () => ({
  paymentLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  mintUrlLogFields: jest.fn(() => ({ mintHost: 'mint.example', mintHash: 'mock-hash' })),
}));
jest.mock('@/shared/lib/id', () => jest.requireActual('@/shared/lib/id'));
jest.mock('@/shared/lib/cashu/utils', () => ({ buildReceiveHistoryEntry: jest.fn() }));
jest.mock('@/shared/lib/third-party/emoji', () => ({ decode: jest.fn(), isEncoded: jest.fn() }));
jest.mock('@/shared/lib/nfc', () => ({
  writeTokenToNFC: jest.fn(),
  NfcError: class NfcError extends Error {},
  isUserCancelError: jest.fn(() => false),
}));
jest.mock('@/shared/stores/profile/transactionAnnotationStore', () => ({
  setTransactionAnnotation: jest.fn(),
  linkTransactionAnnotation: jest.fn(),
  setDistributionAnnotation: jest.fn(),
}));
jest.mock('@/shared/lib/popup', () => ({
  copyPopup: jest.fn(),
  copyTokenAsEmoji: jest.fn(),
  nfcConnectionLostPopup: jest.fn(),
  nfcEcashSharedPopup: jest.fn(),
  nfcSendFailedPopup: jest.fn(),
  paymentCancelledPopup: jest.fn(),
  paymentStatusPopup: jest.fn(),
  sendMemoPopup: jest.fn(),
  staticPopup: jest.fn(),
  paramPopup: jest.fn(),
}));
jest.mock('@/features/send/lib/paymentOptionPicker', () => ({
  choosePaymentOption: jest.fn(),
  chooseFallbackPaymentOption: jest.fn(),
}));
jest.mock('@/features/send/lib/proofSelectorPicker', () => ({ chooseProofs: jest.fn() }));
jest.mock('@/features/send/lib/sendFallbackPicker', () => ({ chooseSendFallback: jest.fn() }));
jest.mock('@/shared/hooks/useTransactionLocation', () => ({
  captureAndStoreLocation: jest.fn(),
}));
jest.mock('@/shared/stores/runtime/nearPayStore', () => ({
  useNearPaySessionStore: { getState: jest.fn(() => ({ active: null })) },
}));
jest.mock('@/shared/stores/profile/mintStore', () => ({
  useMintStore: { getState: jest.fn(() => ({ selectedMint: null })) },
}));
jest.mock('@/shared/stores/profile/npcMintStore', () => ({
  useNpcMintStore: { getState: jest.fn(() => ({ getActiveMintUrl: jest.fn() })) },
}));
jest.mock('@/shared/lib/cashu/npc', () => ({ getNpcAddress: jest.fn() }));
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: { getState: jest.fn(() => ({})) },
}));
jest.mock('@/shared/stores/profile/scanHistoryStore', () => ({
  useScanHistoryStore: { getState: jest.fn(() => ({})) },
}));
jest.mock('@/shared/stores/profile/sendReachabilityStore', () => ({
  useSendReachabilityStore: {
    getState: jest.fn(() => ({ markChecking: jest.fn(), pruneOld: jest.fn() })),
  },
}));
jest.mock('@/shared/stores/profile/transactionDistributionStore', () => ({
  useTransactionDistributionStore: { getState: jest.fn(() => ({})) },
}));

const BASE = { mintUrl: 'https://mint1.example.com', amount: 200, unit: 'sat' };
// NUT-18 request with id 'req-1' for 200 sat at BASE.mintUrl.
const PAYMENT_REQUEST =
  'creqApWF0gGFpZXJlcS0xYWEYyGF1Y3NhdGFtgXgZaHR0cHM6Ly9taW50MS5leGFtcGxlLmNvbQ==';
const PROCESSING_MELT = {
  variant: 'melt' as const,
  id: 'melt-1',
  owner: { kind: 'pending' as const, key: 'melt-1' },
  state: 'processing' as const,
};
const activeStatus = () => usePaymentStatusStore.getState().active;

describe('payment toast gating (onchain melt)', () => {
  beforeEach(() => {
    usePaymentStatusStore.setState({ active: null });
    (paymentStatusPopup as jest.Mock).mockClear();
  });

  it('suppresses the processing toast for an onchain melt', () => {
    const notifications = createSovranNotifications();
    void notifications.onPaymentProcessing!({ variant: 'melt', method: 'onchain', ...BASE });
    expect(activeStatus()).toBeNull();
    expect(paymentStatusPopup).not.toHaveBeenCalled();
  });

  it('keeps the processing toast for a lightning melt (no method)', () => {
    const notifications = createSovranNotifications();
    void notifications.onPaymentProcessing!({ variant: 'melt', ...BASE });
    expect(activeStatus()).toMatchObject({ variant: 'melt', state: 'processing' });
    expect(paymentStatusPopup).toHaveBeenCalledTimes(1);
  });

  // The message is the exception's own text, so the toast shows catalogue copy for it.
  it('creates a fresh failed toast when a payment fails with no active toast', () => {
    const notifications = createSovranNotifications();
    void notifications.onPaymentFailed!({
      variant: 'melt',
      ...BASE,
      message: 'Mint rejected the melt',
      rolledBack: true,
    });
    expect(activeStatus()).toMatchObject({
      variant: 'melt',
      state: 'failed',
      errorMessage: `${ERROR_COPY['cashu.unknown']}\nYour funds have been returned.`,
    });
    expect(paymentStatusPopup).toHaveBeenCalledTimes(1);
  });

  it('flips the existing processing toast on failure instead of creating a new one', () => {
    const notifications = createSovranNotifications();
    void notifications.onPaymentProcessing!({ variant: 'melt', ...BASE });
    const key = activeStatus()!.id;
    void notifications.onPaymentFailed!({
      variant: 'melt',
      ...BASE,
      message: 'Route failed',
    });
    expect(activeStatus()).toMatchObject({ id: key, state: 'failed' });
    expect(paymentStatusPopup).toHaveBeenCalledTimes(1);
  });

  it('says the funds came back when the failed payment already had a toast', () => {
    const notifications = createSovranNotifications();
    void notifications.onPaymentProcessing!({ variant: 'melt', ...BASE });
    const key = activeStatus()!.id;
    void notifications.onPaymentFailed!({
      variant: 'melt',
      ...BASE,
      message: 'Route failed',
      rolledBack: true,
    });
    expect(activeStatus()).toMatchObject({
      id: key,
      state: 'failed',
      errorMessage: `${ERROR_COPY['cashu.unknown']}\nYour funds have been returned.`,
    });
  });

  it("shows the wallet package's own wording as it is", () => {
    const notifications = createSovranNotifications();
    void notifications.onPaymentProcessing!({ variant: 'melt', ...BASE });
    void notifications.onPaymentFailed!({
      variant: 'melt',
      ...BASE,
      message: 'Amount must be between 1 and 10 sats',
      authored: true,
    });
    expect(activeStatus()).toMatchObject({
      state: 'failed',
      errorMessage: 'Amount must be between 1 and 10 sats',
    });
  });

  it('replaces an unrelated status instead of failing the wrong payment', () => {
    usePaymentStatusStore.setState({
      active: {
        ...PROCESSING_MELT,
        id: 'other-melt',
        mintUrl: 'https://other.example.com',
        amount: 999,
        unit: 'sat',
      },
    });
    const notifications = createSovranNotifications();
    void notifications.onPaymentFailed!({
      variant: 'melt',
      ...BASE,
      message: 'This melt failed',
      authored: true,
    });
    expect(activeStatus()).toMatchObject({
      variant: 'melt',
      mintUrl: BASE.mintUrl,
      amount: BASE.amount,
      state: 'failed',
      errorMessage: 'This melt failed',
    });
    expect(activeStatus()?.id).not.toBe('other-melt');
    expect(paymentStatusPopup).toHaveBeenCalledTimes(1);
  });
});

describe('payment confirmation history parsing', () => {
  /** A flow that has opened its processing toast for a payment of `variant`. */
  function started(variant: 'melt' | 'paymentRequest') {
    const notifications = createSovranNotifications();
    void notifications.onPaymentProcessing!({ variant, ...BASE });
    return { notifications, key: activeStatus()!.id };
  }

  beforeEach(() => {
    usePaymentStatusStore.setState({ active: null });
    (setTransactionAnnotation as jest.Mock).mockClear();
  });

  it('holds the melt toast while the history entry is still PENDING', () => {
    void started('melt').notifications.onPaymentConfirmed!({
      variant: 'melt',
      ...BASE,
      historyEntry: JSON.stringify({ id: 'h1', type: 'melt', state: 'PENDING' }),
    });
    expect(activeStatus()?.state).toBe('processing');
  });

  it('confirms the melt when the history entry is malformed', () => {
    const { notifications, key } = started('melt');
    void notifications.onPaymentConfirmed!({
      variant: 'melt',
      ...BASE,
      historyEntry: 'not json',
    });
    expect(activeStatus()).toMatchObject({ id: key, state: 'confirmed' });
  });

  it('annotates a confirmed payment-request send from its parsed metadata', () => {
    const { notifications, key } = started('paymentRequest');
    void notifications.onPaymentConfirmed!({
      variant: 'paymentRequest',
      ...BASE,
      historyEntry: JSON.stringify({
        id: 'h1',
        type: 'send',
        operationId: 'op-1',
        metadata: { transportType: 'nostr', paymentRequest: PAYMENT_REQUEST },
      }),
    });
    expect(setTransactionAnnotation).toHaveBeenCalledWith('op:op-1', {
      paymentRequest: { role: 'payer', requestId: 'req-1', transport: 'nostr' },
    });
    expect(activeStatus()).toMatchObject({ id: key, state: 'delivered' });
  });

  it('annotates the send even when the flow has no toast on screen', () => {
    void createSovranNotifications().onPaymentConfirmed!({
      variant: 'paymentRequest',
      ...BASE,
      historyEntry: JSON.stringify({
        id: 'h1',
        type: 'send',
        operationId: 'op-1',
        metadata: { transportType: 'nostr', paymentRequest: PAYMENT_REQUEST },
      }),
    });
    expect(setTransactionAnnotation).toHaveBeenCalledWith('op:op-1', expect.anything());
  });
});

describe('a payment flow changes only the toast it opened', () => {
  const RECEIVING = {
    variant: 'receive' as const,
    id: 'quote-in',
    ...BASE,
    state: 'processing' as const,
  };

  beforeEach(() => {
    usePaymentStatusStore.setState({ active: null });
    (paymentStatusPopup as jest.Mock).mockClear();
  });

  it('leaves a toast that replaced its own alone when its payment is confirmed', () => {
    const notifications = createSovranNotifications();
    void notifications.onPaymentProcessing!({ variant: 'paymentRequest', ...BASE });
    usePaymentStatusStore.setState({ active: RECEIVING });
    void notifications.onPaymentConfirmed!({
      variant: 'paymentRequest',
      ...BASE,
      historyEntry: JSON.stringify({ id: 'h1', type: 'send', operationId: 'op-1' }),
    });
    expect(activeStatus()).toEqual(RECEIVING);
  });

  it('leaves another payment’s toast alone when its own melt is confirmed late', () => {
    const first = createSovranNotifications();
    void first.onPaymentProcessing!({ variant: 'melt', ...BASE });
    const other = { ...PROCESSING_MELT, id: 'melt-other', ...BASE, amount: 300 };
    usePaymentStatusStore.setState({ active: other });
    void first.onPaymentConfirmed!({
      variant: 'melt',
      ...BASE,
      historyEntry: JSON.stringify({ id: 'mo-1', type: 'melt', quoteId: 'mq-1', state: 'PAID' }),
    });
    expect(activeStatus()).toEqual(other);
  });

  it('fails only its own toast: one from another flow for the same mint and amount is left alone', () => {
    const other = { ...PROCESSING_MELT, ...BASE };
    usePaymentStatusStore.setState({ active: other });
    void createSovranNotifications().onPaymentFailed!({
      variant: 'melt',
      ...BASE,
      message: 'This melt failed',
      authored: true,
    });
    expect(activeStatus()).toMatchObject({ state: 'failed', errorMessage: 'This melt failed' });
    expect(activeStatus()?.id).not.toBe(other.id);
    expect(paymentStatusPopup).toHaveBeenCalledTimes(1);
  });

  it('dismisses only its own toast when its payment is cancelled', () => {
    const notifications = createSovranNotifications();
    void notifications.onPaymentProcessing!({ variant: 'melt', ...BASE });
    usePaymentStatusStore.setState({ active: RECEIVING });
    void notifications.onPaymentCancelled!({ variant: 'melt', ...BASE });
    expect(activeStatus()).toEqual(RECEIVING);

    const own = createSovranNotifications();
    void own.onPaymentProcessing!({ variant: 'melt', ...BASE });
    void own.onPaymentCancelled!({ variant: 'melt', ...BASE });
    expect(activeStatus()).toBeNull();
  });

  it('opens each toast under its own key, even in the same millisecond', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    try {
      void createSovranNotifications().onPaymentProcessing!({ variant: 'melt', ...BASE });
      const first = activeStatus()!.id;
      void createSovranNotifications().onPaymentProcessing!({ variant: 'melt', ...BASE });
      expect(activeStatus()!.id).not.toBe(first);
    } finally {
      now.mockRestore();
    }
  });
});

describe('the payment a processing toast belongs to', () => {
  beforeEach(() => {
    usePaymentStatusStore.setState({ active: null });
  });

  it('is the quote of a melt from a preview, from the start', () => {
    void createSovranNotifications().onPaymentProcessing!({
      variant: 'melt',
      quoteId: 'mq-1',
      ...BASE,
    });
    expect(activeStatus()).toMatchObject({
      state: 'processing',
      owner: { kind: 'melt', quoteId: 'mq-1' },
    });
  });

  it('is held under the starter’s key until a payment request’s send reports its operation', () => {
    const notifications = createSovranNotifications();
    void notifications.onPaymentProcessing!({ variant: 'paymentRequest', ...BASE });
    const key = activeStatus()!.id;
    expect(activeStatus()).toMatchObject({ owner: { kind: 'pending', key } });

    void notifications.onPaymentConfirmed!({
      variant: 'paymentRequest',
      ...BASE,
      historyEntry: JSON.stringify({ id: 'h1', type: 'send', operationId: 'op-1' }),
    });
    expect(activeStatus()).toMatchObject({
      id: key,
      state: 'delivered',
      owner: { kind: 'send', operationId: 'op-1' },
    });
  });

  it('is the quote of a melt without a preview once its flow reports it, even still pending', () => {
    const notifications = createSovranNotifications();
    void notifications.onPaymentProcessing!({ variant: 'melt', ...BASE });
    void notifications.onPaymentConfirmed!({
      variant: 'melt',
      ...BASE,
      historyEntry: JSON.stringify({ id: 'mo-9', type: 'melt', quoteId: 'mq-9', state: 'PENDING' }),
    });
    expect(activeStatus()).toMatchObject({
      state: 'processing',
      owner: { kind: 'melt', quoteId: 'mq-9' },
    });
  });

  it('takes its melt for View when the flow confirms it', () => {
    const notifications = createSovranNotifications();
    void notifications.onPaymentProcessing!({ variant: 'melt', ...BASE });
    void notifications.onPaymentConfirmed!({
      variant: 'melt',
      ...BASE,
      historyEntry: JSON.stringify({ id: 'mo-9', type: 'melt', quoteId: 'mq-9', state: 'PAID' }),
    });
    expect(activeStatus()).toMatchObject({
      state: 'confirmed',
      owner: { kind: 'melt', quoteId: 'mq-9' },
      operationId: 'mo-9',
    });
  });

  it('is not bound by another flow', () => {
    void createSovranNotifications().onPaymentProcessing!({ variant: 'paymentRequest', ...BASE });
    void createSovranNotifications().onPaymentConfirmed!({
      variant: 'paymentRequest',
      ...BASE,
      historyEntry: JSON.stringify({ id: 'h1', type: 'send', operationId: 'op-other' }),
    });
    expect(activeStatus()).toMatchObject({ owner: { kind: 'pending' } });
  });
});
