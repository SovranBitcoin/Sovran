import { act, renderHook } from '@testing-library/react-native';

import { useSendLockTarget } from '@/features/send/hooks/useSendLockTarget';
import { useOurP2pkPubkeys } from '@/shared/hooks/useOurP2pkPubkeys';
import type { NutzapProfile } from '@/shared/lib/nostr/nip61NutzapProfile';
import type { CashuP2pkPubkey } from '@/shared/lib/protocolIds';

const mockResolveProfile = jest.fn();
const mockResolvePrimary = jest.fn();
const mockResolveKeys = jest.fn();
let mockManager = {};
jest.mock('@cashu/coco-react', () => ({
  useManager: () => mockManager,
  useManagerContext: () => ({ manager: mockManager }),
}));
jest.mock('@sovranbitcoin/coco-cashu-plugin-p2pk-import', () => ({
  resolvePrimaryReceiveP2PKPublicKey: (...args: unknown[]) => mockResolvePrimary(...args),
  resolveReceiveP2PKPublicKeys: (...args: unknown[]) => mockResolveKeys(...args),
}));
jest.mock('@/shared/lib/nostr/nutzapProfileDiscovery', () => ({
  resolveNutzapProfile: (...args: unknown[]) => mockResolveProfile(...args),
}));

const aliceKey = `02${'ab'.repeat(32)}` as CashuP2pkPubkey;
const ownKey = `02${'cd'.repeat(32)}`;
const alice: NutzapProfile = {
  lockKey: aliceKey,
  source: 'nutzapInfo',
  mints: [],
  relays: [],
  updatedAtSec: 1,
};

beforeEach(() => {
  mockManager = {};
  mockResolveProfile.mockReset().mockResolvedValue(alice);
  mockResolvePrimary.mockReset().mockResolvedValue(ownKey);
  mockResolveKeys.mockReset().mockResolvedValue([ownKey]);
});

it('does not offer Alice’s key while Bob’s lookup is pending', async () => {
  const { result, rerender } = renderHook(
    ({ recipient }: { recipient: string }) => useSendLockTarget({ recipientPubkey: recipient }),
    {
      initialProps: { recipient: 'a'.repeat(64) },
    }
  );
  await act(async () => {});
  expect(result.current.gate).toEqual({ kind: 'ready', lockKey: aliceKey });
  mockResolveProfile.mockImplementation(() => new Promise(() => {}));
  rerender({ recipient: 'b'.repeat(64) });
  expect(result.current.gate.kind).toBe('unavailable');
});

it('does not expose another wallet’s refund or signing keys during a profile switch', async () => {
  const { result, rerender } = renderHook(() => ({
    target: useSendLockTarget({ recipientPubkey: 'a'.repeat(64) }),
    keys: useOurP2pkPubkeys(),
  }));
  await act(async () => {});
  expect(result.current.target.refundKey).toBe(ownKey);
  expect(result.current.keys).toEqual([ownKey]);
  mockManager = {};
  mockResolvePrimary.mockImplementation(() => new Promise(() => {}));
  mockResolveKeys.mockImplementation(() => new Promise(() => {}));
  rerender({});
  expect(result.current.target.refundKey).toBeNull();
  expect(result.current.keys).toBeUndefined();
});
