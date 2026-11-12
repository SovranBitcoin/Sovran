/**
 * @jest-environment node
 */
/**
 * A drop whose receive the app was killed in the middle of (F213). Its entry is
 * saved as `redeeming`; the next drain receives it again and the mint answers
 * that the token is spent, because this wallet already swapped it. Pinned as it
 * is today: the entry ends `spent`, the visible toast turns red with "Token was
 * already redeemed", and the history row gets no sender or Bluetooth badge.
 * Telling "spent by this wallet" from "spent by someone else" is left to the
 * owner (F213); this test changes when that is decided.
 */
import { meshTokenDedupeKey } from 'wallet';

import { drainNutDropRedeemQueue } from '@/features/nearPay/lib/nutDropAutoRedeem';
import { useNutDropRedeemQueueStore } from '@/shared/stores/profile/nutDropRedeemQueueStore';

const MINT_URL = 'https://mint.example';
const TOKEN = 'cashuBinterrupted';
const mockManager = { mint: { isTrustedMint: async () => true } };
const mockExecuteAutoRedeem = jest.fn();
const mockSetFailed = jest.fn();
const mockSetTransactionAnnotation = jest.fn();
const mockPaymentStatus: { active: { id: string } | null } = { active: null };

jest.mock('wallet/operations', () => ({
  createDefaultOperations: () => ({ executeAutoRedeem: mockExecuteAutoRedeem }),
}));
jest.mock('@/shared/lib/cashu/manager', () => ({
  CocoManager: { isInitialized: () => true, getInstance: () => mockManager },
}));
jest.mock('@/shared/lib/cashu/offlineReceiveDleq', () => ({
  requireOfflineTokenDleq: async () => undefined,
}));
jest.mock('react-native', () => ({ AppState: { currentState: 'active' } }));
jest.mock('bitchat-module', () => ({ getBLEPeers: jest.fn(() => []) }));
jest.mock('@/features/bitchat/hooks/useBLEPeers', () => ({
  useBLEPeerDirectory: { getState: () => ({ peers: [] }) },
}));
jest.mock('@/features/nearPay/lib/peerProfile', () => ({ peerNostrPubkey: jest.fn() }));
jest.mock('@/shared/lib/popup', () => ({ paymentStatusPopup: jest.fn() }));
jest.mock('@/shared/lib/nostr/useEntityCache', () => ({ readProfileRecord: jest.fn() }));
jest.mock('@/shared/stores/profile/transactionAnnotationStore', () => ({
  setTransactionAnnotation: (...args: unknown[]) => mockSetTransactionAnnotation(...args),
}));
jest.mock('@/shared/stores/runtime/paymentStatusStore', () => ({
  usePaymentStatusStore: {
    getState: () => ({
      active: mockPaymentStatus.active,
      setActive: (active: { id: string } | null) => {
        mockPaymentStatus.active = active;
      },
      setWaiting: jest.fn(),
      setFailed: (...args: unknown[]) => mockSetFailed(...args),
    }),
  },
}));
jest.mock('@/shared/stores/global/walletLifecycleStore', () => ({
  useWalletLifecycleStore: { getState: () => ({ restoreStatus: 'complete' }) },
}));
jest.mock('@/shared/lib/logger', () => {
  const log = () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() });
  return {
    paymentLog: log(),
    storeLog: log(),
    log: log(),
    mintUrlLogFields: () => ({}),
    redactError: (e: unknown) => e,
  };
});
jest.mock('@/shared/stores/global/profileStore', () => ({
  activePubkey: () => 'a'.repeat(64),
}));
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));

const HASH = meshTokenDedupeKey(TOKEN);

beforeEach(() => {
  mockPaymentStatus.active = null;
  mockExecuteAutoRedeem.mockReset().mockRejectedValue(new Error('Token already spent'));
  mockSetFailed.mockReset();
  mockSetTransactionAnnotation.mockReset();
  useNutDropRedeemQueueStore.setState({
    byTokenHash: {
      [HASH]: {
        token: TOKEN,
        mintUrl: MINT_URL,
        amount: 21,
        unit: 'sat',
        // Saved by a drain the app was killed in, after the mint's swap.
        status: 'redeeming',
        attempts: 0,
        nextAttemptAt: 0,
        receivedAt: Date.now() - 60_000,
        senderPeerID: '0123456789abcdef',
      },
    },
  });
});

describe('a drop the app was killed in the middle of redeeming (F213, quirk)', () => {
  it('is received again, and the mint reports it spent', async () => {
    await drainNutDropRedeemQueue();
    expect(mockExecuteAutoRedeem).toHaveBeenCalledWith({ tokenString: TOKEN, mintUrl: MINT_URL });
    expect(useNutDropRedeemQueueStore.getState().byTokenHash[HASH]).toMatchObject({
      status: 'spent',
      lastError: 'Token already spent',
    });
  });

  it('shows a red "already redeemed" toast for money that arrived', async () => {
    await drainNutDropRedeemQueue();
    expect(mockSetFailed).toHaveBeenCalledTimes(1);
    expect(mockSetFailed).toHaveBeenCalledWith(HASH, new Error('Token was already redeemed'));
  });

  it('gives the history row no sender or Bluetooth badge', async () => {
    await drainNutDropRedeemQueue();
    expect(mockSetTransactionAnnotation).not.toHaveBeenCalled();
  });
});
