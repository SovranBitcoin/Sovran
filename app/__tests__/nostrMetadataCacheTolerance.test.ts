/**
 * Regression: one oversized kind-0 field in the mockPersisted metadata cache must
 * drop THAT field only. Before, the standard merge rejected the whole blob on a
 * single `too_big` issue, so one 3 KB picture URL wiped every cached name on
 * boot (`store.nostr_metadata.merge_rejected`).
 */
import { useNostrMetadataCache } from '@/shared/stores/global/nostrMetadataCache';

jest.mock('@/shared/lib/logger', () => ({
  storeLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  log: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (e: unknown) => e,
}));

const mockPersisted = {
  state: {
    byPubkey: {
      a: { name: 'alice', picture: 'https://x/'.padEnd(3000, 'p'), fetchedAt: 1 },
      b: { name: 'bob', displayName: 'Bob', fetchedAt: 2 },
    },
  },
  version: 1,
};

jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => JSON.stringify(mockPersisted),
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));

it('rehydrates every entry and drops only the oversized field', async () => {
  useNostrMetadataCache.setState({ byPubkey: {} });
  await useNostrMetadataCache.persist.rehydrate();
  const { byPubkey } = useNostrMetadataCache.getState();
  expect(byPubkey.b).toEqual({ name: 'bob', displayName: 'Bob', fetchedAt: 2 });
  expect(byPubkey.a?.name).toBe('alice');
  expect(byPubkey.a?.picture).toBeUndefined();
});
