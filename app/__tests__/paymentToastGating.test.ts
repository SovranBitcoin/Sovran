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
jest.mock('@/features/bitchat/lib/blePrivateDelivery', () => ({
  sendBLEPrivateMessageWhole: jest.fn(),
}));
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
jest.mock('@/shared/lib/id', () => ({ mintLocalId: jest.fn((prefix: string) => `${prefix}-id`) }));
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
  emojiPickerPopup: jest.fn(),
  nfcConnectionLostPopup: jest.fn(),
  nfcEcashSharedPopup: jest.fn(),
  nfcSendFailedPopup: jest.fn(),
  paymentCancelledPopup: jest.fn(),
  paymentFallbackPopup: jest.fn(),
  paymentOptionsPopup: jest.fn(),
  paymentStatusPopup: jest.fn(),
  proofSelectorPopup: jest.fn(),
  sendMemoPopup: jest.fn(),
  staticPopup: jest.fn(),
  paramPopup: jest.fn(),
}));
jest.mock('@/shared/hooks/useTransactionLocation', () => ({
  captureAndStoreLocation: jest.fn(),
}));
jest.mock('@/shared/lib/routstr/topUp', () => ({
  executeRoutstrTopUp: jest.fn(),
  formatRoutstrBalance: jest.fn(),
}));
jest.mock('@/shared/stores/runtime/routstrTopUpStore', () => ({
  useRoutstrTopUpStore: { getState: jest.fn(() => ({ phase: 'idle', complete: jest.fn() })) },
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
const PROCESSING_MELT = { variant: 'melt' as const, id: 'melt-1', state: 'processing' as const };
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
      errorMessage: 'Mint rejected the melt\nYour funds have been returned.',
    });
    expect(paymentStatusPopup).toHaveBeenCalledTimes(1);
  });

  it('flips the existing processing toast on failure instead of creating a new one', () => {
    usePaymentStatusStore.setState({ active: { ...PROCESSING_MELT, ...BASE } });
    const notifications = createSovranNotifications();
    void notifications.onPaymentFailed!({
      variant: 'melt',
      ...BASE,
      message: 'Route failed',
    });
    expect(activeStatus()).toMatchObject({ id: 'melt-1', state: 'failed' });
    expect(paymentStatusPopup).not.toHaveBeenCalled();
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
  beforeEach(() => {
    usePaymentStatusStore.setState({ active: { ...PROCESSING_MELT, ...BASE } });
    (setTransactionAnnotation as jest.Mock).mockClear();
  });

  it('holds the melt toast while the history entry is still PENDING', () => {
    void createSovranNotifications().onPaymentConfirmed!({
      variant: 'melt',
      ...BASE,
      historyEntry: JSON.stringify({ id: 'h1', type: 'melt', state: 'PENDING' }),
    });
    expect(activeStatus()?.state).toBe('processing');
  });

  it('confirms the melt when the history entry is malformed', () => {
    void createSovranNotifications().onPaymentConfirmed!({
      variant: 'melt',
      ...BASE,
      historyEntry: 'not json',
    });
    expect(activeStatus()).toMatchObject({ id: 'melt-1', state: 'confirmed' });
  });

  it('annotates a confirmed payment-request send from its parsed metadata', () => {
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
    expect(setTransactionAnnotation).toHaveBeenCalledWith('op:op-1', {
      paymentRequest: { role: 'payer', requestId: 'req-1', transport: 'nostr' },
    });
    expect(activeStatus()).toMatchObject({ id: 'melt-1', state: 'delivered' });
  });
});
