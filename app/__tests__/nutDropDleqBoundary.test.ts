/**
 * @jest-environment node
 */

import { drainNutDropRedeemQueue } from '@/features/nearPay/lib/nutDropAutoRedeem';

const MINT_URL = 'https://mint.example';
const mockManager = Object.assign(Object.create(null), {});
const mockExecuteAutoRedeem = jest.fn();
const mockRequireOfflineTokenDleq = jest.fn();

jest.mock('wallet', () => ({
  createMeshRedeemOrchestrator: jest.fn(
    (config: {
      executeAutoRedeem: (
        token: string,
        mintUrl: string
      ) => Promise<{ historyEntryId: string | null }>;
    }) => ({
      drain: () => config.executeAutoRedeem('cashu-test-token', MINT_URL),
    })
  ),
}));

jest.mock('wallet/operations', () => ({
  createDefaultOperations: jest.fn(() => ({ executeAutoRedeem: mockExecuteAutoRedeem })),
}));

jest.mock('@/shared/lib/cashu/manager', () => ({
  CocoManager: {
    isInitialized: jest.fn(() => true),
    getInstance: jest.fn(() => mockManager),
  },
}));

jest.mock('@/shared/lib/cashu/offlineReceiveDleq', () => ({
  requireOfflineTokenDleq: (...args: unknown[]) => mockRequireOfflineTokenDleq(...args),
}));

jest.mock('react-native', () => ({
  AppState: { currentState: 'active' },
}));

jest.mock('bitchat-module', () => ({ getBLEPeers: jest.fn(() => []) }));
jest.mock('@/features/nearPay/lib/peerProfile', () => ({ peerNostrPubkey: jest.fn() }));
jest.mock('@/shared/lib/popup', () => ({ paymentStatusPopup: jest.fn() }));
jest.mock('@/shared/lib/nostr/useEntityCache', () => ({ readProfileRecord: jest.fn() }));
jest.mock('@/shared/stores/profile/nutDropRedeemQueueStore', () => ({
  useNutDropRedeemQueueStore: {
    getState: jest.fn(() => ({
      byTokenHash: {},
      prune: jest.fn(),
      markStatus: jest.fn(),
      scheduleRetry: jest.fn(),
    })),
  },
}));
jest.mock('@/shared/stores/profile/transactionAnnotationStore', () => ({
  setTransactionAnnotation: jest.fn(),
}));
jest.mock('@/shared/stores/runtime/paymentStatusStore', () => ({
  usePaymentStatusStore: { getState: jest.fn(() => ({})) },
}));
jest.mock('@/shared/stores/global/walletLifecycleStore', () => ({
  useWalletLifecycleStore: { getState: jest.fn(() => ({ restoreStatus: 'complete' })) },
}));
jest.mock('@/shared/lib/logger', () => ({
  paymentLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe('Nut Drop DLEQ receive boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireOfflineTokenDleq.mockResolvedValue(undefined);
    mockExecuteAutoRedeem.mockResolvedValue({ historyEntryId: 'receive-1' });
  });

  it('verifies the encoded token before delegating to Coco receive', async () => {
    await expect(drainNutDropRedeemQueue()).resolves.toBeUndefined();

    expect(mockRequireOfflineTokenDleq).toHaveBeenCalledWith(
      mockManager,
      'cashu-test-token',
      MINT_URL
    );
    expect(mockRequireOfflineTokenDleq.mock.invocationCallOrder[0]).toBeLessThan(
      mockExecuteAutoRedeem.mock.invocationCallOrder[0]
    );
  });

  it('never invokes Coco receive when offline verification fails', async () => {
    const verificationError = new Error('invalid DLEQ');
    mockRequireOfflineTokenDleq.mockRejectedValue(verificationError);

    await expect(drainNutDropRedeemQueue()).rejects.toBe(verificationError);
    expect(mockExecuteAutoRedeem).not.toHaveBeenCalled();
  });
});
