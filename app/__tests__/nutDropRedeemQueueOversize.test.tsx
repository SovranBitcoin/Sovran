/**
 * @jest-environment node
 *
 * The Nut Drop redeem queue and entries that do not fit the stored limits:
 * what the Bluetooth listener queues, and what a launch reads back from a
 * queue a release saved. The BLE listener (`useNutDropAutoRedeem`) and the real
 * queue store run over an in-memory disk; "next launch" loads a fresh copy of
 * the store module from the same disk. Only the native Bluetooth module, the
 * key and offline providers, the drainer and the storage adapter are replaced.
 */

import { Amount, getEncodedToken } from '@cashu/cashu-ts';
import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { meshTokenDedupeKey } from 'wallet';

import { useNutDropAutoRedeem } from '@/features/nearPay/hooks/useNutDropAutoRedeem';
import { paymentLog } from '@/shared/lib/logger';
import {
  NUT_DROP_QUEUE_LIMITS,
  useNutDropRedeemQueueStore,
} from '@/shared/stores/profile/nutDropRedeemQueueStore';

type BleEvent = { isOwn: boolean; content: string; peerID: string };

let mockBleListener: ((event: BleEvent) => void) | undefined;

// The disk lives inside the mock: the store reads it while the imports above load,
// before this file's own top-level variables exist.
jest.mock('@/shared/stores/global/profileStore', () => ({
  activePubkey: () => 'ab'.repeat(32),
}));
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => {
  const disk = new Map<string, string>();
  return {
    disk,
    createProfileScopedStorage: () => ({
      getItem: async (key: string) => disk.get(key) ?? null,
      setItem: async (key: string, value: string) => void disk.set(key, value),
      removeItem: async (key: string) => void disk.delete(key),
    }),
  };
});
jest.mock('bitchat-module', () => ({
  addBLEPrivateMessageListener: (listener: (event: BleEvent) => void) => {
    mockBleListener = listener;
    return { remove: () => undefined };
  },
  beginBLEBackgroundTask: async () => -1,
  endBLEBackgroundTask: async () => undefined,
}));
jest.mock('@/features/nearPay/lib/nutDropAutoRedeem', () => ({
  drainNutDropRedeemQueue: jest.fn(async () => undefined),
}));
jest.mock('@/shared/providers/NostrKeysProvider', () => {
  const keys = { pubkey: 'ab'.repeat(32) };
  return { useNostrKeysContext: () => ({ keys }) };
});
jest.mock('@/shared/providers/OfflineProvider', () => ({
  useOfflineStatus: () => ({ isOffline: false }),
}));

const mockDisk: Map<string, string> = jest.requireMock<{ disk: Map<string, string> }>(
  '@/shared/lib/cashu/profileScopedStorage'
).disk;
const QUEUE_KEY = 'nut-drop-redeem-queue';
const SIDE_KEY = `${QUEUE_KEY}:unreadable`;
const NORMAL_MINT = 'https://mint.example';

function bearerToken(mint: string, amount: number, nonce: string, unit = 'sat'): string {
  return getEncodedToken({
    mint,
    unit,
    proofs: [
      {
        amount: Amount.from(amount),
        id: '009a1f293253e41e',
        secret: nonce.padStart(64, '0'),
        C: `02${'ef'.repeat(32)}`,
      },
    ],
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
  });
}

function receiveOverBle(token: string): void {
  act(() => mockBleListener?.({ isOwn: false, content: token, peerID: '0123456789abcdef' }));
}

/** Load the queue store as a fresh app launch would, from the same disk. */
async function nextLaunch(): Promise<typeof useNutDropRedeemQueueStore> {
  let store: typeof useNutDropRedeemQueueStore | undefined;
  jest.isolateModules(() => {
    store = jest.requireActual<{
      useNutDropRedeemQueueStore: typeof useNutDropRedeemQueueStore;
    }>('@/shared/stores/profile/nutDropRedeemQueueStore').useNutDropRedeemQueueStore;
  });
  await settle();
  return store!;
}

async function nextLaunchQueue(): Promise<Record<string, unknown>> {
  return (await nextLaunch()).getState().byTokenHash;
}

