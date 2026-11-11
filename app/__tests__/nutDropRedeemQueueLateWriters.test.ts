/**
 * @jest-environment node
 */
/**
 * The real queue store and the real orchestrator, with a fake mint. The wallet
 * transport test's queue records calls without applying the queue's moves;
 * this one applies them, so an entry left where no drain, retry or review will
 * pick it up shows here, and so does a toast that says something other than
 * what the queue recorded.
 */
import { Amount, getEncodedToken } from '@cashu/cashu-ts';
import { meshTokenDedupeKey } from 'wallet';

import { drainNutDropRedeemQueue } from '@/features/nearPay/lib/nutDropAutoRedeem';
import { intakeDmEcash, type DmEcashQueuePort } from '@/features/payments/lib/dmEcashIntake';
import { useNutDropRedeemQueueStore } from '@/shared/stores/profile/nutDropRedeemQueueStore';

const MINT_URL = 'https://mint.example';
const TOKEN = getEncodedToken({
  mint: MINT_URL,
  unit: 'sat',
  proofs: [
    {
      id: '009a1f293253e41e',
      amount: Amount.from(21),
      secret: 'a'.repeat(64),
      C: `02${'ef'.repeat(32)}`,
    },
  ],
});
const HASH = meshTokenDedupeKey(TOKEN);
const ME = `02${'b'.repeat(64)}`;
const SENDER = 'c'.repeat(64);

const mockManager = { mint: { isTrustedMint: async () => true } };
const mockExecuteAutoRedeem = jest.fn();
const mockSetTransactionAnnotation = jest.fn();
const mockAppState = { currentState: 'background' };
const mockToast = {
  active: null as { id: string } | null,
  setWaiting: jest.fn(),
  setFailed: jest.fn(),
};

jest.mock('wallet/operations', () => ({
  createDefaultOperations: () => ({ executeAutoRedeem: mockExecuteAutoRedeem }),
}));
jest.mock('@/shared/lib/cashu/manager', () => ({
  CocoManager: { isInitialized: () => true, getInstance: () => mockManager },
}));
jest.mock('@/shared/lib/cashu/offlineReceiveDleq', () => ({
  requireOfflineTokenDleq: async () => undefined,
}));
jest.mock('react-native', () => ({ AppState: mockAppState }));
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
      active: mockToast.active,
      setActive: (active: { id: string }) => {
        mockToast.active = active;
      },
      setWaiting: mockToast.setWaiting,
      setFailed: mockToast.setFailed,
    }),
  },
}));
const mockLifecycle = { restoreStatus: 'complete' };
jest.mock('@/shared/stores/global/walletLifecycleStore', () => ({
  useWalletLifecycleStore: { getState: () => mockLifecycle },
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

const store = () => useNutDropRedeemQueueStore.getState();
const current = () => store().byTokenHash[HASH];

/** The port the message hook hands the intake: the queue store itself. */
const queuePort: DmEcashQueuePort = {
  has: (tokenHash) => tokenHash in store().byTokenHash,
  enqueue: (tokenHash, entry, status) => store().enqueue(tokenHash, entry, status),
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  mockExecuteAutoRedeem.mockReset();
  mockSetTransactionAnnotation.mockReset();
  mockAppState.currentState = 'background';
  mockLifecycle.restoreStatus = 'complete';
  mockToast.active = null;
  mockToast.setWaiting.mockReset();
  mockToast.setFailed.mockReset();
  useNutDropRedeemQueueStore.setState({ byTokenHash: {} });
});

/**
 * The reviewer's sequence. The message intake passes its "already known"
 * check and waits on the mint-trust lookup; the same token arrives over
 * Bluetooth, is queued and starts redeeming; then the message's lookup
 * answers "not trusted".
 */
async function lateMessageIntakeDuringBluetoothReceive() {
  const trust = deferred<boolean | null>();
  const receive = deferred<{ historyEntryId: string | null }>();
  mockExecuteAutoRedeem.mockReturnValue(receive.promise);

  const intake = intakeDmEcash(
    { content: TOKEN, isOwn: false, senderPubkey: SENDER },
    {
      myPubkey33: ME,
      queue: queuePort,
      isTrustedMint: () => trust.promise,
      isSpent: async () => false,
      stillCurrent: () => true,
    }
  );

  // The same token over Bluetooth, queued the way the mesh listener does.
  expect(
    store().enqueue(HASH, {
      token: TOKEN,
      mintUrl: MINT_URL,
      amount: 21,
      unit: 'sat',
      senderPeerID: '0123456789abcdef',
    })
  ).toBe(true);
  const drain = drainNutDropRedeemQueue();
  await flush();
  expect(current()?.status).toBe('redeeming');

  trust.resolve(false);
  const outcome = await intake;
  return { outcome, receive, drain };
}

describe('a message intake that answers after the Bluetooth copy started redeeming', () => {
  it('leaves the entry to the drain, which retries it after a network failure', async () => {
    const { outcome, receive, drain } = await lateMessageIntakeDuringBluetoothReceive();
    expect(outcome).toBe('already-known');
    expect(current()?.status).toBe('redeeming');

    receive.reject(new Error('fetch failed: network down'));
    await drain;
    expect(current()).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: 'fetch failed: network down',
    });
    expect(current()).not.toHaveProperty('source');
  });

  it('leaves the entry to the drain, which records it received', async () => {
    const { receive, drain } = await lateMessageIntakeDuringBluetoothReceive();
    receive.resolve({ historyEntryId: 'hist-1' });
    await drain;
    expect(current()?.status).toBe('redeemed');
    expect(mockSetTransactionAnnotation).toHaveBeenCalledWith(
      'id:hist-1',
      expect.objectContaining({ scan: { method: 'ble' } })
    );
  });

  it('does not mark a queued entry spent when its own probe says so', async () => {
    const spent = deferred<boolean | null>();
    const intake = intakeDmEcash(
      { content: TOKEN, isOwn: false, senderPubkey: SENDER },
      {
        myPubkey33: ME,
        queue: queuePort,
        isTrustedMint: async () => true,
        isSpent: () => spent.promise,
        stillCurrent: () => true,
      }
    );
    await flush();
    store().enqueue(HASH, { token: TOKEN, mintUrl: MINT_URL, amount: 21, unit: 'sat' });
    spent.resolve(true);
    expect(await intake).toBe('already-known');
    expect(current()?.status).toBe('pending');
  });
});

