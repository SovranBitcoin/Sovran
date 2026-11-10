/**
 * @jest-environment node
 *
 * Characterization of the Nut Drop redeem queue when a Bluetooth token does not
 * fit the stored limits. The BLE listener (`useNutDropAutoRedeem`) and the real
 * queue store run over an in-memory disk; "next launch" loads a fresh copy of
 * the store module from the same disk. Only the native Bluetooth module, the
 * key and offline providers, the drainer and the storage adapter are replaced.
 */

import { Amount, getEncodedToken } from '@cashu/cashu-ts';
import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { meshTokenDedupeKey } from 'wallet';

import { useNutDropAutoRedeem } from '@/features/nearPay/hooks/useNutDropAutoRedeem';
import {
  NUT_DROP_QUEUE_LIMITS,
  useNutDropRedeemQueueStore,
} from '@/shared/stores/profile/nutDropRedeemQueueStore';

type BleEvent = { isOwn: boolean; content: string; peerID: string };

let mockBleListener: ((event: BleEvent) => void) | undefined;

// The disk lives inside the mock: the store reads it while the imports above load,
// before this file's own top-level variables exist.
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

  it('queues a Bluetooth token whose mint URL is longer than the stored limit', async () => {
    const { unmount } = renderHook(() => useNutDropAutoRedeem());
    const longMint = `https://mint.example/${'a'.repeat(NUT_DROP_QUEUE_LIMITS.mintUrl + 500)}`;
    const token = bearerToken(longMint, 4, '2');

    receiveOverBle(token);
    await settle();

    // QUIRK: the BLE writer does not check NUT_DROP_QUEUE_LIMITS (the DM writer does), so an
    // entry the stored schema cannot read back is queued (stores-persistence D2). A fix that
    // refuses it at enqueue should change this assertion on purpose.
    expect(
      useNutDropRedeemQueueStore.getState().byTokenHash[meshTokenDedupeKey(token)]
    ).toMatchObject({
      mintUrl: longMint,
      status: 'pending',
    });
    unmount();
  });

  it('queues a Bluetooth token whose unit is longer than the stored limit', async () => {
    const { unmount } = renderHook(() => useNutDropAutoRedeem());
    const longUnit = 'u'.repeat(NUT_DROP_QUEUE_LIMITS.unit + 4);
    const token = bearerToken(NORMAL_MINT, 4, '3', longUnit);

    receiveOverBle(token);
    await settle();

    // QUIRK: same missing limit check, for the unit (D2).
    expect(
      useNutDropRedeemQueueStore.getState().byTokenHash[meshTokenDedupeKey(token)]
    ).toMatchObject({
      unit: longUnit,
    });
    unmount();
  });

  it('loads the whole queue empty on the next launch once one entry is over a limit', async () => {
    const { unmount } = renderHook(() => useNutDropAutoRedeem());
    const good = bearerToken(NORMAL_MINT, 16, '4');
    const oversize = bearerToken(`https://mint.example/${'b'.repeat(3000)}`, 2, '5');

    receiveOverBle(good);
    receiveOverBle(oversize);
    await settle();
    expect(Object.keys(useNutDropRedeemQueueStore.getState().byTokenHash)).toHaveLength(2);
    expect(mockDisk.get(QUEUE_KEY)).toContain(good);

    // QUIRK: one oversize entry fails the parse of the whole stored blob, so the good token
    // is gone from the queue too (D2). A fix (refuse at enqueue, or a per-entry tolerant
    // schema) should change this assertion on purpose.
    await expect(nextLaunchQueue()).resolves.toEqual({});
    unmount();
  });

  it('keeps the unreadable bytes only in a side copy once that launch saves', async () => {
    const { unmount } = renderHook(() => useNutDropAutoRedeem());
    const good = bearerToken(NORMAL_MINT, 16, '6');
    const oversize = bearerToken(`https://mint.example/${'c'.repeat(3000)}`, 2, '7');
    receiveOverBle(good);
    receiveOverBle(oversize);
    await settle();
    unmount();
    const storedBefore = mockDisk.get(QUEUE_KEY);

    expect(storedBefore).toContain(good);
    expect(storedBefore).toContain(oversize);

    // That launch saves once, as any queue change would.
    (await nextLaunch()).getState().prune();
    await settle();

    // QUIRK: the side copy holds every queued token, but nothing reads it back (D2).
    expect(mockDisk.get(SIDE_KEY)).toBe(storedBefore);
    expect(mockDisk.get(QUEUE_KEY)).not.toContain(good);
  });
});
