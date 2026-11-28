/**
 * @jest-environment node
 *
 * What the payment flow's notifications do to the payment toasts: which toast
 * a flow starts and under which key, that it only ever changes its own, and
 * what its toast says when the payment is confirmed, cancelled or fails.
 *
 * Onchain melts start no toast at Pay time (they settle in minutes-to-hours;
 * only the result is told), and their failures must still be told.
 */

import { createSovranNotifications } from '@/features/send/lib/sovranPaymentConfig';
import { ERROR_COPY } from '@/shared/lib/errors/catalog';
import { setTransactionAnnotation } from '@/shared/stores/profile/transactionAnnotationStore';
import { paymentToasts } from '@/shared/stores/runtime/paymentStatusStore';

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

/** Every payment with a toast, as `{ key, phase, content }`. */
const toasts = () => paymentToasts.tracked();
/** The one toast there is. */
const toast = () => {
  expect(toasts()).toHaveLength(1);
  return toasts()[0]!;
};

beforeEach(() => {
  paymentToasts.dismissAll();
  (setTransactionAnnotation as jest.Mock).mockClear();
});

// Toasts in flight hold timers: none may outlive its test.
afterEach(() => paymentToasts.dismissAll());

describe('payment toast gating (onchain melt)', () => {
  it('starts no toast for an onchain melt', () => {
    const notifications = createSovranNotifications();
    void notifications.onPaymentProcessing!({ variant: 'melt', method: 'onchain', ...BASE });
    expect(toasts()).toEqual([]);
  });

  it('starts a toast for a lightning melt (no method)', () => {
    const notifications = createSovranNotifications();
    void notifications.onPaymentProcessing!({ variant: 'melt', ...BASE });
    expect(toast()).toMatchObject({ phase: 'working', content: { variant: 'melt', ...BASE } });
  });

  // The message is the exception's own text, so the toast shows catalogue copy for it.
  it('gives a failure its own toast when the payment had none', () => {
    const notifications = createSovranNotifications();
    void notifications.onPaymentFailed!({
      variant: 'melt',
      ...BASE,
      message: 'Mint rejected the melt',
      rolledBack: true,
    });
    expect(toast()).toMatchObject({
      phase: 'failed',
      content: {
        variant: 'melt',
        subtitle: `${ERROR_COPY['cashu.unknown']}\nYour funds have been returned.`,
      },
    });
  });

  it('fails the toast the flow started instead of adding one', () => {
    const notifications = createSovranNotifications();
    void notifications.onPaymentProcessing!({ variant: 'melt', ...BASE });
    const { key } = toast();
    void notifications.onPaymentFailed!({ variant: 'melt', ...BASE, message: 'Route failed' });
    expect(toast()).toMatchObject({ key, phase: 'failed' });
  });

  it('says the funds came back when the failed payment already had a toast', () => {
    const notifications = createSovranNotifications();
    void notifications.onPaymentProcessing!({ variant: 'melt', ...BASE });
    void notifications.onPaymentFailed!({
      variant: 'melt',
      ...BASE,
      message: 'Route failed',
      rolledBack: true,
    });
    expect(toast()).toMatchObject({
      phase: 'failed',
      content: { subtitle: `${ERROR_COPY['cashu.unknown']}\nYour funds have been returned.` },
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
    expect(toast()).toMatchObject({
      phase: 'failed',
      content: { subtitle: 'Amount must be between 1 and 10 sats' },
    });
  });

  it('does not show a payment whose outcome is unknown as a failure', () => {
    const notifications = createSovranNotifications();
    void notifications.onPaymentProcessing!({ variant: 'melt', quoteId: 'mq-1', ...BASE });
    void notifications.onPaymentFailed!({
      variant: 'melt',
      ...BASE,
      message: 'The payment may still complete. Check your history before you pay again.',
      authored: true,
      outcomeUnknown: true,
    });
    expect(toast()).toMatchObject({
      key: 'melt:mq-1',
      phase: 'slow',
      content: { unconfirmed: true },
    });
    expect(toast().content).not.toHaveProperty('subtitle');
  });
});

describe('payment confirmation', () => {
  /** A flow that has started its toast for a payment of `variant`. */
  function started(variant: 'melt' | 'paymentRequest') {
    const notifications = createSovranNotifications();
    void notifications.onPaymentProcessing!({ variant, ...BASE });
    return notifications;
  }

  it('keeps the melt toast working while the history entry is still PENDING', () => {
    void started('melt').onPaymentConfirmed!({
      variant: 'melt',
      ...BASE,
      historyEntry: JSON.stringify({ id: 'h1', type: 'melt', state: 'PENDING' }),
    });
    expect(toast().phase).toBe('working');
  });

  it('finishes the melt when the history entry is malformed', () => {
    void started('melt').onPaymentConfirmed!({
      variant: 'melt',
      ...BASE,
      historyEntry: 'not json',
    });
    expect(toast().phase).toBe('done');
  });

  it('annotates a delivered payment-request send from its parsed metadata, and hands the toast off', () => {
    void started('paymentRequest').onPaymentConfirmed!({
      variant: 'paymentRequest',
      ...BASE,
      historyEntry: JSON.stringify({
        id: 'h1',
        type: 'send',
        state: 'pending',
        operationId: 'op-1',
        metadata: { transportType: 'nostr', paymentRequest: PAYMENT_REQUEST },
      }),
    });
    expect(setTransactionAnnotation).toHaveBeenCalledWith('op:op-1', {
      paymentRequest: { role: 'payer', requestId: 'req-1', transport: 'nostr' },
    });
    // Delivered, waiting on the recipient: not spinning, not yet done.
    expect(toast()).toMatchObject({ key: 'send:op-1', phase: 'handed-off' });
  });

  it('annotates the send even when the flow has no toast', () => {
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
    expect(toasts()).toEqual([]);
  });
});

describe('a payment flow changes only the toast it started', () => {
  const receiving = () =>
    paymentToasts.start('mint:quote-in', { kind: 'payment', variant: 'receive', ...BASE });
  const other = () => paymentToasts.get('mint:quote-in');

  it('leaves another payment’s toast alone when its own payment is confirmed', () => {
    const notifications = createSovranNotifications();
    void notifications.onPaymentProcessing!({ variant: 'paymentRequest', ...BASE });
    receiving();
    void notifications.onPaymentConfirmed!({
      variant: 'paymentRequest',
      ...BASE,
      historyEntry: JSON.stringify({
        id: 'h1',
        type: 'send',
        state: 'pending',
        operationId: 'op-1',
      }),
    });
    expect(other()).toMatchObject({ phase: 'working', content: { variant: 'receive' } });
    expect(paymentToasts.get('send:op-1')).toMatchObject({ phase: 'handed-off' });
  });

  it('fails only its own toast: one from another flow for the same mint and amount is left alone', () => {
    void createSovranNotifications().onPaymentProcessing!({ variant: 'melt', ...BASE });
    const before = toast();
    void createSovranNotifications().onPaymentFailed!({
      variant: 'melt',
      ...BASE,
      message: 'This melt failed',
      authored: true,
    });
    expect(toasts()).toHaveLength(2);
    expect(paymentToasts.get(before.key)).toEqual(before);
    expect(toasts().find((t) => t.key !== before.key)).toMatchObject({
      phase: 'failed',
      content: { subtitle: 'This melt failed' },
    });
  });

  it('dismisses only its own toast when its payment is cancelled', () => {
    const notifications = createSovranNotifications();
    void notifications.onPaymentProcessing!({ variant: 'melt', ...BASE });
    receiving();
    void notifications.onPaymentCancelled!({ variant: 'melt', ...BASE });
    expect(toasts().map((t) => t.key)).toEqual(['mint:quote-in']);

    // A flow that started nothing dismisses nothing.
    void createSovranNotifications().onPaymentCancelled!({ variant: 'melt', ...BASE });
    expect(toasts().map((t) => t.key)).toEqual(['mint:quote-in']);
  });

  it('starts each toast under its own key, even in the same millisecond', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    try {
      void createSovranNotifications().onPaymentProcessing!({ variant: 'melt', ...BASE });
      void createSovranNotifications().onPaymentProcessing!({ variant: 'melt', ...BASE });
      expect(new Set(toasts().map((t) => t.key)).size).toBe(2);
    } finally {
      now.mockRestore();
    }
  });
});

describe('the payment a toast belongs to', () => {
  it('is the quote of a melt from a preview, from the start', () => {
    void createSovranNotifications().onPaymentProcessing!({
      variant: 'melt',
      quoteId: 'mq-1',
      ...BASE,
    });
    expect(toast()).toMatchObject({
      key: 'melt:mq-1',
      phase: 'working',
      content: { target: { type: 'melt', quoteId: 'mq-1' } },
    });
  });

  it('is held under the starter’s key, with nothing to open, until a payment request’s send reports its operation', () => {
    const notifications = createSovranNotifications();
    void notifications.onPaymentProcessing!({ variant: 'paymentRequest', ...BASE });
    expect(toast().key).toMatch(/^pending:/);
    // No id the wallet issued yet: a tap could only open something made up.
    expect(toast().content).not.toHaveProperty('target');

    void notifications.onPaymentConfirmed!({
      variant: 'paymentRequest',
      ...BASE,
      historyEntry: JSON.stringify({
        id: 'h1',
        type: 'send',
        state: 'pending',
        operationId: 'op-1',
      }),
    });
    expect(toast()).toMatchObject({
      key: 'send:op-1',
      phase: 'handed-off',
      content: { variant: 'payment-request', target: { type: 'send', operationId: 'op-1' } },
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
    expect(toast()).toMatchObject({
      key: 'melt:mq-9',
      phase: 'working',
      content: { target: { type: 'melt', quoteId: 'mq-9' } },
    });
  });

  it('is done, and opens its melt, when the flow confirms it paid', () => {
    const notifications = createSovranNotifications();
    void notifications.onPaymentProcessing!({ variant: 'melt', ...BASE });
    void notifications.onPaymentConfirmed!({
      variant: 'melt',
      ...BASE,
      historyEntry: JSON.stringify({ id: 'mo-9', type: 'melt', quoteId: 'mq-9', state: 'PAID' }),
    });
    expect(toast()).toMatchObject({
      key: 'melt:mq-9',
      phase: 'done',
      content: { target: { type: 'melt', quoteId: 'mq-9' } },
    });
  });

  it('is not bound by another flow', () => {
    void createSovranNotifications().onPaymentProcessing!({ variant: 'paymentRequest', ...BASE });
    void createSovranNotifications().onPaymentConfirmed!({
      variant: 'paymentRequest',
      ...BASE,
      historyEntry: JSON.stringify({ id: 'h1', type: 'send', operationId: 'op-other' }),
    });
    expect(toast().key).toMatch(/^pending:/);
  });
});