beforeEach(async () => {
  for (const level of ['debug', 'info', 'warn', 'error', 'log'] as const) {
    jest.spyOn(console, level).mockImplementation(() => undefined);
  }
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: () => undefined });
  mockBleListener = undefined;
  await settle();
  useNutDropRedeemQueueStore.setState({ byTokenHash: {} });
  await settle();
  mockDisk.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Nut Drop redeem queue and an entry over the stored limits', () => {
  it('queues a Bluetooth token and reloads it on the next launch', async () => {
    const { unmount } = renderHook(() => useNutDropAutoRedeem());
    const token = bearerToken(NORMAL_MINT, 8, '1');

    receiveOverBle(token);
    await settle();

    const hash = meshTokenDedupeKey(token);
    expect(useNutDropRedeemQueueStore.getState().byTokenHash[hash]).toMatchObject({
      token,
      mintUrl: NORMAL_MINT,
      amount: 8,
      unit: 'sat',
      status: 'pending',
      senderPeerID: '0123456789abcdef',
    });
    await expect(nextLaunchQueue()).resolves.toHaveProperty(hash);
    unmount();
  });

  it.each([
    [
      'mint address',
      `https://mint.example/${'a'.repeat(NUT_DROP_QUEUE_LIMITS.mintUrl + 500)}`,
      'sat',
    ],
    ['unit', NORMAL_MINT, 'u'.repeat(NUT_DROP_QUEUE_LIMITS.unit + 4)],
  ])(
    'refuses and logs a Bluetooth token whose %s is over the queue limits',
    async (_what, mint, unit) => {
      const warn = jest.spyOn(paymentLog, 'warn');
      const { unmount } = renderHook(() => useNutDropAutoRedeem());
      const token = bearerToken(mint, 4, '2', unit);

      receiveOverBle(token);
      await settle();

      expect(useNutDropRedeemQueueStore.getState().byTokenHash).toEqual({});
      expect(warn).toHaveBeenCalledWith(
        'near_pay.redeem.ignored_over_limit',
        expect.objectContaining({ senderPeerID: '0123456789abcdef' })
      );
      unmount();
    }
  );

  it('keeps the queue whole on the next launch after refusing an over-limit token', async () => {
    const { unmount } = renderHook(() => useNutDropAutoRedeem());
    const good = bearerToken(NORMAL_MINT, 16, '4');
    const oversize = bearerToken(`https://mint.example/${'b'.repeat(3000)}`, 2, '5');

    receiveOverBle(good);
    receiveOverBle(oversize);
    await settle();
    unmount();

    const queue = await nextLaunchQueue();
    expect(Object.keys(queue)).toEqual([meshTokenDedupeKey(good)]);
    expect(mockDisk.has(SIDE_KEY)).toBe(false);
  });
});

// ── What a release saved ─────────────────────────────────────────────────────

/**
 * An entry as 0.1.3's `enqueue` saved it
 * (`app/shared/stores/profile/nutDropRedeemQueueStore.ts:120-139@d9ad12c4b`):
 * what the Bluetooth listener handed it
 * (`app/features/nearPay/hooks/useNutDropAutoRedeem.ts:88-95@d9ad12c4b`, no
 * limit checked) plus the queue's own fields. 0.1.3's `markStatus` and
 * `scheduleRetry` (:142-197) stored an error message unclipped.
 */
function releasedEntry(
  token: string,
  fields: Record<string, unknown> = {}
): Record<string, unknown> & { token: string } {
  return {
    token,
    mintUrl: NORMAL_MINT,
    amount: 8,
    unit: 'sat',
    senderPeerID: '0123456789abcdef',
    status: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
    receivedAt: 1_790_000_000_000,
    ...fields,
  };
}

/** The bytes zustand's persist wrote for the queue: `{ state, version }`, version 1. */
function saveReleasedQueue(entries: Record<string, unknown>[]): string {
  const byTokenHash = Object.fromEntries(
    entries.map((entry) => [meshTokenDedupeKey(entry.token as string), entry])
  );
  const bytes = JSON.stringify({ state: { byTokenHash }, version: 1 });
  mockDisk.set(QUEUE_KEY, bytes);
  return bytes;
}

