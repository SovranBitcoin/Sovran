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

jest.mock('expo-router', () => ({
  router: { navigate: jest.fn(), replace: jest.fn(), dismiss: jest.fn() },
  useSegments: jest.fn(() => []),
}));
jest.mock('expo-camera', () => ({ scanFromURLAsync: jest.fn() }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('react-native', () => ({ Share: { share: jest.fn() } }));
jest.mock('@cashu/cashu-ts', () => ({ getDecodedToken: jest.fn(), getEncodedToken: jest.fn() }));
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
}));
jest.mock('@/shared/lib/id', () => ({ mintLocalId: jest.fn((prefix: string) => `${prefix}-id`) }));
jest.mock('@/shared/lib/cashu/utils', () => ({ buildReceiveHistoryEntry: jest.fn() }));
jest.mock('@/shared/lib/third-party/emoji', () => ({ decode: jest.fn(), isEncoded: jest.fn() }));
jest.mock('@/shared/lib/nfc', () => ({
  writeTokenToNFC: jest.fn(),
  NfcError: class NfcError extends Error {},
  isUserCancelError: jest.fn(() => false),
}));
jest.mock('wallet', () => ({
  withTimeout: jest.fn((promise: Promise<unknown>) => promise),
  rawAnnotationKey: jest.fn((raw: string) => `raw:${raw}`),
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
  useRoutstrTopUpStore: { getState: jest.fn(() => ({ active: false, complete: jest.fn() })) },
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

// Functional store mock — records the active toast like the real store.
type MockActive = Record<string, unknown> | null;
const mockStoreState: { active: MockActive } = { active: null };
const mockSetActive = jest.fn((payment: MockActive) => {
  mockStoreState.active = payment;
});
const mockSetFailed = jest.fn();
const mockSetConfirmed = jest.fn();
const mockSetDelivered = jest.fn();
const mockClearActive = jest.fn(() => {
  mockStoreState.active = null;
});
jest.mock('@/shared/stores/runtime/paymentStatusStore', () => ({
  usePaymentStatusStore: {
    getState: jest.fn(() => ({
      active: mockStoreState.active,
      setActive: mockSetActive,
      setFailed: mockSetFailed,
      setConfirmed: mockSetConfirmed,
      setDelivered: mockSetDelivered,
      clearActive: mockClearActive,
    })),
  },
}));

const BASE = { mintUrl: 'https://mint1.example.com', amount: 200, unit: 'sat' };

describe('payment toast gating (onchain melt)', () => {
  beforeEach(() => {
    mockStoreState.active = null;
    mockSetActive.mockClear();
    mockSetFailed.mockClear();
    (paymentStatusPopup as jest.Mock).mockClear();
  });

  it('suppresses the processing toast for an onchain melt', () => {
    const notifications = createSovranNotifications();
    void notifications.onPaymentProcessing!({ variant: 'melt', method: 'onchain', ...BASE });
    expect(mockSetActive).not.toHaveBeenCalled();
    expect(paymentStatusPopup).not.toHaveBeenCalled();
  });

  it('keeps the processing toast for a lightning melt (no method)', () => {
    const notifications = createSovranNotifications();
    void notifications.onPaymentProcessing!({ variant: 'melt', ...BASE });
    expect(mockSetActive).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'melt', state: 'processing' })
    );
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
    expect(mockSetActive).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'melt',
        state: 'failed',
        errorMessage: expect.stringContaining('Your funds have been returned'),
      })
    );
    expect(paymentStatusPopup).toHaveBeenCalledTimes(1);
    expect(mockSetFailed).not.toHaveBeenCalled();
  });

  it('flips the existing processing toast on failure instead of creating a new one', () => {
    mockStoreState.active = { variant: 'melt', id: 'melt-1', state: 'processing', ...BASE };
    const notifications = createSovranNotifications();
    void notifications.onPaymentFailed!({
      variant: 'melt',
      ...BASE,
      message: 'Route failed',
    });
    expect(mockSetFailed).toHaveBeenCalledWith('melt-1', expect.any(Error));
    expect(mockSetActive).not.toHaveBeenCalled();
    expect(paymentStatusPopup).not.toHaveBeenCalled();
  });

  it('replaces an unrelated status instead of failing the wrong payment', () => {
    mockStoreState.active = {
      variant: 'melt',
      id: 'other-melt',
      state: 'processing',
      mintUrl: 'https://other.example.com',
      amount: 999,
      unit: 'sat',
    };
    const notifications = createSovranNotifications();
    void notifications.onPaymentFailed!({
      variant: 'melt',
      ...BASE,
      message: 'This melt failed',
    });
    expect(mockSetFailed).not.toHaveBeenCalled();
    expect(mockSetActive).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'melt',
        mintUrl: BASE.mintUrl,
        amount: BASE.amount,
        state: 'failed',
      })
    );
    expect(paymentStatusPopup).toHaveBeenCalledTimes(1);
  });
});
