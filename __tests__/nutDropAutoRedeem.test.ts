jest.mock('@sovranbitcoin/schemas', () => ({
  loggableIssues: () => [],
}));

jest.mock('@/shared/lib/logger', () => ({
  storeLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  paymentLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  log: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (e: unknown) => e,
}));

jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));

jest.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: jest.fn() },
}));

jest.mock('@cashu/coco-core', () => {
  class NetworkError extends Error {}
  class HttpResponseError extends Error {
    status = 500;
  }
  return { NetworkError, HttpResponseError };
});
const { NetworkError: MockNetworkError } = jest.requireMock('@cashu/coco-core') as {
  NetworkError: new (message: string) => Error;
};

const mockReceive = jest.fn();
const mockIsTrustedMint = jest.fn();
const mockManager = {
  wallet: { receive: mockReceive },
  mint: { isTrustedMint: mockIsTrustedMint },
};
let mockManagerInitialized = true;
jest.mock('@/shared/lib/cashu/manager', () => ({
  CocoManager: {
    isInitialized: () => mockManagerInitialized,
    getInstance: () => mockManager,
  },
}));

const mockPopup = jest.fn();
jest.mock('@/shared/lib/popup', () => ({
  paymentStatusPopup: (args: unknown) => mockPopup(args),
}));

const mockSetActive = jest.fn();
const mockSetFailed = jest.fn();
jest.mock('@/shared/stores/runtime/paymentStatusStore', () => ({
  usePaymentStatusStore: {
    getState: () => ({
      setActive: mockSetActive,
      setFailed: mockSetFailed,
      // Matches the seeded entry's token hash so the failure path sees its
      // own toast mounted and flips it instead of leaving it spinning.
      active: { id: 'f'.repeat(64) },
    }),
  },
}));

let mockRestoreStatus = 'complete';
jest.mock('@/shared/stores/global/walletLifecycleStore', () => ({
  useWalletLifecycleStore: {
    getState: () => ({ restoreStatus: mockRestoreStatus }),
  },
}));

import { drainNutDropRedeemQueue } from '@/features/nearPay/lib/nutDropAutoRedeem';
import { useNutDropRedeemQueueStore } from '@/shared/stores/profile/nutDropRedeemQueueStore';

const HASH = 'f'.repeat(64);

function seedEntry(overrides: Record<string, unknown> = {}) {
  useNutDropRedeemQueueStore.setState({
    byTokenHash: {
      [HASH]: {
        token: 'cashuBexample',
        mintUrl: 'https://mint.test',
        amount: 21,
        unit: 'sat',
        status: 'pending',
        attempts: 0,
        nextAttemptAt: 0,
        receivedAt: Date.now(),
        ...overrides,
      },
    },
  });
}

function entry() {
  return useNutDropRedeemQueueStore.getState().byTokenHash[HASH];
}

describe('drainNutDropRedeemQueue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockManagerInitialized = true;
    mockRestoreStatus = 'complete';
    useNutDropRedeemQueueStore.setState({ byTokenHash: {} });
    mockIsTrustedMint.mockResolvedValue(true);
    mockReceive.mockResolvedValue(undefined);
  });

  it('redeems a trusted pending entry and fires the toast', async () => {
    seedEntry();
    await drainNutDropRedeemQueue();

    expect(mockReceive).toHaveBeenCalledWith('cashuBexample');
    expect(entry().status).toBe('redeemed');
    // Same toast pipeline as a manual redeem: processing state mounted in
    // the status store, paymentStatusPopup shown; coco's receive events flip
    // it to confirmed downstream.
    expect(mockSetActive).toHaveBeenCalledWith({
      variant: 'receive-ecash',
      id: HASH,
      mintUrl: 'https://mint.test',
      amount: 21,
      unit: 'sat',
      state: 'processing',
    });
    expect(mockPopup).toHaveBeenCalledWith({
      variant: 'receive-ecash',
      id: HASH,
      mintUrl: 'https://mint.test',
      amount: 21,
      unit: 'sat',
    });
  });

  it('never auto-trusts an unknown mint', async () => {
    mockIsTrustedMint.mockResolvedValue(false);
    seedEntry();
    await drainNutDropRedeemQueue();

    expect(mockReceive).not.toHaveBeenCalled();
    expect(entry().status).toBe('untrusted-mint');
  });

  it('marks already-spent tokens silently', async () => {
    mockReceive.mockRejectedValue(new Error('Token was already spent'));
    seedEntry();
    await drainNutDropRedeemQueue();

    expect(entry().status).toBe('spent');
    // The processing toast mounts before the receive attempt; a spent token
    // flips it to the standard failed state instead of leaving it spinning.
    expect(mockSetFailed).toHaveBeenCalledWith(HASH, expect.any(Error));
  });

  it('schedules a retry on network failures', async () => {
    mockReceive.mockRejectedValue(new MockNetworkError('fetch failed'));
    seedEntry();
    await drainNutDropRedeemQueue();

    expect(entry()).toMatchObject({ status: 'pending', attempts: 1 });
    expect(entry().nextAttemptAt).toBeGreaterThan(Date.now());
  });

  it('marks unexpected errors failed', async () => {
    mockReceive.mockRejectedValue(new Error('Multisig is not supported'));
    seedEntry();
    await drainNutDropRedeemQueue();

    expect(entry().status).toBe('failed');
  });

  it('skips entries whose backoff window has not elapsed', async () => {
    seedEntry({ nextAttemptAt: Date.now() + 60_000 });
    await drainNutDropRedeemQueue();
    expect(mockReceive).not.toHaveBeenCalled();
  });

  it('does nothing until NUT-13 restore settles', async () => {
    mockRestoreStatus = 'in-progress';
    seedEntry();
    await drainNutDropRedeemQueue();
    expect(mockReceive).not.toHaveBeenCalled();
    expect(entry().status).toBe('pending');
  });

  it('does nothing when the manager is not initialized', async () => {
    mockManagerInitialized = false;
    seedEntry();
    await drainNutDropRedeemQueue();
    expect(mockReceive).not.toHaveBeenCalled();
  });
});