describe('Nut Drop redeem queue reading what a release saved', () => {
  const longMint = `https://mint.example/${'b'.repeat(3000)}`;
  const longUnit = 'u'.repeat(NUT_DROP_QUEUE_LIMITS.unit + 4);

  it('loads every entry, tokens byte for byte, when some are over the stored limits', async () => {
    const good = bearerToken(NORMAL_MINT, 16, '4');
    const overMint = bearerToken(longMint, 2, '5');
    const overUnit = bearerToken(NORMAL_MINT, 3, '6', longUnit);
    // A token of many proofs, longer than the read limit on the token itself.
    const overToken = `${bearerToken(NORMAL_MINT, 1, '7')}${'A'.repeat(NUT_DROP_QUEUE_LIMITS.token)}`;
    const saved = [
      releasedEntry(good, { amount: 16 }),
      releasedEntry(overMint, { mintUrl: longMint, amount: 2 }),
      releasedEntry(overUnit, { unit: longUnit, amount: 3 }),
      releasedEntry(overToken, { amount: 1, status: 'untrusted-mint', attempts: 1 }),
    ];
    const bytes = saveReleasedQueue(saved);

    const store = await nextLaunch();
    const queue = store.getState().byTokenHash;

    expect(Object.keys(queue).sort()).toEqual(
      saved.map((entry) => meshTokenDedupeKey(entry.token)).sort()
    );
    for (const entry of saved) {
      const loaded = queue[meshTokenDedupeKey(entry.token)];
      expect(loaded).toEqual(entry);
      expect(loaded.token).toBe(entry.token);
      expect(loaded.mintUrl).toBe(entry.mintUrl);
      expect(loaded.unit).toBe(entry.unit);
    }

    // That launch saves once, as any queue change would; nothing is set aside.
    store.getState().prune();
    await settle();
    expect(mockDisk.has(SIDE_KEY)).toBe(false);
    // The order of an object's keys is not data.
    // `recoveredCopy` is the one field this build adds; no copy was merged here.
    const released = JSON.parse(bytes) as { state: object; version: number };
    expect(JSON.parse(mockDisk.get(QUEUE_KEY)!)).toEqual({
      ...released,
      state: { ...released.state, recoveredCopy: null },
    });
  });

  it('reads over-limit metadata as absent and keeps the token', async () => {
    const token = bearerToken(NORMAL_MINT, 21, '8');
    const neighbour = bearerToken(NORMAL_MINT, 5, '9');
    const entry = releasedEntry(token, {
      amount: 21,
      status: 'failed',
      attempts: 5,
      lastError: 'e'.repeat(NUT_DROP_QUEUE_LIMITS.lastError + 1),
      senderPeerID: 'p'.repeat(129),
      paymentId: 'i'.repeat(129),
    });
    saveReleasedQueue([entry, releasedEntry(neighbour, { amount: 5 })]);

    const store = await nextLaunch();
    const loaded = store.getState().byTokenHash[meshTokenDedupeKey(token)];

    const { lastError: _e, senderPeerID: _s, paymentId: _p, ...kept } = entry;
    expect(loaded).toEqual(kept);
    expect(loaded.token).toBe(token);
    expect(store.getState().byTokenHash[meshTokenDedupeKey(neighbour)]?.token).toBe(neighbour);
    store.getState().prune();
    await settle();
    expect(mockDisk.has(SIDE_KEY)).toBe(false);
  });

  it('reads wrong-typed metadata as absent and keeps the token', async () => {
    const token = bearerToken(NORMAL_MINT, 13, 'a');
    const entry = releasedEntry(token, {
      amount: 13,
      lastError: 42,
      senderPeerID: { id: 'x' },
      paymentId: ['y'],
    });
    saveReleasedQueue([entry]);

    const store = await nextLaunch();
    const { lastError: _e, senderPeerID: _s, paymentId: _p, ...kept } = entry;
    expect(store.getState().byTokenHash[meshTokenDedupeKey(token)]).toEqual(kept);
    store.getState().prune();
    await settle();
    expect(mockDisk.has(SIDE_KEY)).toBe(false);
  });

  it('still sets the whole queue aside when an entry has no token to redeem', async () => {
    const good = bearerToken(NORMAL_MINT, 16, 'b');
    const bytes = saveReleasedQueue([releasedEntry(good)]);
    const parsed = JSON.parse(bytes) as { state: { byTokenHash: Record<string, unknown> } };
    parsed.state.byTokenHash['c'.repeat(64)] = { ...releasedEntry(''), token: '' };
    const broken = JSON.stringify(parsed);
    mockDisk.set(QUEUE_KEY, broken);

    const store = await nextLaunch();
    expect(store.getState().byTokenHash).toEqual({});
    store.getState().prune();
    await settle();

    // Kept whole where a later release can read it; see the reader's comment.
    expect(mockDisk.get(SIDE_KEY)).toBe(broken);
  });
});