describe('the toast for a queued token says what the queue recorded', () => {
  function queued(attempts: number) {
    mockAppState.currentState = 'active';
    useNutDropRedeemQueueStore.setState({
      byTokenHash: {
        [HASH]: {
          token: TOKEN,
          mintUrl: MINT_URL,
          amount: 21,
          unit: 'sat',
          status: 'pending',
          attempts,
          nextAttemptAt: 0,
          receivedAt: Date.now(),
        },
      },
    });
    mockExecuteAutoRedeem.mockRejectedValue(new Error('fetch failed: network down'));
  }

  it('waits while the token is back in line for another attempt', async () => {
    queued(1);
    await drainNutDropRedeemQueue();
    expect(current()?.status).toBe('pending');
    expect(mockToast.setWaiting).toHaveBeenCalledTimes(1);
    expect(mockToast.setFailed).not.toHaveBeenCalled();
  });

  it('fails once the last attempt has run out and the token is held', async () => {
    queued(4);
    await drainNutDropRedeemQueue();
    expect(current()).toMatchObject({ status: 'failed', attempts: 5 });
    expect(mockToast.setWaiting).not.toHaveBeenCalled();
    expect(mockToast.setFailed).toHaveBeenCalledWith(HASH, new Error('Redeem failed'));
  });
});

describe('the drain waits for the wallet restore', () => {
  it.each([
    ['unknown', false],
    ['not-needed', true],
    ['pending', false],
    ['in-progress', false],
    ['complete', true],
    ['failed', false],
  ] as const)('with a saved %s restore status, receives: %s', async (restoreStatus, receives) => {
    mockLifecycle.restoreStatus = restoreStatus;
    store().enqueue(HASH, { token: TOKEN, mintUrl: MINT_URL, amount: 21, unit: 'sat' });
    mockExecuteAutoRedeem.mockResolvedValue({ historyEntryId: null });
    await drainNutDropRedeemQueue();
    expect(mockExecuteAutoRedeem).toHaveBeenCalledTimes(receives ? 1 : 0);
  });
});
